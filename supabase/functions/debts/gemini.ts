// Модель Google Gemini через REST API (есть бесплатный тариф). Включается, если задан GEMINI_API_KEY.
// Подходят ключи Google AI Studio (старые AIza… и новые AQ.…) — Gemini API, generativelanguage.googleapis.com.
// Ключ AQ.… бывает и от Vertex AI в экспресс-режиме — тогда он работает только с aiplatform.googleapis.com,
// поэтому для AQ.… сначала пробуем Gemini API, потом Vertex.
// Формат запросов у них общий и сверен с официальным SDK @google/genai: generateContent, functionDeclarations
// с parametersJsonSchema, ответы инструментов — functionResponse {id, name, response: {output|error}}.
import { AiError, type RunArgs, runTool, SYSTEM, TOOLS } from './assistant.ts';
import { GEMINI_API_KEY, GEMINI_MODEL } from './config.ts';

type Part = Record<string, unknown> & {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
};
interface Content { role: 'user' | 'model'; parts: Part[] }
interface GeminiResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

const declarations = TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: { type: 'object', properties: t.properties, required: t.required },
}));

const BLOCKED = 'Google не пропустил этот запрос или ответ. Попробуйте переформулировать или прислать документ без паспортных данных.';

function errorFor(status: number, body: string): AiError {
  if (status === 429) return new AiError('rate', body);
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(body)) return new AiError('auth', body);
  if (/location is not supported/i.test(body)) return new AiError('region', body);
  if (status >= 500) return new AiError('down', body);
  return new AiError('bad', body);
}

/** Новый формат ключа: AI Studio или Vertex — выясняем пробными запросами */
export const isNewKey = (key: string) => key.startsWith('AQ.');

/** Модели, которые пробуем по очереди, если DEBTS_GEMINI_MODEL не задан. «latest» у Google бывает перегружена (503) — она не первая.
 * gemini-2.5-flash убрана: новым ключам Google её больше не даёт (404).
 * gemini-3.8-flash в конце: 8 ноября 2026 на нашем ключе не отвечала и за 30 секунд */
export const MODEL_CANDIDATES = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3-flash'];

/** Куда и как передать ключ: в заголовке x-goog-api-key, в адресе (?key=, как в документации экспресс-режима Vertex) или как Bearer */
type Auth = 'header' | 'query' | 'bearer';
interface Way { api: 'studio' | 'vertex'; auth: Auth }

function waysFor(key: string): Way[] {
  const studio: Way = { api: 'studio', auth: 'header' };
  if (!isNewKey(key)) return [studio];
  return [studio, ...(['query', 'header', 'bearer'] as Auth[]).map(auth => ({ api: 'vertex' as const, auth }))];
}

function request(model: string, key: string, { api, auth }: Way, body: unknown): [string, RequestInit] {
  const base = api === 'vertex'
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth === 'header') headers['x-goog-api-key'] = key;
  if (auth === 'bearer') headers.Authorization = `Bearer ${key}`;
  const url = auth === 'query' ? `${base}?key=${encodeURIComponent(key)}` : base;
  return [url, { method: 'POST', headers, body: JSON.stringify(body) }];
}

async function generate(contents: Content[]): Promise<GeminiResponse> {
  const key = GEMINI_API_KEY();
  // Посреди работы с инструментами модель не меняем: в истории её подписи размышлений, другая их не примет
  const midTask = contents.some(c => c.parts.some(p => p.functionCall || p.thoughtSignature));
  for (let attempt = 0; ; attempt++) {
    const { model, way } = await working();
    const [url, init] = request(model, key, way, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { maxOutputTokens: 16384 },
    });
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new AiError('down', String(e));
    }
    if (res.ok) return await res.json();
    const err = errorFor(res.status, await res.text());
    // Лимит этой модели кончился или её убрали — на время откладываем её и берём следующую из списка
    if ((res.status === 429 || res.status === 404) && !GEMINI_MODEL()) {
      tired.set(model, Date.now() + (res.status === 404 ? 24 * 3600e3 : 15 * 60e3));
      found = null;
      if (!midTask && attempt < 2) {
        console.log('gemini switch model', model, res.status);
        continue;
      }
    }
    throw err;
  }
}

const parseJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

export async function runGemini({ history, context, attachments, userText, ctx }: RunArgs): Promise<string> {
  const contents: Content[] = history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] }));
  contents.push({
    role: 'user',
    parts: [
      { text: context },
      ...attachments.map((a): Part =>
        a.text !== undefined ? { text: `Файл «${a.file.name}»:\n${a.text}` } : { inlineData: { mimeType: a.mime, data: a.base64 } }
      ),
      { text: userText },
    ],
  });

  let malformed = 0;
  for (let turn = 0; turn < 10; turn++) {
    const res = await generate(contents);
    const cand = res.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    // Модель иногда ошибается в формате вызова инструмента — просим ещё раз
    if (cand?.finishReason === 'MALFORMED_FUNCTION_CALL' && malformed++ < 2) continue;
    if (!parts.length) return (res.promptFeedback?.blockReason || cand?.finishReason !== 'STOP') ? BLOCKED : '';

    const calls = parts.filter(p => p.functionCall);
    const said = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
    if (!calls.length) return said;

    // Ответ модели кладём в историю как есть: в нём подписи размышлений, без них следующий запрос не примут
    contents.push(cand!.content!);
    const responses: Part[] = [];
    for (const p of calls) {
      const call = p.functionCall!;
      const r = await runTool(call.name, call.args ?? {}, ctx);
      responses.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: r.isError ? { error: r.content } : { output: parseJson(r.content) },
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return '';
}

/* ---------- подбор модели и проверка ключа ---------- */
let found: { model: string; way: Way } | null = null;
/** Модели, у которых кончился лимит или которых нет: до какого времени их не пробуем */
const tired = new Map<string, number>();
/** Для тестов: забыть найденную модель */
export const forgetChoice = () => {
  found = null;
  tired.clear();
};

/** Какую ошибку показать, если не ответила ни одна модель: лимит и сбой Google важнее, чем «такой модели нет» */
const RANK = (s: number) => (s === 429 ? 0 : s === 0 || s >= 500 ? 1 : s === 401 || s === 403 ? 2 : s === 404 ? 4 : 3);

/** Модель и способ передачи ключа, которые работают с этим ключом (запоминаем до перезапуска функции) */
async function working() {
  if (found) return found;
  // Старый ключ AI Studio с заданной моделью проверять незачем; для нового узнаём, куда и как его передавать
  if (GEMINI_MODEL() && !isNewKey(GEMINI_API_KEY())) return { model: GEMINI_MODEL(), way: waysFor(GEMINI_API_KEY())[0] };
  const fresh = MODEL_CANDIDATES.filter(m => (tired.get(m) ?? 0) < Date.now());
  const models = GEMINI_MODEL() ? [GEMINI_MODEL()] : fresh.length ? fresh : MODEL_CANDIDATES;
  const check = await checkGemini(models);
  const ok = check.results.find(r => r.status === 200);
  if (!ok) {
    for (const r of check.results) if (r.status === 429 || r.status === 404) tired.set(r.model, Date.now() + 15 * 60e3);
    const worst = [...check.results].sort((a, b) => RANK(a.status) - RANK(b.status))[0];
    throw errorFor(worst?.status ?? 500, worst?.message ?? 'нет ответа');
  }
  found = { model: ok.model, way: { api: ok.api, auth: ok.auth } };
  return found;
}

/** Настоящий разговор с вызовом инструмента (только чтение истории): проверяет выбранную модель целиком — для /ai-check?deep=1 */
export async function deepCheckGemini(todayStr: string) {
  const { model } = await working();
  const ctx = { by: 'проверка', files: [], today: todayStr, changed: false };
  const reply = await runGemini({
    history: [],
    context: `Контекст: сегодня ${todayStr}.`,
    attachments: [],
    // Сумму модель может узнать только из инструмента, так что ответ доказывает, что вызов прошёл
    userText: 'Вызови payment_history с limit=1, ничего не меняй и ответь только суммой из последней записи.',
    ctx,
  });
  return { model, reply, changed: ctx.changed };
}

/** Пробный запрос к каждой модели по очереди — для /ai-check и подбора модели. Ключ не раскрывается */
export async function checkGemini(models: string[]) {
  const key = GEMINI_API_KEY();
  const results: (Way & { model: string; status: number; message: string })[] = [];
  const probe = {
    systemInstruction: { parts: [{ text: 'Отвечай одним словом.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Скажи «ок».' }] }],
    tools: [{ functionDeclarations: declarations }],
  };
  for (const model of models) for (const way of waysFor(key)) {
    // способ, который уже дал «ключ не тот» или «нет доступа», для следующих моделей не повторяем
    if (results.some(r => r.api === way.api && r.auth === way.auth && (r.status === 401 || r.status === 403))) continue;
    let status = 0;
    let message = '';
    try {
      const [url, init] = request(model, key, way, probe);
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      status = res.status;
      const body = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(body) as GeminiResponse;
        message = (parsed.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').slice(0, 40);
      } else {
        const err = parseJson(body)?.error ?? {};
        message = `${err.status ?? ''} ${err.message ?? body}`.slice(0, 300);
      }
    } catch (e) {
      message = String(e).slice(0, 200);
    }
    results.push({ ...way, model, status, message });
    if (status === 200) return { newKey: isNewKey(key), keyLength: key.length, results };
  }
  return { newKey: isNewKey(key), keyLength: key.length, results };
}
