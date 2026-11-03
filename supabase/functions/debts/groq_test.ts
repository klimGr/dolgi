// Groq как запасной ИИ: ключ Google не подошёл → отвечает Groq; фото читает модель со зрением.
// deno test --allow-env supabase/functions/debts/groq_test.ts
import { assert, geminiRequests, geminiScript, groqRequests, groqScript, type Row, tables } from './test_mocks.ts';

const { chat } = await import('./assistant.ts');
const me = { id: '42', name: 'Клим' };
const answer = (message: Row) => ({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });
const bad = { status: 401, body: '{"error":{"status":"UNAUTHENTICATED","message":"API key not valid"}}' };

Deno.test({ name: 'Groq: ключ Google не подошёл — отвечает Groq, фото читает модель со зрением', sanitizeOps: false, sanitizeResources: false }, async () => {
  Deno.env.set('GEMINI_API_KEY', 'AQ.broken-key');
  Deno.env.set('GROQ_API_KEY', 'gsk_test');
  Deno.env.delete('DEBTS_GEMINI_MODEL');
  Deno.env.delete('DEBTS_AI');

  // Google: все три способа передать ключ — 401
  geminiScript.push(bad, bad, bad);
  groqScript.push(
    answer({ content: 'ДОГОВОР ЗАЙМА. Сумма 10 000 руб. Вернуть до 15.11.2026. Продление 1 200 руб.' }), // фото → текст
    answer({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_debt', arguments: JSON.stringify({ name: 'Займ у жены', kind: 'other', balance: 10000, min_payment: 10000, next_payment: '2026-11-15', notes: 'Продление — 1 200 ₽' }) } }] }),
    answer({ content: 'Записал займ **10 000 ₽** до 15 ноября.' }),
  );
  const r = await chat({
    chatId: 42, me, text: '',
    attachments: [{ file: { id: 'P1', name: 'Фото', type: 'photo' }, mime: 'image/jpeg', base64: '/9j/4AAQ' }],
  });
  assert(r.changed && r.reply.includes('10 000'), 'ответ: ' + JSON.stringify(r));
  const d = tables.debts.find(x => x.name === 'Займ у жены');
  assert(d && Number(d.balance) === 10000 && d.pay_day === 15 && JSON.stringify(d.files).includes('P1'), 'долг: ' + JSON.stringify(d));
  assert(geminiRequests.length === 3 && geminiScript.length === 0, 'Google пробовали трижды');

  const [vision, first, second] = groqRequests;
  assert(String(vision.body.model).length > 0 && JSON.stringify(vision.body).includes('image_url'), 'фото → модель со зрением');
  assert(first.body.model === 'openai/gpt-oss-120b' && Array.isArray(first.body.tools), 'главная модель с инструментами');
  assert(vision.headers.get('authorization') === 'Bearer gsk_test', 'ключ Groq');
  const userMsg = (first.body.messages as Row[]).at(-1)!;
  assert(String(userMsg.content).includes('ДОГОВОР ЗАЙМА') && String(userMsg.content).startsWith('Контекст'), 'текст с фото дошёл до модели');
  const msgs = second.body.messages as Row[];
  assert(msgs.at(-2)!.role === 'assistant' && msgs.at(-1)!.role === 'tool' && msgs.at(-1)!.tool_call_id === 'c1', 'результат инструмента');

  // Следующее сообщение: сломанный Google уже не пробуем
  groqScript.push(answer({ content: 'Сейчас у вас один долг — займ 10 000 ₽.' }));
  const before = geminiRequests.length;
  const r2 = await chat({ chatId: 42, me, text: 'сколько мы должны?', attachments: [] });
  assert(r2.reply.includes('10 000') && geminiRequests.length === before, 'Google не пропущен');
  assert(groqScript.length === 0, 'не все ответы использованы');
});

Deno.test({ name: 'Groq: лимит в минуту на фото — ждём и читаем дальше, суточный — отдаём ошибку', sanitizeOps: false, sanitizeResources: false }, async () => {
  const { retryAfter, setSleep } = await import('./groq.ts');
  assert(retryAfter('Please try again in 6.06s.') === 6.06 && retryAfter('try again in 1m2.5s') === 62.5 && retryAfter('nope') === null, 'разбор паузы');

  Deno.env.set('DEBTS_AI', 'groq');
  const waits: number[] = [];
  setSleep(s => (waits.push(s), Promise.resolve()));
  const limited = (s: string) => ({ status: 429, body: `{"error":{"message":"Rate limit reached for model qwen. Please try again in ${s}.","code":"rate_limit_exceeded"}}` });
  groqRequests.length = 0;
  groqScript.push(
    answer({ content: 'Фото 1: Кредитная карта, долг 5 000' }),
    limited('6.06s'), // второе фото упёрлось в лимит минуты
    answer({ content: 'Фото 2: минимальный платёж 500' }),
    answer({ content: 'Вижу карту с долгом 5 000 ₽, минимальный платёж 500 ₽.' }),
  );
  const photo = (id: string) => ({ file: { id, name: 'Фото', type: 'photo' as const }, mime: 'image/jpeg', base64: '/9j/4AAQ' });
  const r = await chat({ chatId: 42, me, text: 'что тут?', attachments: [photo('A1'), photo('A2')] });
  assert(r.reply.includes('500') && waits.length === 1 && waits[0] > 6, 'ждали и дочитали: ' + JSON.stringify({ r, waits }));
  const text = String((groqRequests.at(-1)!.body.messages as Row[]).at(-1)!.content);
  assert(text.includes('Фото 1') && text.includes('Фото 2'), 'оба фото дошли до модели');

  groqScript.push(limited('12m30s'));
  let kind = '';
  await chat({ chatId: 42, me, text: 'ещё', attachments: [] }).catch(e => kind = e.kind);
  assert(kind === 'rate' && groqScript.length === 0, 'долгий лимит не ждём: ' + kind);
  Deno.env.delete('DEBTS_AI');
});
