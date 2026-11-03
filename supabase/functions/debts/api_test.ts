// API мини-приложения без сети: подпись initData, сохранение долга, платёж, отказ чужим.
// deno test --allow-env supabase/functions/debts/api_test.ts
import { assert, tables } from './test_mocks.ts';
const { handleApi } = await import('./api.ts');

const enc = new TextEncoder();
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
async function initData(id: number, name: string) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: name }) };
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const hash = [...await hmac(await hmac(enc.encode('WebAppData'), '1:TEST'), check)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new URLSearchParams({ ...fields, hash }).toString();
}

Deno.test('приложение: долг, платёж, история; чужим — 403', async () => {
  const auth = await initData(42, 'Клим');
  // deno-lint-ignore no-explicit-any
  const call = async (body: Record<string, unknown>) => (await handleApi({ initData: auth, ...body })) as { status: number; data: any };

  let r = await call({ action: 'save_debt', debt: { name: 'Сбер', kind: 'loan', owner: 'common', balance: 412000, start: 600000, minPayment: 18900, rate: 19.5, nextPayment: '2030-01-25', color: 1 } });
  assert(r.status === 200, 'save: ' + JSON.stringify(r.data));
  const d = r.data.debts[0];
  assert(d.start === 600000 && d.payDay === 25 && d.minPayment === 18900, 'форма долга для app.js: ' + JSON.stringify(d));
  assert(r.data.me.id === '42' && r.data.me.subscribed === false && r.data.bot === 'test_bot', 'me/bot: ' + JSON.stringify(r.data.me));

  r = await call({ action: 'pay', debtId: d.id, amount: 18900, date: r.data.today });
  assert(r.data.debts[0].balance === 393100 && r.data.events.length === 1, 'платёж: ' + JSON.stringify(r.data.debts[0]));

  r = await call({ action: 'delete_event', id: r.data.events[0].id });
  assert(r.data.debts[0].balance === 412000 && r.data.events.length === 0, 'отмена платежа');

  r = await call({ action: 'save_debt', debt: { id: d.id, name: 'Сбер', kind: 'loan', owner: 'common', balance: 400000, payDay: null } });
  assert(r.data.debts[0].payDay === null && r.data.events[0].type === 'balance', 'правка: ' + JSON.stringify(r.data.debts[0]));

  const stranger = await handleApi({ initData: await initData(99, 'Чужой'), action: 'state' });
  assert(stranger.status === 403, 'чужой получил доступ');
  const forged = await handleApi({ initData: auth.replace('42', '43'), action: 'state' });
  assert(forged.status === 401, 'подделка прошла');
  assert(tables.debts.length === 1, 'лишние записи');
});

Deno.test('служебный ключ: секрет или cron_key из базы', async () => {
  const { isServiceKey } = await import('./db.ts');
  tables.debt_settings = [{ key: 'cron_key', value: 'abc123' }];
  assert(await isServiceKey('abc123', 'secret'), 'cron_key не принят');
  assert(await isServiceKey('secret', 'secret'), 'секрет не принят');
  assert(!(await isServiceKey('wrong', 'secret')), 'чужой ключ принят');
  assert(!(await isServiceKey(null, '')), 'пустой ключ принят');
  assert(!(await isServiceKey('', '')), 'пустой секрет принят');
});
