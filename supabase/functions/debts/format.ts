// Тексты для чата: деньги, даты, проценты — по-русски
import { type Debt, daysBetween, KIND_NAMES } from './logic.ts';

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const money = (n: number) => nf0.format(Math.round(n || 0)) + '\u00a0₽';
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
/** С копейками, если они есть: так цифры сходятся с приложением банка */
export const moneyExact = (n: number) => nf2.format(n || 0) + ' ₽';
export const pct = (x: number) => Math.round(x * 100) + '%';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function dayMonth(date: string) {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

const MONTHS_TO = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];

/** «к ноябрю 2028» */
export function byMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `к ${MONTHS_TO[m - 1]} ${y}`;
}

export function monthYear(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** «сегодня», «завтра», «через 3 дня», «просрочен на 2 дня» */
export function whenText(today: string, due: string) {
  const n = daysBetween(today, due);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n > 1) return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
  return `просрочен на ${-n} ${plural(-n, 'день', 'дня', 'дней')}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/** Ответ модели → HTML для Telegram: экранируем и превращаем **жирный** в <b> */
export function toTelegramHtml(text: string) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

export const kindName = (d: Debt) => KIND_NAMES[d.kind] ?? 'Долг';
