// Правила бота, которые выполняются кодом: дубли, подтверждения, исправление истории, проверка без записи.
import { assert, geminiRequests, geminiScript, type Row, tables } from './test_mocks.ts';

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

  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 5000, confirmed: true }), say('Готово.'));
  const r2 = await send(7, 'да, это другой');
  assert(r2.changed && r2.reply.includes('Готово.') && flat(r2.reply).includes('платёж 5 000'), 'ответ: ' + r2.reply);
  assert(tables.debt_events.length === 2 && Number(tables.debts[0].balance) === 71300, 'платёж записан');
});

Deno.test({ name: 'Бот: confirmed без вопроса в прошлом сообщении не срабатывает', ...opts }, async () => {
  setup();
  const d = await card();
  await svc.pay(d.id, 3700, undefined, 'Клим');
  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 5000, confirmed: true }), say('Записал!'));
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

  const r2 = await send(12, 'да');
  assert(r2.changed && tables.debt_events.length === 1 && Number(tables.debt_events[0].amount) === 4900, 'одна запись');
  assert(Number(tables.debts[0].balance) === 75100 && flat(r2.reply).includes('исправлен на 4 900'), 'ответ: ' + r2.reply);
});

const photo = [{ file: { id: 'F1', name: 'Фото', type: 'photo' as const }, mime: 'image/jpeg', base64: '/9j/4AAQ' }];

Deno.test({ name: 'Бот: скрин — один вопрос «было → станет», после «да» вносит те же цифры без ИИ', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('update_debt', { debt_id: d.id, balance: 68321.48, limit: 76000 }), say('Записал.'));
  const r = await chat({ chatId: 20, me, text: '', attachments: photo });
  const t = flat(r.reply);
  assert(!r.changed && t.includes('остаток 80 000 ₽ → 68 321,48 ₽') && t.includes('лимит 76 000 ₽') && t.includes('Вношу?') && !t.includes('Записал'), 'вопрос: ' + t);
  assert(!tables.debt_events?.length && Number(tables.debts[0].balance) === 80000, 'до ответа база не меняется');

  const r2 = await send(20, 'да');
  assert(r2.changed && geminiScript.length === 0 && Number(tables.debts[0].balance) === 68321.48 && Number(tables.debts[0].credit_limit) === 76000, 'внесено: ' + r2.reply);
  assert(JSON.stringify(tables.debts[0].files).includes('F1') && r2.reply.startsWith('✓'), 'скрин прикреплён: ' + r2.reply);
});

Deno.test({ name: 'Бот: на вопрос ответили «нет» или поправили цифру', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 70000 }), say('Ок'));
  await chat({ chatId: 21, me, text: '', attachments: photo });
  const no = await send(21, 'нет');
  assert(!no.changed && no.reply.includes('ничего не меняю') && Number(tables.debts[0].balance) === 80000, 'нет: ' + no.reply);

  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 70000 }), say('Ок'));
  await chat({ chatId: 21, me, text: '', attachments: photo });
  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 68300, confirmed: true }), say('Поправил.'));
  const fix = await send(21, 'нет, там 68300');
  assert(fix.changed && Number(tables.debts[0].balance) === 68300, 'поправка: ' + fix.reply);
});

Deno.test({ name: 'Бот: обычное сообщение записывает сразу, а спорные цифры уточняет', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 3700 }), say('Записал.'));
  const ok = await send(22, 'заплатил 3700');
  assert(ok.changed && Number(tables.debts[0].balance) === 76300, 'без лишних вопросов: ' + ok.reply);

  const big = await svc.createDebt({ name: 'Втб', kind: 'card', balance: 20000, limit: 30000, minPayment: 1000, payDay: 20 });
  geminiScript.push(call('record_payment', { debt_id: big.id, amount: 25000 }), say('Записал.'));
  const over = await send(23, 'заплатил 25000 по втб');
  assert(!over.changed && flat(over.reply).includes('больше, чем осталось'), 'больше остатка: ' + over.reply);

  geminiScript.push(call('set_balance', { debt_id: big.id, balance: 40000 }), say('Записал.'));
  const limit = await send(24, 'по втб сейчас 40000');
  assert(!limit.changed && flat(limit.reply).includes('больше лимита'), 'выше лимита: ' + limit.reply);

  geminiScript.push(call('set_balance', { debt_id: big.id, balance: 19000 }), say('Обновил.'));
  const small = await send(25, 'по втб сейчас 19000');
  assert(small.changed && Number(tables.debts.find(x => x.id === big.id)!.balance) === 19000, 'обычная правка: ' + small.reply);
});

Deno.test({ name: 'Бот: модель отказала после вопроса или записи — человек всё равно получает итог', ...opts }, async () => {
  setup();
  const d = await card();
  const down = { status: 503, body: '{"error":{"status":"UNAVAILABLE"}}' };
  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 3700 }), down);
  const paid = await send(30, 'заплатил 3700');
  assert(paid.changed && flat(paid.reply).includes('платёж 3 700'), 'запись: ' + paid.reply);

  geminiScript.push(call('record_payment', { debt_id: d.id, amount: 3700 }), down);
  const asked = await send(30, 'заплатил 3700');
  assert(!asked.changed && flat(asked.reply).includes('уже записан') && tables.debt_events.length === 1, 'вопрос: ' + asked.reply);
});

Deno.test({ name: 'Бот: «да» на вчерашний вопрос ничего не вносит', ...opts }, async () => {
  setup();
  const d = await card();
  geminiScript.push(call('set_balance', { debt_id: d.id, balance: 70000 }), say('Ок'));
  await chat({ chatId: 31, me, text: '', attachments: photo });
  const last = tables.debt_chat.at(-1)!;
  last.text = String(last.text).replace(/"at":\d+/, '"at":1');
  geminiScript.push(say('О чём именно речь?'));
  const r = await send(31, 'да');
  assert(!r.changed && Number(tables.debts[0].balance) === 80000 && r.reply === 'О чём именно речь?', 'ответ: ' + r.reply);
});

Deno.test({ name: 'Правка долга: день платежа 30-го и ставка с тремя знаками не портятся', ...opts }, async () => {
  setup();
  const d = await svc.createDebt({ name: 'Альфа', kind: 'card', balance: 1000, minPayment: 100, rate: 81.406, payDay: 30 });
  assert(Number(tables.debts[0].rate) === 81.406, 'ставка при создании: ' + tables.debts[0].rate);
  tables.debts[0].paid_due = '2027-01-30'; // следующий срок — 28 февраля
  await svc.updateDebt(d.id, { nextPayment: '2027-02-28', notes: 'заметка' }, 'Клим');
  assert(tables.debts[0].pay_day === 30 && tables.debts[0].paid_due === '2027-01-30', 'график: ' + JSON.stringify(tables.debts[0]));
  await svc.updateDebt(d.id, { nextPayment: '2027-03-10' }, 'Клим');
  assert(tables.debts[0].pay_day === 10, 'новая дата меняет график');
});

Deno.test({ name: 'Бот: в контексте есть готовые цифры для наблюдений', ...opts }, async () => {
  setup();
  await svc.createDebt({ name: 'Яндекс', kind: 'loan', balance: 50000, rate: 80, minPayment: 3000, payDay: 17 });
  geminiRequests.length = 0;
  geminiScript.push(say('Привет!'));
  await send(26, 'привет');
  const text = JSON.stringify(geminiRequests[0].body.contents);
  assert(text.includes('Наблюдения') && text.includes('дороже всего обходится Яндекс') && text.includes('платёж меньше процентов: Яндекс'), text.slice(-400));
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
