// deno test --allow-env supabase/functions/debts/telegram_test.ts
Deno.env.set('DEBTS_BOT_TOKEN', '123456:TEST-token');
const { verifyInitData } = await import('./telegram.ts');
const { toTelegramHtml } = await import('./format.ts');

const enc = new TextEncoder();
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** Собираем initData так, как это делает Telegram */
async function sign(fields: Record<string, string>, token = '123456:TEST-token') {
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), token);
  const hash = [...await hmac(secret, check)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = String(Math.floor(Date.now() / 1000));
const user = JSON.stringify({ id: 42, first_name: 'Клим' });

Deno.test('подпись Telegram принимается', async () => {
  const u = await verifyInitData(await sign({ auth_date: now, query_id: 'AAA', user }));
  if (u?.id !== 42 || u.first_name !== 'Клим') throw new Error('пользователь не распознан');
});

Deno.test('подделка и чужой токен отклоняются', async () => {
  const good = await sign({ auth_date: now, user });
  const forged = good.replace('%22id%22%3A42', '%22id%22%3A43');
  if (forged === good) throw new Error('тест не подменил id');
  if (await verifyInitData(forged)) throw new Error('подделка прошла');
  if (await verifyInitData(await sign({ auth_date: now, user }, '999:other'))) throw new Error('чужой токен прошёл');
  if (await verifyInitData('')) throw new Error('пустая строка прошла');
});

Deno.test('старая подпись отклоняется', async () => {
  const old = String(Math.floor(Date.now() / 1000) - 40 * 86400);
  if (await verifyInitData(await sign({ auth_date: old, user }))) throw new Error('просроченная подпись прошла');
});

Deno.test('ответ модели безопасно превращается в HTML', () => {
  const html = toTelegramHtml('**Итого:** 5 000 ₽ <script>\n- пункт');
  if (html !== '<b>Итого:</b> 5 000 ₽ &lt;script&gt;\n• пункт') throw new Error(html);
});
