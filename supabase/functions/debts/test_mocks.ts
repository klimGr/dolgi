// Подмена сети для тестов: PostgREST Supabase в памяти, API Claude (SSE) и Bot API Telegram.
Deno.env.set('SUPABASE_URL', 'http://supabase.test');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('DEBTS_ALLOWED_IDS', '42,43');
Deno.env.set('DEBTS_TZ', 'Europe/Moscow');
Deno.env.set('DEBTS_BOT_TOKEN', '1:TEST');
Deno.env.set('DEBTS_APP_URL', 'https://example.test/debts/');

/* ---------- PostgREST в памяти ---------- */
export type Row = Record<string, unknown>;
export const tables: Record<string, Row[]> = {};
let serial = 0;

function filterRows(rows: Row[], params: URLSearchParams) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter(r => String(r[k]) === v.slice(3));
  }
  return out;
}

async function postgrest(req: Request) {
  const url = new URL(req.url);
  const table = url.pathname.split('/').pop()!;
  const rows = (tables[table] ||= []);
  const prefer = req.headers.get('prefer') || '';
  const single = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  if (req.method === 'GET') {
    let out = filterRows(rows, url.searchParams);
    for (const o of (url.searchParams.get('order') || '').split(',').filter(Boolean).reverse()) {
      const [col, dir] = o.split('.');
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Number(url.searchParams.get('limit') || 0);
    if (limit) out = out.slice(0, limit);
    if (single) return out.length ? reply(out[0]) : reply({ message: 'no rows' }, 406);
    return reply(out);
  }
  if (req.method === 'DELETE') {
    const gone = new Set(filterRows(rows, url.searchParams));
    tables[table] = rows.filter(r => !gone.has(r));
    return reply([]);
  }
  if (req.method === 'PATCH') {
    const patch = await req.json();
    for (const r of filterRows(rows, url.searchParams)) Object.assign(r, patch);
    return reply([]);
  }
  // POST: insert / upsert
  const body = await req.json();
  const list: Row[] = Array.isArray(body) ? body : [body];
  const keys = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
  const inserted: Row[] = [];
  for (const item of list) {
    if (!keys.length && item.id !== undefined && rows.some(r => r.id === item.id)) {
      return reply({ message: 'duplicate key value violates unique constraint' }, 409);
    }
    const found = keys.length ? rows.find(r => keys.every(k => String(r[k]) === String(item[k]))) : undefined;
    if (found) {
      if (!prefer.includes('ignore-duplicates')) Object.assign(found, item);
    } else {
      const row = { created_at: new Date(Date.now() + serial).toISOString(), id: item.id ?? ++serial, ...item };
      serial++;
      rows.push(row);
      inserted.push(row);
    }
  }
  return reply(prefer.includes('return=representation') ? inserted : [], 201);
}

/* ---------- Claude: заранее записанные ответы в виде SSE ---------- */
export const claudeRequests: { headers: Headers; body: Record<string, unknown> }[] = [];
export const script: unknown[][] = [];
export const telegramCalls: { method: string; body: Row }[] = [];
/** Ответы Gemini по очереди: объект JSON ответа или {status, body} для ошибки */
export const geminiScript: (Row | { status: number; body: string })[] = [];
export const geminiRequests: { url: string; headers: Headers; body: Row }[] = [];
/** Groq: список моделей аккаунта и ответы чата по очереди */
export const groqModels: string[] = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'];
export const groqScript: (Row | { status: number; body: string })[] = [];
export const groqRequests: { url: string; headers: Headers; body: Row }[] = [];

function sse(content: unknown[], stop: string) {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let s = ev('message_start', {
    message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
  });
  content.forEach((block, index) => {
    const b = block as Record<string, unknown>;
    if (b.type === 'text') {
      s += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      s += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      s += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      s += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    s += ev('content_block_stop', { index });
  });
  s += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  s += ev('message_stop', {});
  return s;
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith('http://supabase.test/rest/v1/')) return postgrest(req);
  if (req.url.startsWith('https://api.anthropic.com/v1/messages')) {
    claudeRequests.push({ headers: req.headers, body: await req.json() });
    const content = script.shift();
    if (!content) throw new Error('Claude вызван больше раз, чем ожидалось');
    const stop = content.some(b => (b as Row).type === 'tool_use') ? 'tool_use' : 'end_turn';
    return new Response(sse(content, stop), { headers: { 'content-type': 'text/event-stream' } });
  }
  if (req.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/') || req.url.startsWith('https://aiplatform.googleapis.com/v1/publishers/google/models/')) {
    geminiRequests.push({ url: req.url, headers: req.headers, body: await req.json() });
    const next = geminiScript.shift();
    if (!next) throw new Error('Gemini вызван больше раз, чем ожидалось');
    if ('status' in next && typeof next.status === 'number') return new Response(String(next.body), { status: next.status });
    return new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } });
  }
  if (req.url.startsWith('https://api.groq.com/openai/v1/')) {
    if (req.url.endsWith('/models')) return new Response(JSON.stringify({ data: groqModels.map(id => ({ id })) }));
    groqRequests.push({ url: req.url, headers: req.headers, body: await req.json() });
    const next = groqScript.shift();
    if (!next) throw new Error('Groq вызван больше раз, чем ожидалось');
    if ('status' in next && typeof next.status === 'number') return new Response(String(next.body), { status: next.status });
    return new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } });
  }
  if (req.url.startsWith('https://api.telegram.org/bot')) {
    const method = req.url.split('/').pop()!;
    telegramCalls.push({ method, body: await req.json() });
    return new Response(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'test_bot' } : true }));
  }
  throw new Error('Неожиданный запрос ' + req.url);
};

export function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
