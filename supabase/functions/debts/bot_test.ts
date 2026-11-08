// Напоминания и кнопка «Оплачено» без сети.
// deno test --allow-env supabase/functions/debts/bot_test.ts
import { assert, tables, telegramCalls } from './test_mocks.ts';
const { handleUpdate } = await import('./bot.ts');
const { runReminders } = await import('./reminders.ts');
const { addDays, today } = await import('./logic.ts');
const svc = await import('./service.ts');

Deno.test('напоминание за 2 дня, без повторов, и отметка оплаты кнопкой', async () => {
  const t = today('Europe/Moscow');
  // Оба супруга написали боту — у обоих есть chat_id
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 42, first_name: 'Клим' }, chat: { id: 42, type: 'private' }, text: '/start' } });
  await handleUpdate({ update_id: 2, message: { message_id: 2, from: { id: 43, first_name: 'Маша' }, chat: { id: 43, type: 'private' }, text: '/start' } });
  assert(tables.debt_members.length === 2, 'участники не сохранены');
  const start = telegramCalls.filter(c => c.method === 'sendMessage');
  assert(start.length === 2 && JSON.stringify(start[0].body).includes('web_app'), 'приветствие с кнопкой приложения');

  // Чужой человек не получает доступа
  telegramCalls.length = 0;
  await handleUpdate({ update_id: 3, message: { message_id: 3, from: { id: 99, first_name: 'Чужой' }, chat: { id: 99, type: 'private' }, text: 'привет' } });
  assert(String(telegramCalls[0].body.text).includes('99') && tables.debt_members.length === 2, 'чужой получил доступ');

  const d = await svc.createDebt({ name: 'Альфа', kind: 'card', owner: '43', balance: 41250, minPayment: 2500, nextPayment: addDays(t, 2) });

  telegramCalls.length = 0;
  const r1 = await runReminders();
  assert(r1.sent.length === 1 && telegramCalls.length === 2, 'напоминание обоим: ' + JSON.stringify(r1));
  const msg = telegramCalls[0].body;
  assert(String(msg.text).includes('через 2 дня') && String(msg.text).includes('2 500 ₽'), 'текст напоминания: ' + msg.text);
  const pay = (msg.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard[0][0].callback_data!;
  assert(pay === `pay:${d.id}:${addDays(t, 2)}`, 'кнопка оплаты: ' + pay);

  telegramCalls.length = 0;
  const r2 = await runReminders();
  assert(r2.sent.length === 0 && telegramCalls.length === 0, 'повторное напоминание');

  // Маша нажала «Оплачено»
  await handleUpdate({ update_id: 4, callback_query: { id: 'cb1', from: { id: 43, first_name: 'Маша' }, data: pay, message: { message_id: 10, chat: { id: 43 } } } });
  const saved = tables.debts.find(x => x.id === d.id)!;
  assert(Number(saved.balance) === 38750, 'остаток после кнопки: ' + saved.balance);
  assert(telegramCalls.some(c => c.method === 'editMessageText' && String(c.body.text).includes('Маша')), 'сообщение не обновлено');

  // Повторное нажатие не списывает второй раз
  await handleUpdate({ update_id: 5, callback_query: { id: 'cb2', from: { id: 42, first_name: 'Клим' }, data: pay, message: { message_id: 11, chat: { id: 42 } } } });
  assert(Number(tables.debts.find(x => x.id === d.id)!.balance) === 38750, 'двойное списание');
  assert(telegramCalls.some(c => c.method === 'answerCallbackQuery' && String(c.body.text).includes('уже')), 'нет ответа «уже отмечено»');
});

Deno.test('карта без минимального платежа: кнопка не списывает весь долг, а спрашивает сумму', async () => {
  const t = today('Europe/Moscow');
  const d = await svc.createDebt({ name: 'Альфа Лера', kind: 'card', owner: '43', balance: 163904, nextPayment: addDays(t, 2) });
  telegramCalls.length = 0;
  await runReminders();
  const msg = telegramCalls.find(c => c.method === 'sendMessage' && String(c.body.text).includes('Альфа Лера'))!.body;
  assert(String(msg.text).includes('сумма не указана') && !String(msg.text).includes('163 904 ₽</b>'), 'текст: ' + msg.text);
  const btn = (msg.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard[0][0];
  assert(btn.callback_data === `other:${d.id}` && btn.text.includes('указать сумму'), 'кнопка: ' + JSON.stringify(btn));

  // Старая кнопка «pay:» из прошлого напоминания тоже ничего не списывает
  await handleUpdate({ update_id: 9, callback_query: { id: 'cb9', from: { id: 43, first_name: 'Маша' }, data: `pay:${d.id}:${addDays(t, 2)}`, message: { message_id: 12, chat: { id: 43 } } } });
  assert(Number(tables.debts.find(x => x.id === d.id)!.balance) === 163904, 'весь долг списан одной кнопкой');
});

Deno.test('бот просит свежую выписку у владельца карты, один раз', async () => {
  const t = today('Europe/Moscow');
  const day = Number(addDays(t, -1).slice(8, 10));
  await svc.createDebt({ name: 'Альфа Маша', kind: 'card', owner: '43', balance: 1000, minPayment: 100, statementDay: day });
  telegramCalls.length = 0;
  const r1 = await runReminders();
  assert(r1.asked.some(x => x.startsWith('Альфа Маша')), 'выписку не попросили: ' + JSON.stringify(r1.asked));
  const asks = telegramCalls.filter(c => c.method === 'sendMessage' && String(c.body.text).includes('Альфа Маша') && String(c.body.text).includes('выписку'));
  assert(asks.length === 1 && asks[0].body.chat_id === 43, 'только владельцу: ' + JSON.stringify(asks.map(c => c.body.chat_id)));
  assert(tables.debt_chat.some(r => r.chat_id === 43 && String(r.text).includes('выписку')), 'в истории разговора');
  const r2 = await runReminders();
  assert(!r2.asked.some(x => x.startsWith('Альфа Маша')), 'попросили дважды');
});

Deno.test('напоминания начисляют проценты по займу и пишут одну запись за месяц', async () => {
  const t = today('Europe/Moscow');
  const d = await svc.createDebt({ name: 'Заём', kind: 'microloan', owner: '43', balance: 10000, rate: 365, principal: 10000 });
  assert(d.accruedTo === t, 'отсчёт с сегодня: ' + d.accruedTo);
  const row = tables.debts.find(r => r.id === d.id)!;
  row.accrued_to = addDays(t, -2);
  await runReminders();
  assert(Number(row.balance) === 10200, 'начислено за 2 дня: ' + row.balance);
  assert(row.accrued_to === t, 'дата начисления');
  const interest = tables.debt_events.filter(e => e.debt_id === d.id && e.type === 'interest');
  assert(interest.length === 1 && Number(interest[0].amount) === 200, 'запись: ' + JSON.stringify(interest));
  row.accrued_to = addDays(t, -1);
  await runReminders();
  const again = tables.debt_events.filter(e => e.debt_id === d.id && e.type === 'interest');
  assert(again.length === 1 && Number(again[0].amount) === 300 && Number(again[0].delta) === 300, 'та же запись копится: ' + JSON.stringify(again));
  assert(Number(row.balance) === 10300, 'остаток: ' + row.balance);
});
