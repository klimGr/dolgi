// Чистая логика долгов: сроки платежей, учёт оплат, прогноз погашения.
// Тот же алгоритм повторён в app.js для демо-режима — при правках меняйте оба места.
// Даты — строки 'YYYY-MM-DD', считаем в UTC, чтобы не зависеть от часового пояса сервера.

export type Kind = 'card' | 'loan' | 'microloan' | 'installment' | 'other';
export const KINDS: Kind[] = ['card', 'loan', 'microloan', 'installment', 'other'];
export const KIND_NAMES: Record<Kind, string> = {
  card: 'Кредитная карта',
  loan: 'Кредит',
  microloan: 'Займ',
  installment: 'Рассрочка',
  other: 'Другое',
};

export interface DebtFile {
  id: string; // file_id в Telegram
  name: string;
  type: 'document' | 'photo';
}

export interface Debt {
  id: string;
  name: string;
  kind: Kind;
  owner: string; // Telegram ID или 'common'
  creditor: string;
  color: number; // 1–8
  start: number; // 100 %
  balance: number;
  limit: number | null;
  rate: number | null; // % годовых
  minPayment: number | null;
  payDay: number | null;
  paidDue: string | null;
  endDate: string | null;
  notes: string;
  files: DebtFile[];
  closed: boolean;
  createdAt: string;
  principal?: number | null; // основной долг займа: на него начисляются проценты
  accruedTo?: string | null; // по какой день проценты уже включены в balance
  statementDay?: number | null; // число месяца, когда банк формирует выписку по карте
}

export type EventType = 'payment' | 'balance' | 'charge' | 'interest';

export interface DebtEvent {
  id: string;
  debtId: string;
  type: EventType;
  amount: number;
  delta: number;
  date: string;
  by: string;
  note: string;
  dueBefore: string | null;
  dueAfter: string | null;
  createdAt: string;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- даты ---------- */
const toTime = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);
export const isDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toTime(s));
export const addDays = (s: string, n: number) => fromTime(toTime(s) + n * 864e5);
/** Сколько дней от a до b (b − a) */
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / 864e5);

/** Дата платежа в месяце m0 (0–11, можно выходить за границы года); 31-е в коротком месяце → последний день */
export function dueIn(y: number, m0: number, payDay: number) {
  const first = new Date(Date.UTC(y, m0, 1));
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth();
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return fromTime(Date.UTC(yy, mm, Math.min(payDay, last)));
}

/** Первый срок платежа не раньше from */
export function dueOnOrAfter(from: string, payDay: number) {
  const [y, m] = from.split('-').map(Number);
  const cur = dueIn(y, m - 1, payDay);
  return cur >= from ? cur : dueIn(y, m, payDay);
}

/** Предыдущий срок перед due */
export function prevDue(due: string, payDay: number) {
  const [y, m] = due.split('-').map(Number);
  return dueIn(y, m - 2, payDay);
}

/** Сегодня в нужном часовом поясе */
export function today(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* ---------- платежи ---------- */
export const isOpen = (d: Debt) => !d.closed && d.balance > 0;

/**
 * Настроить график: по дате ближайшего платежа (если известна) или по числу месяца.
 * paidDue ставим на срок перед ближайшим — так ближайший считается неоплаченным.
 */
export function setSchedule(d: Debt, todayStr: string, payDay: number | null, nextDate?: string | null) {
  if (nextDate && isDate(nextDate)) {
    d.payDay = Number(nextDate.slice(8, 10));
    d.paidDue = prevDue(nextDate, d.payDay);
  } else if (payDay && payDay >= 1 && payDay <= 31) {
    d.payDay = Math.round(payDay);
    d.paidDue = prevDue(dueOnOrAfter(todayStr, d.payDay), d.payDay);
  } else {
    d.payDay = null;
    d.paidDue = null;
  }
}

/** Ближайший неоплаченный срок */
export function nextDue(d: Debt, todayStr: string): string | null {
  if (!d.payDay || !isOpen(d)) return null;
  const from = d.paidDue ? addDays(d.paidDue, 1) : todayStr;
  return dueOnOrAfter(from, d.payDay);
}

/* ---------- проценты по займам: растут каждый день ---------- */
/** Считаем проценты сами, если у займа МФО известны ставка и основной долг */
export const accrues = (d: Debt) => d.kind === 'microloan' && isOpen(d) && !!d.rate && !!d.principal && !!d.accruedTo;
/** Заём возвращают одной суммой (платёж не меньше основного долга): к сроку добавятся проценты */
export const lumpSum = (d: Debt) => accrues(d) && (!d.minPayment || d.minPayment >= d.principal!);
export const perDay = (d: Debt) => (accrues(d) ? round2((d.principal! * d.rate!) / 36500) : 0);

/** Сколько будет к возврату в этот день, если ничего не платить */
export function amountOn(d: Debt, date: string) {
  if (!accrues(d)) return d.balance;
  return round2(d.balance + ((d.principal! * d.rate!) / 36500) * Math.max(0, daysBetween(d.accruedTo!, date)));
}

/** Довести остаток займа до сегодняшнего дня; возвращает, сколько прибавилось */
export function accrue(d: Debt, todayStr: string) {
  if (!accrues(d) || d.accruedTo! >= todayStr) return 0;
  const before = d.balance;
  d.balance = amountOn(d, todayStr);
  d.accruedTo = todayStr;
  if (d.balance > d.start) d.start = d.balance;
  return round2(d.balance - before);
}

/** Сколько вносить в срок due: минимальный платёж, но не больше остатка; заём одной суммой — всё, что набежит к этому дню */
export function dueAmount(d: Debt, due?: string) {
  if (due && lumpSum(d)) return amountOn(d, due);
  return Math.min(d.minPayment || d.balance, d.balance);
}
/** Знаем ли сумму платежа: у карты без минимального платежа её знает только банк (весь долг — не платёж) */
export const dueKnown = (d: Debt) => !!d.minPayment || d.kind !== 'card';

/** Внести платёж: уменьшает остаток и, если набран минимум за период, закрывает ближайший срок */
export function applyPayment(d: Debt, events: DebtEvent[], amount: number, date: string, by: string, note: string, todayStr: string): DebtEvent {
  const before = d.balance;
  const dueBefore = d.paidDue;
  d.balance = round2(Math.max(0, before - amount));
  // Платёж сначала гасит набежавшие проценты, остаток — основной долг
  if (d.principal) d.principal = round2(Math.max(0, d.principal - Math.max(0, amount - Math.max(0, before - d.principal))));
  const due = d.payDay ? nextDue({ ...d, balance: before }, todayStr) : null;
  if (due && d.payDay) {
    const start = prevDue(due, d.payDay);
    const paid = events
      .filter(e => e.debtId === d.id && e.type === 'payment' && e.date > start)
      .reduce((s, e) => s + e.amount, 0) + amount;
    if (date > start && (paid >= (d.minPayment || 0) - 0.5 || d.balance === 0)) d.paidDue = due;
  }
  if (d.balance === 0 && d.kind !== 'card') d.closed = true;
  return {
    id: uid(), debtId: d.id, type: 'payment', amount: round2(amount), delta: round2(d.balance - before),
    date, by, note, dueBefore, dueAfter: d.paidDue, createdAt: new Date().toISOString(),
  };
}

/** Новый остаток (например, из выписки). Если долг вырос выше 100 % — сдвигаем точку отсчёта */
export function applyBalance(d: Debt, balance: number, date: string, by: string, note: string, type: EventType = 'balance'): DebtEvent {
  const before = d.balance;
  d.balance = round2(Math.max(0, balance));
  // Остаток из выписки уже с процентами на эту дату — дальше считаем от неё
  if (type === 'balance' && d.accruedTo) d.accruedTo = date;
  if (d.principal && d.principal > d.balance) d.principal = d.balance;
  if (d.balance > d.start) d.start = d.balance;
  if (d.balance > 0) d.closed = false;
  else if (d.kind !== 'card') d.closed = true;
  return {
    id: uid(), debtId: d.id, type, amount: d.balance, delta: round2(d.balance - before),
    date, by, note, dueBefore: d.paidDue, dueAfter: d.paidDue, createdAt: new Date().toISOString(),
  };
}

/** Отменить событие (удалили ошибочный платёж) */
export function revertEvent(d: Debt, e: DebtEvent) {
  d.balance = round2(Math.max(0, d.balance - e.delta));
  // Сколько платёж списал с основного долга, не храним: возвращаем с запасом, но не больше остатка
  if (e.type === 'payment' && d.principal !== undefined && d.principal !== null) d.principal = round2(Math.min(d.balance, d.principal + e.amount));
  if (e.dueAfter !== e.dueBefore && d.paidDue === e.dueAfter) d.paidDue = e.dueBefore;
  if (d.balance > 0) d.closed = false;
}

/**
 * Когда просить свежую выписку по карте. Знаем день выписки — на следующий день после него
 * (ещё 2 дня запаса, если напоминания не запускались); не знаем — за неделю до платежа.
 * date — чтобы спросить один раз; остаток, обновлённый начиная с freshSince, уже свежий.
 */
export function statementAsk(d: Debt, todayStr: string): { date: string; freshSince: string; known: boolean } | null {
  if (d.kind !== 'card' || !isOpen(d)) return null;
  if (d.statementDay) {
    const [y, m] = todayStr.split('-').map(Number);
    let date = dueIn(y, m - 1, d.statementDay);
    if (date >= todayStr) date = dueIn(y, m - 2, d.statementDay);
    return daysBetween(date, todayStr) <= 3 ? { date, freshSince: date, known: true } : null;
  }
  const due = nextDue(d, todayStr);
  if (!due) return null;
  const left = daysBetween(todayStr, due);
  if (left > 7 || left < 5) return null;
  return { date: addDays(due, -7), freshSince: addDays(due, -10), known: false };
}

/* ---------- сводка ---------- */
export const pctLeft = (balance: number, start: number) => (start > 0 ? Math.min(1, balance / start) : balance > 0 ? 1 : 0);

export function totals(list: Debt[]) {
  const start = list.reduce((s, d) => s + Math.max(d.start, d.balance), 0);
  const balance = list.reduce((s, d) => s + d.balance, 0);
  const monthly = list.filter(isOpen).reduce((s, d) => s + Math.min(d.minPayment || 0, d.balance), 0);
  return { start, balance, paid: start - balance, pct: pctLeft(balance, start), monthly };
}

/** Сколько календарных месяцев от месяца from до месяца to */
const monthsTo = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

/**
 * Сколько месяцев до нуля при минимальных платежах.
 * null — не знаем платёж; Infinity — платёж не покрывает проценты.
 * Кредит или займ с датой окончания гасится по графику банка (ставка там может меняться) — верим договору.
 */
export function payoffMonths(d: Debt, todayStr?: string): number | null {
  if (!isOpen(d)) return 0;
  if (d.endDate && d.kind !== 'card' && todayStr && d.endDate >= todayStr) return Math.max(1, monthsTo(todayStr, d.endDate));
  const pay = d.minPayment || 0;
  if (pay <= 0) return null;
  const r = (d.rate || 0) / 1200;
  if (d.balance * r >= pay) return Infinity;
  let b = d.balance;
  let n = 0;
  while (b > 0.5 && n < 600) {
    b = b * (1 + r) - pay;
    n++;
  }
  return n >= 600 ? Infinity : n;
}

/** Когда закроются все долги при минимальных платежах (YYYY-MM) или почему не можем сказать */
export function freeBy(list: Debt[], todayStr: string): { month: string | null; unknown: number; never: number } {
  let max = 0;
  let unknown = 0;
  let never = 0;
  for (const d of list.filter(isOpen)) {
    const m = payoffMonths(d, todayStr);
    if (m === null) unknown++;
    else if (m === Infinity) never++;
    else max = Math.max(max, m);
  }
  if (!list.some(isOpen)) return { month: null, unknown, never };
  const [y, mo] = todayStr.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo - 1 + max, 1));
  return { month: end.toISOString().slice(0, 7), unknown, never };
}

/** Порядок погашения «лавиной»: сначала самая дорогая ставка */
export const byRate = (list: Debt[]) =>
  list.filter(d => isOpen(d) && d.rate).sort((a, b) => (b.rate || 0) - (a.rate || 0));

/** Свободный цвет: первый номер 1–8, которого ещё нет у открытых долгов */
export function freeColor(list: Debt[]) {
  const used = new Set(list.filter(d => !d.closed).map(d => d.color));
  for (let c = 1; c <= 8; c++) if (!used.has(c)) return c;
  return (list.length % 8) + 1;
}
