// deno test supabase/functions/debts/logic_test.ts
import {
  applyBalance, applyPayment, type Debt, type DebtEvent, dueIn, dueOnOrAfter, freeBy, nextDue, payoffMonths,
  prevDue, revertEvent, setSchedule, totals,
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
});
