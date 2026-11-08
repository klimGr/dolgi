// deno test supabase/functions/debts/calendar_test.ts
import { calendarText } from './calendar.ts';
import type { Debt } from './logic.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: Debt = {
  id: 'd1', name: 'Втб, Клим', kind: 'card', owner: '1', creditor: '', color: 1, start: 50000, balance: 40000, limit: null, rate: 39.9,
  minPayment: 2400, payDay: 20, paidDue: '2026-10-20', endDate: null, notes: '', files: [], closed: false, createdAt: '2026-11-03T10:00:00Z',
};
const now = new Date('2026-11-08T07:00:00Z');
const unfold = (s: string) => s.replace(/\r\n /g, '');
const events = (s: string) => s.split('BEGIN:VEVENT').length - 1;

Deno.test('календарь: формат, полгода платежей, длинные строки', () => {
  const long = 'Очень длинное название кредитной карты чтобы строка точно не поместилась в семьдесят пять байт';
  const text = calendarText([base, { ...base, id: 'd2', name: long }], '2026-11-08', now);
  assert(text.startsWith('BEGIN:VCALENDAR\r\n') && text.endsWith('END:VCALENDAR\r\n'), 'обёртка и CRLF');
  assert(events(text) === 12, 'по 6 месяцев на долг: ' + events(text));
  for (const line of text.split('\r\n')) assert(new TextEncoder().encode(line).length <= 75, 'длинная строка: ' + line);
  const flat = unfold(text);
  assert(flat.includes('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121'), 'весь день 20 ноября');
  assert(flat.includes('DTSTART;VALUE=DATE:20270420'), 'последний из шести');
  assert(flat.includes('SUMMARY:Втб\\, Клим — 2 400 ₽'), 'запятая экранирована, сумма в названии');
  assert(flat.includes(long), 'длинное название целиком');
  assert(flat.includes('UID:d1-20'.replace('20', '2026-11-20')), 'постоянный UID');
});

Deno.test('календарь: погашенные пропускаем, заём одной суммой — один срок с прогнозом, договор заканчивается', () => {
  const loan: Debt = { ...base, id: 'm1', name: 'Заём', kind: 'microloan', start: 12236, balance: 12236, rate: 292, minPayment: 14812, payDay: 6, paidDue: '2026-11-06', endDate: '2026-12-06', principal: 11500, accruedTo: '2026-11-08' };
  const lump = unfold(calendarText([loan], '2026-11-08', now));
  assert(events(lump) === 1 && lump.includes('SUMMARY:Заём — ≈ 14 812 ₽'), 'заём: ' + lump);

  const ending: Debt = { ...base, id: 'k1', kind: 'loan', endDate: '2027-01-20' };
  assert(events(calendarText([ending], '2026-11-08', now)) === 3, 'ноябрь, декабрь, январь');
  assert(events(calendarText([{ ...base, closed: true }], '2026-11-08', now)) === 0, 'закрытый долг');
  assert(unfold(calendarText([{ ...base, minPayment: null }], '2026-11-08', now)).includes('сумму уточнить'), 'сумма неизвестна');
});
