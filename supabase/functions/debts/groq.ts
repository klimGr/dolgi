// Модель на Groq: бесплатный тариф, OpenAI-совместимый API.
// Отвечает самая сильная из доступных моделей с вызовом инструментов. Фото документов сначала читает
// модель со зрением (переписывает текст), PDF разбираем сами — дальше главная модель работает с текстом.
import { AiError, type Attachment, type RunArgs, runTool, SYSTEM, TOOLS } from './assistant.ts';
import { GROQ_API_KEY } from './config.ts';

const API = 'https://api.groq.com/openai/v1';

// По убыванию «ума» и умения работать с инструментами; берём первую, что есть в аккаунте
export const CHAT_MODELS = [
  'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2-instruct',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
];
// Видят картинки — ими переписываем фото договоров в текст. Если ни одной из списка нет, берём похожую по названию
export const VISION_MODELS = [
  'qwen/qwen3.8-27b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];
const LOOKS_VISUAL = /(vision|-vl|llama-4|qwen\/qwen3\.[5-9])/i;

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }
interface ChatResponse { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[] }

const tools = TOOLS.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required } },
}));

function errorFor(status: number, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', body);
  if (status === 429) return new AiError('rate', body);
  if (status >= 500) return new AiError('down', body);
  return new AiError('bad', body);
}

/** Сколько секунд просит подождать Groq при 429: «try again in 6.06s» или «in 1m2.5s» */
export function retryAfter(body: string): number | null {
  const m = body.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
}

// Бесплатный тариф считает токены в минуту: несколько фото подряд упираются в лимит на несколько секунд.
// Короткую паузу ждём сами, долгую (суточный лимит) — отдаём наверх
const MAX_WAIT = 25;
export let sleep = (s: number) => new Promise(r => setTimeout(r, s * 1000));
export const setSleep = (f: typeof sleep) => void (sleep = f);

async function groq<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${GROQ_API_KEY()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new AiError('down', String(e));
    }
    if (res.ok) return await res.json();
    const text = await res.text();
    const wait = res.status === 429 ? retryAfter(text) : null;
    if (wait !== null && wait <= MAX_WAIT && attempt < 4) {
      console.log('groq rate, wait', wait);
      await sleep(wait + 0.5);
      continue;
    }
    throw errorFor(res.status, text);
  }
}

/* ---------- выбор модели ---------- */
let available: string[] | null = null;

async function pick(list: string[], like?: RegExp) {
  if (!available) available = (await groq<{ data: { id: string }[] }>('/models')).data.map(m => m.id);
  return list.find(m => available!.includes(m)) ?? (like && available.find(m => like.test(m))) ?? null;
}

/** Для /ai-check: какие модели будут работать (ключ не раскрывается) */
export async function checkGroq() {
  if (!GROQ_API_KEY()) return { configured: false };
  try {
    const chat = await pick(CHAT_MODELS);
    const vision = await pick(VISION_MODELS, LOOKS_VISUAL);
    let reply = '';
    let seen = '';
    if (vision) {
      const { PROBE_PNG } = await import('./probe_image.ts');
      const probe = { file: { id: 'probe', name: 'probe.png', type: 'photo' as const }, mime: 'image/png', base64: PROBE_PNG };
      seen = (await readImage(probe).catch(e => `ошибка: ${e}`)).slice(0, 120);
    }
    if (chat) {
      const res = await groq<ChatResponse>('/chat/completions', {
        model: chat,
        messages: [{ role: 'user', content: 'Скажи одним словом: ок' }],
        max_completion_tokens: 512,
      });
      reply = String(res.choices?.[0]?.message?.content ?? '').slice(0, 40);
    }
    return { configured: true, chat, vision, reply, seen, models: available };
  } catch (e) {
    return { configured: true, error: e instanceof AiError ? `${e.kind}: ${e.message.slice(0, 200)}` : String(e) };
  }
}

/* ---------- документы → текст ---------- */
async function readPdf(a: Attachment) {
  const { extractText, getDocumentProxy } = await import('npm:unpdf@1.9.0');
  const bytes = Uint8Array.from(atob(a.base64!), c => c.charCodeAt(0));
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return String(text ?? '');
}

async function readImage(a: Attachment) {
  const model = await pick(VISION_MODELS, LOOKS_VISUAL);
  if (!model) return '';
  const res = await groq<ChatResponse>('/chat/completions', {
    model,
    max_completion_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Это фото или скриншот документа: договор, график платежей, выписка или экран банковского приложения. ' +
            'Перепиши дословно весь текст, сохраняя суммы, даты, проценты и строки таблиц. Ничего не добавляй от себя.',
        },
        { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.base64}` } },
      ],
    }],
  });
  return String(res.choices?.[0]?.message?.content ?? '');
}

async function attachmentText(a: Attachment) {
  let text = a.text ?? '';
  if (!text && a.mime === 'application/pdf') text = await readPdf(a).catch(() => '');
  if (!text && a.mime.startsWith('image/')) text = await readImage(a);
  text = text.trim();
  return text
    ? `Файл «${a.file.name}» (текст извлечён автоматически):\n${text.slice(0, 60_000)}`
    : `Файл «${a.file.name}»: текст извлечь не удалось — похоже, это скан. Попроси прислать фото страниц.`;
}

/* ---------- разговор ---------- */
export async function runGroq({ history, context, attachments, userText, ctx }: RunArgs): Promise<string> {
  const model = await pick(CHAT_MODELS);
  if (!model) throw new AiError('down', 'Нет подходящей модели Groq');
  const docs = [];
  for (const a of attachments) docs.push(await attachmentText(a));

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    ...history.map(h => ({ role: h.role, content: h.text }) as ChatMessage),
    { role: 'user', content: [context, ...docs, userText].join('\n\n') },
  ];

  let retries = 0;
  for (let turn = 0; turn < 10; turn++) {
    let res: ChatResponse;
    try {
      res = await groq<ChatResponse>('/chat/completions', { model, messages, tools, tool_choice: 'auto', max_completion_tokens: 8192 });
    } catch (e) {
      // Модель иногда ошибается в формате вызова инструмента — Groq отвечает 400 tool_use_failed; просим ещё раз
      if (e instanceof AiError && e.kind === 'bad' && /tool_use_failed/.test(e.message) && retries++ < 2) continue;
      throw e;
    }
    const msg = res.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) return String(msg?.content ?? '').trim();

    messages.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: calls });
    for (const call of calls) {
      let args: unknown = null;
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch { /* разберём ниже как ошибку */ }
      const r = args === null
        ? { content: 'Аргументы не разобрались как JSON, вызови инструмент ещё раз', isError: true }
        : await runTool(call.function.name, args, ctx);
      messages.push({ role: 'tool', tool_call_id: call.id, content: r.isError ? `Ошибка: ${r.content}` : r.content });
    }
  }
  return '';
}
