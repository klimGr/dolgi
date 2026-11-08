// Операции над долгами — общие для мини-приложения и для бота (инструменты Claude)
import { ALLOWED, TZ } from './config.ts';
import * as db from './db.ts';
import {
  accrue, applyBalance, applyPayment, type Debt, type DebtFile, type EventType, freeColor, isDate, type Kind, KINDS, revertEvent,
  round2, setSchedule, today, uid,
} from './logic.ts';

/** Ошибка, которую можно показать человеку */
export class UserError extends Error {}

export interface DebtInput {
  name?: string;
  kind?: string;
  owner?: string;
  creditor?: string;
  color?: number;
  start?: number | null;
  balance?: number | null;
  limit?: number | null;
  rate?: number | null;
  minPayment?: number | null;
  payDay?: number | null;
  nextPayment?: string | null;
  endDate?: string | null;
  notes?: string;
  closed?: boolean;
  principal?: number | null;
  statementDay?: number | null;
}

const text = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max);
const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
};
const dayOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};
/** Как только у займа есть ставка и основной долг, начинаем считать проценты с этого дня */
const startAccrual = (d: Debt, t: string) => {
  if (d.kind === 'microloan' && d.rate && d.principal && !d.accruedTo) d.accruedTo = t;
};
const kindOf = (v: unknown): Kind => (KINDS.includes(v as Kind) ? (v as Kind) : 'loan');
const ownerOf = (v: unknown) => (v && ALLOWED.has(String(v)) ? String(v) : 'common');
const colorOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
};
// Мини-приложение присылает свои id, чтобы показать изменение сразу, не дожидаясь ответа сервера
const idOr = (v: unknown) => (typeof v === 'string' && /^[a-z0-9]{6,32}$/.test(v) ? v : uid());

/** members можно передать готовым, чтобы не читать участников второй раз */
export async function state(people?: Promise<db.Member[]>) {
  const [debts, events, members] = await Promise.all([db.debts(), db.events(), people ?? db.members()]);
  return { debts, events, members: members.map(m => ({ id: m.id, name: m.name })), today: today(TZ) };
}

export async function createDebt(input: DebtInput, file?: DebtFile, id?: string): Promise<Debt> {
  const all = await db.debts();
  const balance = amount(input.balance) ?? amount(input.start) ?? 0;
  const d: Debt = {
    id: idOr(id),
    name: text(input.name) || 'Долг',
    kind: kindOf(input.kind),
    owner: ownerOf(input.owner),
    creditor: text(input.creditor),
    color: colorOf(input.color) ?? freeColor(all),
    start: Math.max(amount(input.start) ?? 0, balance),
    balance,
    limit: amount(input.limit),
    rate: amount(input.rate),
    minPayment: amount(input.minPayment),
    payDay: null,
    paidDue: null,
    endDate: isDate(input.endDate) ? input.endDate : null,
    notes: text(input.notes, 2000),
    files: file ? [file] : [],
    closed: input.closed === true,
    createdAt: new Date().toISOString(),
    principal: amount(input.principal),
    accruedTo: null,
    statementDay: dayOf(input.statementDay),
  };
  setSchedule(d, today(TZ), Number(input.payDay) || null, input.nextPayment);
  startAccrual(d, today(TZ));
  await db.saveDebt(d);
  return d;
}

export async function updateDebt(id: string, input: DebtInput, by: string, file?: DebtFile, eventId?: string): Promise<Debt> {
  const d = await db.debt(id);
  if (!d) throw new UserError('Долг не найден');
  const has = (k: keyof DebtInput) => input[k] !== undefined;

  if (has('name') && text(input.name)) d.name = text(input.name);
  if (has('kind')) d.kind = kindOf(input.kind);
  if (has('owner')) d.owner = ownerOf(input.owner);
  if (has('creditor')) d.creditor = text(input.creditor);
  if (has('color') && colorOf(input.color)) d.color = colorOf(input.color)!;
  if (has('limit')) d.limit = amount(input.limit);
  if (has('rate')) d.rate = amount(input.rate);
  if (has('minPayment')) d.minPayment = amount(input.minPayment);
  if (has('endDate')) d.endDate = isDate(input.endDate) ? input.endDate : null;
  if (has('notes')) d.notes = text(input.notes, 2000);
  if (has('start') && amount(input.start) !== null) d.start = amount(input.start)!;
  if (has('principal')) d.principal = amount(input.principal);
  if (has('statementDay')) d.statementDay = dayOf(input.statementDay);
  if (file && !d.files.some(f => f.id === file.id)) d.files = [...d.files, file];

  const t = today(TZ);
  if (has('nextPayment') && isDate(input.nextPayment)) setSchedule(d, t, null, input.nextPayment);
  else if (has('payDay') && (Number(input.payDay) || null) !== d.payDay) setSchedule(d, t, Number(input.payDay) || null);

  // Остаток меняем через событие, чтобы было видно в истории
  const newBalance = has('balance') ? amount(input.balance) : null;
  if (newBalance !== null && newBalance !== d.balance) {
    await db.insertEvent({ ...applyBalance(d, newBalance, t, by, 'Остаток изменён вручную'), id: idOr(eventId) });
  }
  d.start = Math.max(d.start, d.balance);
  startAccrual(d, t);
  if (has('closed')) d.closed = input.closed === true;

  await db.saveDebt(d);
  return d;
}

export async function removeDebt(id: string) {
  await db.deleteDebt(id);
}

export async function pay(debtId: string, sum: unknown, date: unknown, by: string, note = '', eventId?: string) {
  const d = await db.debt(debtId);
  if (!d) throw new UserError('Долг не найден');
  const value = amount(sum);
  if (!value) throw new UserError('Сумма платежа должна быть больше нуля');
  const t = today(TZ);
  const day = isDate(date) ? date : t;
  // Платят сегодняшнюю сумму: сначала доводим проценты до этого дня
  const added = accrue(d, t);
  if (added) await db.addInterest(d, added, t);
  const recent = await db.events(100, debtId);
  const e = applyPayment(d, recent, value, day, by, text(note, 300), t);
  e.id = idOr(eventId);
  await db.insertEvent(e);
  await db.saveDebt(d);
  return { debt: d, event: e };
}

export async function setBalance(debtId: string, sum: unknown, date: unknown, by: string, note = '', type: EventType = 'balance', eventId?: string) {
  const d = await db.debt(debtId);
  if (!d) throw new UserError('Долг не найден');
  const value = amount(sum);
  if (value === null) throw new UserError('Нужна сумма остатка');
  const t = today(TZ);
  const e = applyBalance(d, type === 'charge' ? d.balance + value : value, isDate(date) ? date : t, by, text(note, 300), type);
  if (type === 'charge') e.amount = value;
  e.id = idOr(eventId);
  await db.insertEvent(e);
  await db.saveDebt(d);
  return { debt: d, event: e };
}

export async function removeEvent(id: string) {
  const e = await db.event(id);
  if (!e) throw new UserError('Запись не найдена');
  const d = await db.debt(e.debtId);
  if (d) {
    revertEvent(d, e);
    await db.saveDebt(d);
  }
  await db.deleteEvent(id);
  return d;
}

/** Исправить запись о платеже: отменяем её и записываем заново, чтобы остаток и срок пересчитались как положено */
export async function editPayment(id: string, sum: unknown, date: unknown, note?: string) {
  const e = await db.event(id);
  if (!e) throw new UserError('Запись не найдена');
  if (e.type !== 'payment') throw new UserError('Так можно исправить только платёж');
  await removeEvent(id);
  return pay(e.debtId, sum ?? e.amount, date ?? e.date, e.by, note ?? e.note);
}
