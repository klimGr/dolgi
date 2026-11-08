// Платежи в формате iCalendar: телефон подписывается на ссылку и сам обновляет календарь
import { money } from './format.ts';
import { addDays, type Debt, dueAmount, dueKnown, dueOnOrAfter, isOpen, lumpSum, nextDue } from './logic.ts';

const MONTHS_AHEAD = 6;

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dayValue = (date: string) => date.replaceAll('-', '');

/** По стандарту строка не длиннее 75 байт; режем только между символами UTF-8 */
function fold(line: string) {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (bytes(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** Ближайшие сроки: до конца договора, но не дальше полугода; заём одной суммой — один срок */
function dueDates(d: Debt, t: string) {
  const out: string[] = [];
  let due = nextDue(d, t);
  while (due && out.length < MONTHS_AHEAD) {
    out.push(due);
    if (lumpSum(d) || (d.endDate && due >= d.endDate)) break;
    due = dueOnOrAfter(addDays(due, 1), d.payDay!);
    if (d.endDate && due > d.endDate) break;
  }
  return out;
}

export function calendarText(debts: Debt[], t: string, now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//klimgr//dolgi//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Наши долги',
    'X-WR-TIMEZONE:Europe/Moscow',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const d of debts.filter(isOpen)) {
    for (const due of dueDates(d, t)) {
      const sum = dueKnown(d) ? `${lumpSum(d) ? '≈ ' : ''}${money(dueAmount(d, due))}` : 'сумму уточнить';
      lines.push(
        'BEGIN:VEVENT',
        `UID:${d.id}-${due}@dolgi`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${dayValue(due)}`,
        `DTEND;VALUE=DATE:${dayValue(addDays(due, 1))}`,
        `SUMMARY:${escapeText(`${d.name} — ${sum}`)}`,
        `DESCRIPTION:${escapeText(`Остаток долга: ${money(d.balance)}. Отметить оплату — в приложении «Наши долги».`)}`,
        'TRANSP:TRANSPARENT',
        // Напоминание накануне в 10:00: событие на весь день начинается в полночь
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(`Завтра платёж: ${d.name}`)}`,
        'TRIGGER:-PT14H',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
