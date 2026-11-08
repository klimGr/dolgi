// Хранилище: таблицы Postgres через supabase-js под сервисным ключом
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { SERVICE_KEY, setExtraAllowed, SUPABASE_URL } from './config.ts';
import { type Debt, type DebtEvent, type DebtFile, type Kind, round2 } from './logic.ts';

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ---------- участники ---------- */
export interface Member { id: string; name: string; chatId: number | null }

export async function members(): Promise<Member[]> {
  const rows = ok(await sb.from('debt_members').select('*').order('created_at')) as Record<string, unknown>[];
  return rows.map(r => ({ id: String(r.tg_id), name: String(r.name || ''), chatId: num(r.chat_id) }));
}

/** Запомнить участника; chat_id — только когда он написал боту (иначе не трогаем).
 *  Имя из Telegram берём лишь при первом знакомстве: дальше оно своё («Клим», «Лера») и не перезаписывается */
export async function touchMember(id: number, name: string, chatId?: number) {
  ok(await sb.from('debt_members').upsert({ tg_id: id, name: name || '' }, { onConflict: 'tg_id', ignoreDuplicates: true }));
  if (chatId) ok(await sb.from('debt_members').update({ chat_id: chatId }).eq('tg_id', id));
}

/** Личные ссылки: app — вход в приложение с экрана телефона, calendar — подписка на платежи (только чтение) */
export type TokenKind = 'app' | 'calendar';
const tokenColumn = (kind: TokenKind) => (kind === 'app' ? 'app_token' : 'calendar_token');
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');

export async function memberByToken(token: string, kind: TokenKind): Promise<Member | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const r = ok(await sb.from('debt_members').select('*').eq(tokenColumn(kind), token).maybeSingle()) as Record<string, unknown> | null;
  return r ? { id: String(r.tg_id), name: String(r.name || ''), chatId: num(r.chat_id) } : null;
}

/** Токен участника; если его ещё нет — создаём */
export async function memberToken(id: number, kind: TokenKind): Promise<string> {
  const column = tokenColumn(kind);
  const r = ok(await sb.from('debt_members').select('*').eq('tg_id', id).maybeSingle()) as Record<string, unknown> | null;
  if (r?.[column]) return String(r[column]);
  const token = newToken();
  ok(await sb.from('debt_members').update({ [column]: token }).eq('tg_id', id));
  return token;
}

/* ---------- долги ---------- */
const toDebt = (r: Record<string, unknown>): Debt => ({
  id: String(r.id),
  name: String(r.name),
  kind: r.kind as Kind,
  owner: String(r.owner),
  creditor: String(r.creditor || ''),
  color: Number(r.color) || 1,
  start: Number(r.start_amount) || 0,
  balance: Number(r.balance) || 0,
  limit: num(r.credit_limit),
  rate: num(r.rate),
  minPayment: num(r.min_payment),
  payDay: num(r.pay_day),
  paidDue: (r.paid_due as string) || null,
  endDate: (r.end_date as string) || null,
  notes: String(r.notes || ''),
  files: (r.files as DebtFile[]) || [],
  closed: !!r.closed,
  createdAt: String(r.created_at),
  principal: num(r.principal),
  accruedTo: (r.accrued_to as string) || null,
  statementDay: num(r.statement_day),
});

const fromDebt = (d: Debt) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  owner: d.owner,
  creditor: d.creditor,
  color: d.color,
  start_amount: d.start,
  balance: d.balance,
  credit_limit: d.limit,
  rate: d.rate,
  min_payment: d.minPayment,
  pay_day: d.payDay,
  paid_due: d.paidDue,
  end_date: d.endDate,
  notes: d.notes,
  files: d.files,
  closed: d.closed,
  principal: d.principal ?? null,
  accrued_to: d.accruedTo ?? null,
  statement_day: d.statementDay ?? null,
  updated_at: new Date().toISOString(),
});

export async function debts(): Promise<Debt[]> {
  const rows = ok(await sb.from('debts').select('*').order('created_at')) as Record<string, unknown>[];
  return rows.map(toDebt);
}

export async function debt(id: string): Promise<Debt | null> {
  const row = ok(await sb.from('debts').select('*').eq('id', id).maybeSingle()) as Record<string, unknown> | null;
  return row ? toDebt(row) : null;
}

export async function saveDebt(d: Debt) {
  ok(await sb.from('debts').upsert(fromDebt(d), { onConflict: 'id' }));
}

export async function deleteDebt(id: string) {
  ok(await sb.from('debts').delete().eq('id', id));
}

/* ---------- события ---------- */
const toEvent = (r: Record<string, unknown>): DebtEvent => ({
  id: String(r.id),
  debtId: String(r.debt_id),
  type: r.type as DebtEvent['type'],
  amount: Number(r.amount) || 0,
  delta: Number(r.delta) || 0,
  date: String(r.date),
  by: String(r.by_name || ''),
  note: String(r.note || ''),
  dueBefore: (r.due_before as string) || null,
  dueAfter: (r.due_after as string) || null,
  createdAt: String(r.created_at),
});

export async function events(limit = 500, debtId?: string): Promise<DebtEvent[]> {
  let q = sb.from('debt_events').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (debtId) q = q.eq('debt_id', debtId);
  return (ok(await q) as Record<string, unknown>[]).map(toEvent);
}

export async function event(id: string): Promise<DebtEvent | null> {
  const row = ok(await sb.from('debt_events').select('*').eq('id', id).maybeSingle()) as Record<string, unknown> | null;
  return row ? toEvent(row) : null;
}

export async function insertEvent(e: DebtEvent) {
  ok(await sb.from('debt_events').insert({
    id: e.id,
    debt_id: e.debtId,
    type: e.type,
    amount: e.amount,
    delta: e.delta,
    date: e.date,
    by_name: e.by,
    note: e.note,
    due_before: e.dueBefore,
    due_after: e.dueAfter,
  }));
}

/** Проценты по займу: одна запись на месяц, чтобы история не забивалась ежедневными строчками */
export async function addInterest(d: Debt, added: number, date: string) {
  const id = `int${d.id}${date.slice(0, 7).replace('-', '')}`;
  const current = await event(id);
  const total = round2((current?.amount ?? 0) + added);
  ok(await sb.from('debt_events').upsert({
    id, debt_id: d.id, type: 'interest', amount: total, delta: total, date, by_name: '', note: '', due_before: d.paidDue, due_after: d.paidDue,
  }, { onConflict: 'id' }));
}

export async function deleteEvent(id: string) {
  ok(await sb.from('debt_events').delete().eq('id', id));
}

/* ---------- напоминания ---------- */
/** true — напоминание новое и его надо отправить */
export async function claimReminder(debtId: string, due: string, stage: string) {
  const rows = ok(await sb.from('debt_reminders')
    .upsert({ debt_id: debtId, due, stage }, { onConflict: 'debt_id,due,stage', ignoreDuplicates: true })
    .select()) as unknown[];
  return rows.length > 0;
}

/* ---------- доступ ---------- */
let allowedAt = 0;
/** Дополнительные Telegram ID из debt_settings.allowed_ids — так человека можно добавить без смены секрета.
 *  Читаем не чаще раза в минуту; если база не ответила, работаем со списком из секрета */
export async function loadAllowed(force = false) {
  if (!force && Date.now() - allowedAt < 60_000) return;
  try {
    const row = ok(await sb.from('debt_settings').select('value').eq('key', 'allowed_ids').maybeSingle()) as { value?: string } | null;
    setExtraAllowed(String(row?.value ?? '').split(/[\s,;]+/).filter(Boolean));
    allowedAt = Date.now();
  } catch (e) {
    console.error('allowed_ids', e);
  }
}

/* ---------- служебный ключ ---------- */
/** Ключ для /cron и /setup: общий секрет или cron_key из таблицы debt_settings (его знает только база) */
export async function isServiceKey(key: string | null, secret: string) {
  if (!key) return false;
  if (secret && key === secret) return true;
  const row = await sb.from('debt_settings').select('value').eq('key', 'cron_key').maybeSingle();
  const own = (row.data as { value?: string } | null)?.value;
  return !!own && key === own;
}

/* ---------- переписка ---------- */
export async function history(chatId: number, n = 12): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  const rows = ok(await sb.from('debt_chat').select('role,text').eq('chat_id', chatId).order('id', { ascending: false }).limit(n)) as
    { role: 'user' | 'assistant'; text: string }[];
  return rows.reverse();
}

export async function remember(chatId: number, role: 'user' | 'assistant', text: string) {
  ok(await sb.from('debt_chat').insert({ chat_id: chatId, role, text: text.slice(0, 4000) }));
}

export async function forget(chatId: number) {
  ok(await sb.from('debt_chat').delete().eq('chat_id', chatId));
}

/* ---------- альбомы ---------- */
export interface MediaFile { fileId: string; name: string; mime: string; type: 'document' | 'photo'; size?: number }

export async function addMedia(groupId: string, messageId: number, file: MediaFile, caption: string) {
  ok(await sb.from('debt_media').upsert({ group_id: groupId, message_id: messageId, file, caption }, { onConflict: 'group_id,message_id' }));
}

export async function mediaGroup(groupId: string): Promise<{ messageId: number; file: MediaFile; caption: string }[]> {
  const rows = ok(await sb.from('debt_media').select('*').eq('group_id', groupId).order('message_id')) as Record<string, unknown>[];
  return rows.map(r => ({ messageId: Number(r.message_id), file: r.file as MediaFile, caption: String(r.caption || '') }));
}

export async function dropMediaGroup(groupId: string) {
  ok(await sb.from('debt_media').delete().eq('group_id', groupId));
}
