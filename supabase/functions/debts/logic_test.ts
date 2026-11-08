// deno test supabase/functions/debts/logic_test.ts
import {
  accrue, amountOn, applyBalance, applyPayment, type Debt, type DebtEvent, dueAmount, dueIn, dueOnOrAfter, freeBy, lumpSum, monthlyMin, nearPayments, nextDue,
  payoffMonths, perDay, prevDue, revertEvent, setSchedule, simulatePayoff, statementAsk, totals,
} from './logic.ts';

function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} ожидали ${e}, получили ${a}`);
}

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: 'd1', name: 'Карта', kind: 'card', owner: 'common', creditor: '', color: 1,
  start: 100000, balance: 80000, limit: 150000, rate: 36, minPayment: 5000, payDay: 15,
  paidDue: null, endDate: null, notes: '', files: [], closed: false, createdAt: '2026-11-02T10:00:00Z',
  ...over,
});

Deno.test('даты платежей и короткие месяцы', () => {
  eq(dueIn(2026, 1, 31), '2026-02-28');
  eq(dueIn(2026, 12, 5), '2027-01-05', 'переход года');
  eq(dueOnOrAfter('2026-11-02', 15), '2026-11-15');
  eq(dueOnOrAfter('2026-11-16', 15), '2026-12-15');
  eq(dueOnOrAfter('2026-11-15', 15), '2026-11-15');
  eq(prevDue('2026-03-31', 31), '2026-02-28');
  eq(prevDue('2026-01-10', 10), '2025-12-10');
});

Deno.test('график: по числу и по дате ближайшего платежа', () => {
  const d = debt();
  setSchedule(d, '2026-11-02', 15);
  eq(nextDue(d, '2026-11-02'), '2026-11-15');
  setSchedule(d, '2026-11-02', 1);
  eq(nextDue(d, '2026-11-02'), '2026-12-01', 'число уже прошло — следующий месяц');
  setSchedule(d, '2026-11-02', null, '2026-10-28');
  eq(nextDue(d, '2026-11-02'), '2026-10-28', 'просроченный платёж виден');
});

Deno.test('платёж закрывает срок и двигает следующий', () => {
  const d = debt();
  setSchedule(d, '2026-11-02', 15);
  const events: DebtEvent[] = [];
  const e1 = applyPayment(d, events, 3000, '2026-11-05', 'Клим', '', '2026-11-05');
  events.push(e1);
  eq(d.balance, 77000);
  eq(nextDue(d, '2026-11-05'), '2026-11-15', 'неполный платёж срок не закрывает');
  const e2 = applyPayment(d, events, 2000, '2026-11-06', 'Клим', '', '2026-11-06');
  events.push(e2);
  eq(nextDue(d, '2026-11-06'), '2026-12-15', 'набрали минимум частями');
  const e3 = applyPayment(d, events, 5000, '2026-11-07', 'Клим', '', '2026-11-07');
  events.push(e3);
  eq(nextDue(d, '2026-11-07'), '2026-12-15', 'досрочный платёж в том же периоде не закрывает следующий месяц');
  revertEvent(d, e2);
  eq(d.balance, 72000);
  eq(nextDue(d, '2026-11-07'), '2026-11-15', 'отмена возвращает срок');
});

Deno.test('платёж после срока не считается второй раз за следующий месяц', () => {
  const d = debt({ balance: 80000, minPayment: 3700, payDay: 7, paidDue: '2026-10-07' });
  const events: DebtEvent[] = [];
  events.push(applyPayment(d, events, 3700, '2026-11-08', 'Клим', '', '2026-11-08'));
  eq(nextDue(d, '2026-11-08'), '2026-12-07', 'ноябрьский срок закрыт');
  events.push(applyPayment(d, events, 200, '2026-11-10', 'Клим', '', '2026-11-10'));
  eq(nextDue(d, '2026-11-10'), '2026-12-07', 'маленькая доплата декабрь не закрывает');
});

Deno.test('план погашения: лавина не дороже снежного кома, займ МФО не входит в минимум', () => {
  const cheap = debt({ id: 'a', name: 'Большой дешёвый', balance: 100000, rate: 20, minPayment: 3000 });
  const costly = debt({ id: 'b', name: 'Малый дорогой', balance: 30000, rate: 60, minPayment: 1500 });
  const a = simulatePayoff([cheap, costly], 15000, 'avalanche', '2026-11-08');
  const s = simulatePayoff([cheap, costly], 15000, 'snowball', '2026-11-08');
  eq(a.order[0].name, 'Малый дорогой', 'лавина начинает с дорогого');
  if (a.interest > s.interest || a.months === null) throw new Error(`лавина ${a.interest}, ком ${s.interest}`);
  eq(simulatePayoff([cheap], 1000, 'avalanche', '2026-11-08').months, null, 'платёж меньше процентов');
  eq(simulatePayoff([], 1000, 'avalanche', '2026-11-08').months, 0, 'долгов нет');
  const noRate = debt({ id: 'c', name: 'Займ без ставки', kind: 'microloan', balance: 9655, rate: null, minPayment: 9655 });
  eq(simulatePayoff([cheap, costly, noRate], 15000, 'avalanche', '2026-11-08').order[0], { name: 'Займ без ставки', month: '2026-11' }, 'займ МФО первым, даже без ставки');
  eq(simulatePayoff([cheap, costly, noRate], 15000, 'snowball', '2026-11-08').order[0].name, 'Займ без ставки');
  eq(monthlyMin(debt({ kind: 'microloan', minPayment: 14812 })), 0);
  eq(monthlyMin(debt({ minPayment: null, balance: 1000 })), 50, 'неизвестный минимум');
});

Deno.test('похожие платежи ищем в окне трёх дней и только по этому долгу', () => {
  const pay = (id: string, debtId: string, date: string, type: DebtEvent['type'] = 'payment') =>
    ({ id, debtId, type, amount: 100, delta: -100, date, by: '', note: '', dueBefore: null, dueAfter: null, createdAt: '' });
  const list = [pay('1', 'd1', '2026-11-05'), pay('2', 'd1', '2026-11-04'), pay('3', 'd2', '2026-11-08'), pay('4', 'd1', '2026-11-08', 'charge')];
  eq(nearPayments(list, 'd1', '2026-11-08').map(e => e.id), ['1']);
});

Deno.test('просрочка закрывается поздним платежом', () => {
  const d = debt({ kind: 'loan' });
  setSchedule(d, '2026-11-02', null, '2026-10-28');
  applyPayment(d, [], 5000, '2026-11-02', '', '', '2026-11-02');
  eq(nextDue(d, '2026-11-02'), '2026-11-28');
});

Deno.test('кредит закрывается, карта — нет', () => {
  const loan = debt({ kind: 'loan', balance: 4000 });
  applyPayment(loan, [], 4000, '2026-11-02', '', '', '2026-11-02');
  eq([loan.balance, loan.closed], [0, true]);
  const card = debt({ balance: 4000 });
  applyPayment(card, [], 4000, '2026-11-02', '', '', '2026-11-02');
  eq([card.balance, card.closed], [0, false]);
  eq(nextDue(card, '2026-11-02'), null, 'нулевой долг без платежей');
});

Deno.test('рост долга выше старта сдвигает 100 %', () => {
  const d = debt();
  applyBalance(d, 120000, '2026-11-02', '', '');
  eq([d.balance, d.start], [120000, 120000]);
});

Deno.test('сводка и прогноз', () => {
  const list = [debt(), debt({ id: 'd2', start: 100000, balance: 20000, rate: 0, minPayment: 10000 })];
  const t = totals(list);
  eq([t.start, t.balance, t.pct, t.monthly], [200000, 100000, 0.5, 15000]);
  eq(payoffMonths(list[1]), 2);
  eq(payoffMonths(debt({ minPayment: 1000, rate: 36 })), Infinity, 'платёж меньше процентов');
  eq(payoffMonths(debt({ minPayment: null })), null);
  eq(payoffMonths(list[0]), 23, '80 000 под 36 % по 5 000');
  eq(freeBy(list, '2026-11-02').month, '2028-10');
  // Кредит по графику: ставка 81 % «никогда» не гасится платежом 3 452 ₽, но по договору закроется в июне 2028
  const yandex = debt({ kind: 'loan', balance: 49774, start: 50000, rate: 81.4, minPayment: 3452, endDate: '2028-06-17' });
  eq(payoffMonths(yandex, '2026-11-04'), 19, 'по дате окончания');
  eq(payoffMonths({ ...yandex, kind: 'card' }, '2026-11-04') === 19, false, 'для карты дата окончания не важна');
  eq(payoffMonths({ ...yandex, endDate: '2026-11-29', kind: 'microloan' }, '2026-11-04'), 1, 'займ в этом месяце — 1 месяц');
});

const microloan = (over: Partial<Debt> = {}) => debt({
  kind: 'microloan', start: 11776, balance: 11776, limit: null, rate: 292, minPayment: 14812, payDay: 6, paidDue: '2026-11-06',
  endDate: '2026-12-06', principal: 11500, accruedTo: '2026-11-03', ...over,
});

Deno.test('заём: проценты растут каждый день и к сроку сходятся с договором', () => {
  const d = microloan();
  eq(perDay(d), 92, 'в день');
  eq(lumpSum(d), true, 'возврат одной суммой');
  eq(amountOn(d, '2026-11-08'), 12236, 'на сегодня');
  eq(amountOn(d, '2026-12-06'), 14812, 'к сроку — как в договоре');
  eq(dueAmount(d, '2026-12-06'), 14812, 'к оплате в срок');

  eq(accrue(d, '2026-11-08'), 460, 'начислено за 5 дней');
  eq([d.balance, d.accruedTo, d.start], [12236, '2026-11-08', 12236], 'остаток и 100 %');
  eq(accrue(d, '2026-11-08'), 0, 'второй раз за день не начисляем');
  eq(amountOn(d, '2026-12-06'), 14812, 'после начисления прогноз тот же');

  // Платёж сначала гасит набежавшие 736 ₽, остаток — основной долг
  applyPayment(d, [], 1000, '2026-11-08', 'Лера', '', '2026-11-08');
  eq([d.balance, d.principal], [11236, 11236], 'после платежа');
});

Deno.test('заём: без ставки или основного долга проценты не считаем, новый остаток задаёт дату отсчёта', () => {
  const noRate = microloan({ rate: null });
  eq(accrue(noRate, '2026-11-08'), 0, 'нет ставки');
  eq(amountOn(noRate, '2026-12-06'), 11776, 'сумма не меняется');
  eq(dueAmount(noRate, '2026-12-06'), 11776, 'к оплате — остаток');
  eq(accrue(microloan({ kind: 'loan' }), '2026-11-08'), 0, 'обычный кредит не трогаем');

  const d = microloan();
  applyBalance(d, 12000, '2026-11-07', 'Лера', '');
  eq([d.balance, d.accruedTo], [12000, '2026-11-07'], 'из выписки');
  eq(amountOn(d, '2026-11-08'), 12092, 'считаем от новой даты');

  // Заём с ежемесячным платежом меньше основного долга — не «одной суммой»
  const monthly = microloan({ minPayment: 3000 });
  eq(lumpSum(monthly), false);
  eq(dueAmount(monthly, '2026-12-06'), 3000, 'к оплате — обычный платёж');
});

Deno.test('выписка: когда просить свежий скриншот', () => {
  const known = debt({ statementDay: 12, payDay: 2, paidDue: '2026-11-02' });
  eq(statementAsk(known, '2026-11-13'), { date: '2026-11-12', freshSince: '2026-11-12', known: true }, 'на следующий день');
  eq(statementAsk(known, '2026-11-15')?.date, '2026-11-12', 'запас, если напоминания не запускались');
  eq(statementAsk(known, '2026-11-16'), null, 'поздно');
  eq(statementAsk(known, '2026-11-12'), null, 'в сам день выписки ещё рано');

  const unknown = debt({ payDay: 20, paidDue: '2026-10-20' });
  eq(statementAsk(unknown, '2026-11-13'), { date: '2026-11-13', freshSince: '2026-11-10', known: false }, 'за неделю до платежа');
  eq(statementAsk(unknown, '2026-11-12'), null, 'ещё рано');
  eq(statementAsk(debt({ kind: 'loan', statementDay: 12 }), '2026-11-13'), null, 'только карты');
  eq(statementAsk(debt({ statementDay: 31 }), '2026-03-01')?.date, '2026-02-28', 'короткий месяц');
});
