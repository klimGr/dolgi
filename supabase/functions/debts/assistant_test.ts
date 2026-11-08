// Правила бота, которые выполняются кодом: дубли, подтверждения, исправление истории, проверка без записи.
import { assert, geminiScript, type Row, tables } from './test_mocks.ts';

const { chat } = await import('./assistant.ts');
const svc = await import('./service.ts');
const { forgetChoice } = await import('./gemini.ts');

const me = { id: '42', name: 'Клим' };
const reply = (parts: Row[]) => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] });
const call = (name: string, args: Row) => reply([{ functionCall: { name, args } }]);
const say = (text: string) => reply([{ text }]);
const flat = (s: string) => s.replace(/ /g, ' ');
const opts = { sanitizeOps: false, sanitizeResources: false };
const send = (chatId: number, text: string) => chat({ chatId, me, text, attachments: [] });

function setup() {
  forgetChoice();
  for (const k of Object.keys(tables)) delete tables[k];
  geminiScript.length = 0;
  Deno.env.set('GEMINI_API_KEY', 'gemini-test-key');
  Deno.env.set('DEBTS_GEMINI_MODEL', 'gemini-flash-latest');
  Deno.env.delete('DEBTS_AI');
  Deno.env.delete('ANTHROPIC_API_KEY');
  Deno.env.delete('GROQ_API_KEY');
}

const card = () => svc.createDebt({ name: 'Тбанк', kind: 'card', balance: 80000, minPayment: 3700, payDay: 7 });

Deno.test({ name: 'Бот: второй платёж рядом по дате записывает только после ответа человека', ...opts }, async () => {
  setup();
  const d = await card();
  await svc.pay(d.id, 3700, undefined, 'Клим');

  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 5000 }), say('Записал!'));
  const r = await send(7, 'внес 5000');
  assert(!r.changed && flat(r.reply).includes('уже записан платёж 3 700') && !r.reply.includes('Записал!'), 'ответ: ' + r.reply);
  assert(tables.debt_events.length === 1 && Number(tables.debts[0].balance) === 76300, 'база не должна меняться');
  assert(!r.reply.includes('⟦'), 'метку человек не видит');

  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 5000, confirmed_new: true }), say('Готово.'));
  const r2 = await send(7, 'да, это другой');
  assert(r2.changed && r2.reply.includes('Готово.') && flat(r2.reply).includes('платёж 5 000'), 'ответ: ' + r2.reply);
  assert(tables.debt_events.length === 2 && Number(tables.debts[0].balance) === 71300, 'платёж записан');
});

Deno.test({ name: 'Бот: confirmed_new без вопроса в прошлом сообщении не срабатывает', ...opts }, async () => {
  setup();
  const d = await card();
  await svc.pay(d.id, 3700, undefined, 'Клим');
  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 5000, confirmed_new: true }), say('Записал!'));
  const r = await send(8, 'внес 5000');
  assert(!r.changed && tables.debt_events.length === 1, 'записал без вопроса: ' + r.reply);
});

Deno.test({ name: 'Бот: тот же остаток не создаёт пустую запись', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 80000, note: 'Корректировка' }), say('Остаток совпадает.'));
  const r = await send(9, 'вот скрин');
  assert(!r.changed && !tables.debt_events?.length && r.reply === 'Остаток совпадает.', 'ответ: ' + r.reply);
});

Deno.test({ name: 'Бот: новый остаток — точная строка с копейками', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 68321.48 }), say('Обновил по скрину.'));
  const r = await send(10, 'вот скрин');
  assert(r.changed && flat(r.reply).endsWith('остаток 80 000 ₽ → 68 321,48 ₽'), 'ответ: ' + r.reply);
});

Deno.test({ name: 'Бот: удаление записи — сначала «было → станет», срок возвращается', ...opts }, async () => {
  setup();
  const d = await card();
  const before = (await svc.pay(d.id, 3700, undefined, 'Клим')).event;
  const paidDue = tables.debts[0].paid_due;

  geminiScript.push(call('delete_event', { event_id: before.id, confirmed: true }), say('Удалил.'));
  const r = await send(11, 'удали этот платёж');
  assert(!r.changed && flat(r.reply).includes('Остаток станет 80 000 ₽') && tables.debt_events.length === 1, 'спросить до удаления: ' + r.reply);

  geminiScript.push(call('delete_event', { event_id: before.id, confirmed: true }), say('Удалил.'));
  const r2 = await send(11, 'да');
  assert(r2.changed && !tables.debt_events.length && Number(tables.debts[0].balance) === 80000, 'удалено: ' + r2.reply);
  assert(before.dueAfter === before.dueBefore || tables.debts[0].paid_due !== paidDue, 'срок вернулся');
});

Deno.test({ name: 'Бот: исправление суммы платежа', ...opts }, async () => {
  setup();
  const d = await card();
  const e = (await svc.pay(d.id, 3700, undefined, 'Клим')).event;

  geminiScript.push(call('edit_payment', { event_id: e.id, amount: 4900 }), say('Ок'));
  const r = await send(12, 'платёж был 4900');
  assert(flat(r.reply).includes('→ 4 900 ₽') && flat(r.reply).includes('Остаток станет 75 100 ₽') && Number(tables.debts[0].balance) === 76300, 'превью: ' + r.reply);

  geminiScript.push(call('edit_payment', { event_id: e.id, amount: 4900, confirmed: true }), say('Исправил.'));
  const r2 = await send(12, 'да');
  assert(r2.changed && tables.debt_events.length === 1 && Number(tables.debt_events[0].amount) === 4900, 'одна запись');
  assert(Number(tables.debts[0].balance) === 75100 && flat(r2.reply).includes('исправлен на 4 900'), 'ответ: ' + r2.reply);
});

Deno.test({ name: 'Бот: проверка без записи ничего не меняет и показывает вызовы', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 1000 }), say('Записал.'));
  const r = await chat({ chatId: 0, me, text: 'внес 1000', attachments: [], dry: true });
  assert(!r.changed && !tables.debt_events?.length && Number(tables.debts[0].balance) === 80000, 'база изменилась');
  assert(!tables.debt_chat?.length, 'проверка не должна попасть в переписку');
  assert(r.calls.length === 1 && r.calls[0].name === 'record_payment' && r.calls[0].result.includes('dry_run'), 'вызовы: ' + JSON.stringify(r.calls));
});

Deno.test({ name: 'Бот: план погашения и нехватка на минимальные платежи', ...opts }, async () => {
  setup();
  await card();
  geminiScript.push(call('plan_payoff', { monthly_budget: 1000 }), say('Не хватает.'));
  const r = await send(13, 'плачу 1000 в месяц');
  const low = JSON.parse(r.calls[0].result);
  assert(low.enough === false && low.shortfall === 2700, 'нехватка: ' + r.calls[0].result);

  geminiScript.push(call('plan_payoff', { monthly_budget: 10000 }), say('План готов.'));
  const r2 = await send(13, 'плачу 10000 в месяц');
  const plan = JSON.parse(r2.calls[0].result);
  assert(plan.enough === true && plan.avalanche.months === 8, 'расчёт: ' + r2.calls[0].result);
  assert(plan.by_month.length === 3 && plan.by_month.some((m: Row) => Number(m.must_pay) === 3700) && plan.by_month.every((m: Row) => m.gap === 0), 'по месяцам: ' + JSON.stringify(plan.by_month));
});
