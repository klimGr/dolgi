'use strict';

/* ---------- Telegram ---------- */
const tg = window.Telegram && window.Telegram.WebApp;
const inTelegram = !!(tg && tg.initData);
const tgVersion = v => inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast(v);
const tgBack = tgVersion('6.1');

/* ---------- настройки ---------- */
// Серверная функция Supabase. Вне Telegram — демо-режим, данные только на этом устройстве.
const API_URL = 'https://fpyxaygiiiivnjrujqyf.supabase.co/functions/v1/debts';

// С экрана телефона приложение открывается само, без Telegram: вход по личной ссылке …/dolgi/?t=…
// Её выдаёт кнопка «Установить» внутри Telegram. iOS запоминает адрес вместе с токеном, поэтому manifest со start_url здесь нельзя.
const TOKEN_KEY = 'debts.token.v1';
const appToken = inTelegram ? null : (() => {
  const fromUrl = new URLSearchParams(location.search).get('t');
  try {
    if (fromUrl) localStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl || localStorage.getItem(TOKEN_KEY);
  } catch { return fromUrl; }
})();
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const remote = !!(API_URL && (inTelegram || appToken));

const KINDS = [
  { key: 'card', name: 'Кредитка', full: 'Кредитная карта' },
  { key: 'loan', name: 'Кредит', full: 'Кредит' },
  { key: 'microloan', name: 'Займ', full: 'Займ' },
  { key: 'installment', name: 'Рассрочка', full: 'Рассрочка' },
  { key: 'other', name: 'Другое', full: 'Другое' },
];
const kindName = k => (KINDS.find(x => x.key === k) || KINDS[4]).full;
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_TO = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/* ---------- иконки ---------- */
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  back: svg('<path d="m15 5-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chart: svg('<rect x="3" y="10" width="5" height="4" rx="1.5"/><rect x="10" y="10" width="5" height="4" rx="1.5"/><rect x="17" y="10" width="4" height="4" rx="1.5"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  card: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6 15h4"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  phone: svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>'),
  offline: svg('<path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.2A15 15 0 0 1 22 8.8M5 12.4a10 10 0 0 1 4.4-2.2M14.6 10.4A10 10 0 0 1 19 12.4M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>'),
  share: svg('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 11H5v10h14V11h-2"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>'),
};

/* ---------- утилиты ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = n => nf0.format(Math.round(n || 0)) + '\u00a0₽';
const pctText = x => {
  const p = x * 100;
  return p > 0 && p < 1 ? '<1' : nf0.format(Math.round(p));
};
const parseNum = v => {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
// «412000» → «412 000» для полей ввода; parseNum понимает такую запись
function groupNum(v) {
  const s = String(v ?? '').replace(/[^\d.,]/g, '').replace(/\./g, ',');
  const i = s.indexOf(',');
  const int = (i < 0 ? s : s.slice(0, i)).replace(/^0+(?=\d)/, '');
  const frac = i < 0 ? '' : ',' + s.slice(i + 1).replace(/,/g, '').slice(0, 2);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + frac;
}
const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => localDate(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round2 = n => Math.round(n * 100) / 100;

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const dayMonth = s => `${Number(s.slice(8, 10))} ${MONTHS_GEN[Number(s.slice(5, 7)) - 1]}`;
const monthYear = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
// «к ноябрю 2028»
const byMonth = ym => `к\u00a0${MONTHS_TO[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/* ---------- логика (тот же алгоритм, что в supabase/functions/debts/logic.ts) ---------- */
const toTime = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromTime = t => new Date(t).toISOString().slice(0, 10);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (s, n) => fromTime(toTime(s) + n * 864e5);
const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / 864e5);

function dueIn(y, m0, payDay) {
  const first = new Date(Date.UTC(y, m0, 1));
  const yy = first.getUTCFullYear(), mm = first.getUTCMonth();
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return fromTime(Date.UTC(yy, mm, Math.min(payDay, last)));
}
function dueOnOrAfter(from, payDay) {
  const [y, m] = from.split('-').map(Number);
  const cur = dueIn(y, m - 1, payDay);
  return cur >= from ? cur : dueIn(y, m, payDay);
}
function prevDue(due, payDay) {
  const [y, m] = due.split('-').map(Number);
  return dueIn(y, m - 2, payDay);
}
const isOpen = d => !d.closed && d.balance > 0;

function setSchedule(d, today, payDay, nextDate) {
  if (nextDate && isDate(nextDate)) {
    d.payDay = Number(nextDate.slice(8, 10));
    d.paidDue = prevDue(nextDate, d.payDay);
  } else if (payDay && payDay >= 1 && payDay <= 31) {
    d.payDay = Math.round(payDay);
    d.paidDue = prevDue(dueOnOrAfter(today, d.payDay), d.payDay);
  } else {
    d.payDay = null;
    d.paidDue = null;
  }
}
function nextDue(d, today) {
  if (!d.payDay || !isOpen(d)) return null;
  return dueOnOrAfter(d.paidDue ? addDays(d.paidDue, 1) : today, d.payDay);
}

// Проценты по займу растут каждый день: считаем сами, если известны ставка и основной долг
const accrues = d => d.kind === 'microloan' && isOpen(d) && !!d.rate && !!d.principal && !!d.accruedTo;
const lumpSum = d => accrues(d) && (!d.minPayment || d.minPayment >= d.principal);
const perDay = d => (accrues(d) ? round2(d.principal * d.rate / 36500) : 0);
function amountOn(d, date) {
  if (!accrues(d)) return d.balance;
  return round2(d.balance + d.principal * d.rate / 36500 * Math.max(0, daysBetween(d.accruedTo, date)));
}
function accrue(d, today) {
  if (!accrues(d) || d.accruedTo >= today) return 0;
  const before = d.balance;
  d.balance = amountOn(d, today);
  d.accruedTo = today;
  if (d.balance > d.start) d.start = d.balance;
  return round2(d.balance - before);
}
function dueAmount(d, due) {
  if (due && lumpSum(d)) return amountOn(d, due);
  return Math.min(d.minPayment || d.balance, d.balance);
}

function applyPayment(d, events, amount, date, by, note, today) {
  const before = d.balance, dueBefore = d.paidDue;
  d.balance = round2(Math.max(0, before - amount));
  if (d.principal) d.principal = round2(Math.max(0, d.principal - Math.max(0, amount - Math.max(0, before - d.principal))));
  const due = d.payDay ? nextDue({ ...d, balance: before }, today) : null;
  if (due) {
    const start = prevDue(due, d.payDay);
    const paid = events.filter(e => e.debtId === d.id && e.type === 'payment' && e.date > start).reduce((s, e) => s + e.amount, 0) + amount;
    if (date > start && (paid >= (d.minPayment || 0) - 0.5 || d.balance === 0)) d.paidDue = due;
  }
  if (d.balance === 0 && d.kind !== 'card') d.closed = true;
  return { id: uid(), debtId: d.id, type: 'payment', amount: round2(amount), delta: round2(d.balance - before), date, by, note, dueBefore, dueAfter: d.paidDue, createdAt: new Date().toISOString() };
}
function applyBalance(d, balance, date, by, note, type = 'balance') {
  const before = d.balance;
  d.balance = round2(Math.max(0, balance));
  if (type === 'balance' && d.accruedTo) d.accruedTo = date;
  if (d.principal && d.principal > d.balance) d.principal = d.balance;
  if (d.balance > d.start) d.start = d.balance;
  if (d.balance > 0) d.closed = false;
  else if (d.kind !== 'card') d.closed = true;
  return { id: uid(), debtId: d.id, type, amount: d.balance, delta: round2(d.balance - before), date, by, note, dueBefore: d.paidDue, dueAfter: d.paidDue, createdAt: new Date().toISOString() };
}
function revertEvent(d, e) {
  d.balance = round2(Math.max(0, d.balance - e.delta));
  if (e.type === 'payment' && d.principal != null) d.principal = round2(Math.min(d.balance, d.principal + e.amount));
  if (e.dueAfter !== e.dueBefore && d.paidDue === e.dueAfter) d.paidDue = e.dueBefore;
  if (d.balance > 0) d.closed = false;
}
const pctLeft = (balance, start) => (start > 0 ? Math.min(1, balance / start) : balance > 0 ? 1 : 0);
function totals(list) {
  const start = list.reduce((s, d) => s + Math.max(d.start, d.balance), 0);
  const balance = list.reduce((s, d) => s + d.balance, 0);
  const monthly = list.filter(isOpen).reduce((s, d) => s + Math.min(d.minPayment || 0, d.balance), 0);
  return { start, balance, paid: start - balance, pct: pctLeft(balance, start), monthly };
}
const monthsTo = (from, to) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
// Кредит или займ с датой окончания гасится по графику банка (ставка может меняться) — верим договору
function payoffMonths(d, today) {
  if (!isOpen(d)) return 0;
  if (d.endDate && d.kind !== 'card' && today && d.endDate >= today) return Math.max(1, monthsTo(today, d.endDate));
  const pay = d.minPayment || 0;
  if (pay <= 0) return null;
  const r = (d.rate || 0) / 1200;
  if (d.balance * r >= pay) return Infinity;
  let b = d.balance, n = 0;
  while (b > 0.5 && n < 600) { b = b * (1 + r) - pay; n++; }
  return n >= 600 ? Infinity : n;
}
function freeBy(list, today) {
  let max = 0, unknown = 0, never = 0;
  for (const d of list.filter(isOpen)) {
    const m = payoffMonths(d, today);
    if (m === null) unknown++;
    else if (m === Infinity) never++;
    else max = Math.max(max, m);
  }
  if (!list.some(isOpen)) return { month: null, unknown, never };
  const [y, mo] = today.split('-').map(Number);
  return { month: new Date(Date.UTC(y, mo - 1 + max, 1)).toISOString().slice(0, 7), unknown, never };
}
const byRate = list => list.filter(d => isOpen(d) && d.rate).sort((a, b) => b.rate - a.rate);
function freeColor(list) {
  const used = new Set(list.filter(d => !d.closed).map(d => d.color));
  for (let c = 1; c <= 8; c++) if (!used.has(c)) return c;
  return (list.length % 8) + 1;
}

/* ---------- хранилище ---------- */
const DEMO_KEY = 'debts.demo.v1';
const CACHE_KEY = 'debts.cache.v1';
const VIEW_KEY = 'debts.view.v1';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* хранилище недоступно */ }
}

function seed() {
  const t = todayKey();
  const d = (o, next) => {
    const x = { id: uid(), owner: 'common', creditor: '', limit: null, rate: null, minPayment: null, payDay: null, paidDue: null, endDate: null, notes: '', files: [], closed: false, createdAt: new Date().toISOString(), ...o };
    if (next !== undefined) setSchedule(x, t, null, addDays(t, next));
    return x;
  };
  const debts = [
    d({ name: 'Сбер — потребкредит', kind: 'loan', creditor: 'Сбербанк', color: 1, start: 600000, balance: 412000, rate: 19.5, minPayment: 18900, endDate: addDays(t, 820), notes: 'Договор № 1234-56. Страховка жизни включена.' }, 23),
    d({ name: 'Тинькофф Платинум', kind: 'card', owner: '1', creditor: 'Т-Банк', color: 2, start: 120000, balance: 78400, limit: 150000, rate: 34.9, minPayment: 4700, notes: 'Беспроцентный период до 55 дней на покупки.' }, 4),
    d({ name: 'Альфа «100 дней»', kind: 'card', owner: '2', creditor: 'Альфа-Банк', color: 3, start: 60000, balance: 41250, limit: 80000, rate: 39.9, minPayment: 2500 }, 1),
    d({ name: 'Рассрочка М.Видео', kind: 'installment', owner: '2', creditor: 'М.Видео', color: 4, start: 36000, balance: 18000, rate: 0, minPayment: 6000, endDate: addDays(t, 85) }, 10),
    d({ name: 'Займер', kind: 'microloan', owner: '1', creditor: 'МФО «Займер»', color: 5, start: 15000, balance: 15000, rate: 292, minPayment: 18600, principal: 15000, accruedTo: t, endDate: addDays(t, 12) }, 12),
    d({ name: 'Хоум Кредит', kind: 'loan', creditor: 'Хоум Банк', color: 6, start: 50000, balance: 0, rate: 24, minPayment: 4400, closed: true }),
  ];
  const ev = (debt, amount, ago, by) => ({ id: uid(), debtId: debt.id, type: 'payment', amount, delta: -amount, date: addDays(t, -ago), by, note: '', dueBefore: null, dueAfter: null, createdAt: new Date().toISOString() });
  const events = [
    ev(debts[0], 18900, 7, 'Клим'), ev(debts[1], 10000, 12, 'Клим'), ev(debts[2], 2500, 30, 'Жена'),
    ev(debts[3], 6000, 20, 'Жена'), ev(debts[5], 4400, 40, 'Клим'), ev(debts[0], 18900, 37, 'Клим'),
  ];
  return { debts, events, members: [{ id: '1', name: 'Клим' }, { id: '2', name: 'Жена' }], me: { id: '1', name: 'Клим', subscribed: true }, bot: '' };
}

let data = remote ? readJSON(CACHE_KEY) : readJSON(DEMO_KEY) || seed();
let loaded = !!data;
if (!data) data = { debts: [], events: [], members: [], me: null, bot: '' };
const saveLocal = () => writeJSON(remote ? CACHE_KEY : DEMO_KEY, data);
if (!remote) saveLocal();

const meName = () => data.me?.name || tg?.initDataUnsafe?.user?.first_name || '';
const findDebt = id => data.debts.find(d => d.id === id);
const ownerName = id => (id === 'common' ? 'Общий' : data.members.find(m => m.id === id)?.name || '');
// «к» / «л» на шкале: у двух карт одного банка цвет один, буква подсказывает, чья
const ownerLetter = id => (id === 'common' ? '' : (ownerName(id)[0] || '').toLowerCase());
const today = () => todayKey();

/* ---------- сервер ---------- */
let denied = null;
let offline = false;   // последний запрос не дошёл: показываем сохранённые данные с пометкой

async function api(body) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...(inTelegram ? { initData: tg.initData } : { token: appToken }) }),
      signal: AbortSignal.timeout?.(20000),
    });
  } catch {
    throw Object.assign(new Error('Нет связи с сервером'), { offline: true });
  }
  offline = false;
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) {
    denied = json.id || tg?.initDataUnsafe?.user?.id || '?';
    render();
  }
  if (res.status === 401 && json.relogin) {
    denied = 'link';
    render();
  }
  if (!res.ok) throw new Error(json.error || 'Нет связи с сервером');
  return json;
}

/** Записать ответ сервера; true — данные изменились и экран надо перерисовать */
function applyState(s) {
  const next = { debts: s.debts || [], events: s.events || [], members: s.members || [], me: s.me || null, bot: s.bot || '' };
  const { savedAt, ...cur } = data;
  const changed = !loaded || JSON.stringify(next) !== JSON.stringify(cur);
  data = { ...next, savedAt: Date.now() };
  loaded = true;
  saveLocal();
  return changed;
}

// Перерисовать после ответа сервера, но не сбивать открытую форму
function refresh() {
  const top = state.stack[state.stack.length - 1];
  if (!top || !['edit', 'op'].includes(top.type)) render();
}

let pending = 0;      // сколько изменений ещё едет на сервер
let queue = Promise.resolve();
let resync = false;   // сервер что-то не принял — после очереди перечитать всё

async function pull() {
  if (!remote || pending) return;
  const wasOffline = offline;
  try {
    const s = await api({ action: 'state' });
    if (pending) return; // пока ждали, появились свежие изменения — их ответ новее
    // Те же данные не перерисовываем: при запуске экран не должен дёргаться
    if (applyState(s) || wasOffline) refresh();
  } catch (e) {
    if (e.offline) {
      offline = true;
      refresh();
    } else if (!denied) toast(e.message);
  }
}

/** Изменение показываем сразу, а на сервер отправляем по очереди в фоне */
function mutate(op, local) {
  // Без сети изменение не дойдёт до сервера и пропадёт при следующей загрузке — честно не даём его сделать
  if (remote && (offline || navigator.onLine === false)) {
    toast('Нет интернета — изменения сейчас не сохранить');
    pull();
    return false;
  }
  local();
  saveLocal();
  if (!remote) return true;
  pending++;
  queue = queue.then(async () => {
    try {
      const s = await api(op);
      if (pending === 1 && !resync) {
        applyState(s);
        refresh();
      }
    } catch (e) {
      resync = true;
      if (e.offline) offline = true;
      if (!denied) toast(e.offline ? 'Нет интернета — изменение не сохранилось' : e.message);
    } finally {
      pending--;
      if (!pending && resync) {
        resync = false;
        pull();
      }
    }
  });
  return true;
}

let toastTimer;
/** Короткое сообщение внизу; action — кнопка вроде «Отменить»: { label, run } */
function toast(text, action) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  const hide = () => el.classList.remove('show');
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { hide(); action.run(); };
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 5000 : 3000);
}

/* ---------- навигация ---------- */
const state = {
  tab: 'home',
  stack: [],
  owner: readJSON(VIEW_KEY)?.owner || 'all',
  intro: true,
};
const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const tip = document.getElementById('tip');

function go(screen) {
  state.stack.push(screen);
  tick();
  render(true, 'push');
}
function back() {
  state.stack.pop();
  render(true, 'pop');
}
function setTab(tab) {
  if (state.tab !== tab) tick();
  state.tab = tab;
  state.stack = [];
  render(true);
}

function render(scrollTop, anim) {
  tip.hidden = true;
  const top = state.stack[state.stack.length - 1];
  if (denied) app.innerHTML = renderDenied();
  else if (!loaded && offline) app.innerHTML = emptyState('Нет интернета', 'Данные ещё ни разу не загружались на этом устройстве. Подключитесь к сети — и всё появится.');
  else if (!loaded) app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  else app.innerHTML = top ? SCREENS[top.type](top) : offlineLine() + TABS[state.tab]();
  document.body.classList.toggle('sub', !!top);
  tabbar.hidden = !!top || !!denied;
  tabbar.innerHTML = renderTabbar();
  if (tgBack) top ? tg.BackButton.show() : tg.BackButton.hide();
  if (scrollTop) window.scrollTo(0, 0);
  if (anim) {
    app.classList.remove('push', 'pop');
    void app.offsetWidth; // перезапуск анимации
    app.classList.add(anim);
  }
  fitLabels();
  drawTrends();
  // во время вводной анимации полоски ещё узкие — перепроверяем подписи, когда она закончится
  if (app.querySelector('.intro')) setTimeout(fitLabels, 1100);
  if (loaded && !top && state.tab === 'home') state.intro = false;
}

// Подписи внутри полосок показываем, только если помещаются; не влезает — пробуем короткую (букву владельца)
function fitLabels(root = app) {
  for (const el of root.querySelectorAll('.scale [data-fit]')) {
    const span = el.firstElementChild;
    if (!span) { el.dataset.fit = 'no'; continue; }
    span.dataset.full ??= span.innerHTML;
    span.innerHTML = span.dataset.full;
    let fits = span.offsetWidth + 10 <= el.clientWidth;
    if (!fits && el.dataset.short) {
      span.textContent = el.dataset.short;
      fits = span.offsetWidth + 6 <= el.clientWidth;
    }
    el.dataset.fit = fits ? 'yes' : 'no';
  }
}
window.addEventListener('resize', () => {
  fitLabels();
  drawTrends();
});

function openLink(url) {
  if (inTelegram && url.startsWith('https://t.me/')) tg.openTelegramLink(url);
  else if (inTelegram) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
const botLink = () => (data.bot ? `https://t.me/${data.bot}` : '');

function haptic(type) {
  try { tg?.HapticFeedback?.notificationOccurred(type); } catch { /* старый клиент */ }
}
function tick() {
  try { tg?.HapticFeedback?.selectionChanged(); } catch { /* старый клиент */ }
}
function confirmAsk(text, cb, okLabel = 'Удалить') {
  if (inTelegram && tg.showConfirm) {
    try { tg.showConfirm(text, cb); return; } catch { /* старый клиент */ }
  }
  // В браузере — своё окно: системный confirm() работает не везде
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-text">
      <p id="sheet-text">${esc(text)}</p>
      <div class="sheet-actions">
        <button class="btn secondary" data-sheet="no">Отмена</button>
        <button class="btn danger-fill" data-sheet="yes">${esc(okLabel)}</button>
      </div>
    </div>`;
  const done = ok => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    cb(ok);
  };
  const onKey = e => { if (e.key === 'Escape') done(false); };
  wrap.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-sheet]');
    if (b) done(b.dataset.sheet === 'yes');
    else if (e.target === wrap) done(false);
  });
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  wrap.querySelector('[data-sheet="no"]').focus();
}

/* ---------- общие куски разметки ---------- */
function navBar(title, right = '') {
  const backBtn = tgBack ? '<span></span>' : `<button class="nav-back" data-action="back">${ICON.back}Назад</button>`;
  return `<div class="navbar">${backBtn}<div class="nav-title">${esc(title)}</div><div class="nav-right">${right}</div></div>`;
}
const infoRow = (label, value) => `<div class="row"><div class="row-label">${label}</div><div class="row-value">${value}</div></div>`;
const field = (label, control, cls = '') =>
  `<label class="field ${cls}"><span class="field-label">${label}</span><span class="field-control">${control}</span></label>`;
const moneyField = (label, name, value, placeholder = '0', extra = '') =>
  field(label, `<input name="${name}" inputmode="decimal" placeholder="${placeholder}" value="${groupNum(value)}" ${extra}><em>₽</em>`, 'num');
// Вне Telegram — демо: честно говорим, что данные примерные
const demoBanner = () => (remote ? '' : `
  <div class="demo" role="note">
    <span>Демо с примером данных. Изменения видны только в этом браузере.</span>
    <button class="link" data-action="reset-demo">Сбросить</button>
  </div>`);
const offlineLine = () => {
  if (!offline) return '';
  const t = data.savedAt ? new Date(data.savedAt) : null;
  const when = t ? ` · данные на ${t.getDate()} ${MONTHS_GEN[t.getMonth()]}, ${t.toTimeString().slice(0, 5)}` : '';
  return `<div class="offline">${ICON.offline}<span>Нет интернета${when}</span></div>`;
};
// Открыли личную ссылку в Safari: осталось поставить иконку на экран
const installBanner = () => (appToken && !standalone ? `
  <div class="card banner">
    ${ICON.share}
    <div><b>Последний шаг — иконка на экран.</b> Внизу Safari нажмите «Поделиться», затем «На экран “Домой”» и «Добавить». Дальше открывайте «Наши долги» с этой иконки: Telegram для этого не нужен.
    <br>Если страница открылась внутри Telegram, сначала выберите «Открыть в Safari».</div>
  </div>` : '');
const emptyState = (title, text) => `<div class="empty"><div class="empty-title">${title}</div><p>${text}</p></div>`;

// Фильтр «чей долг»; если такого владельца больше нет — показываем всех
const currentOwner = () => (state.owner !== 'all' && data.debts.some(d => d.owner === state.owner) ? state.owner : 'all');
const visibleDebts = () => (currentOwner() === 'all' ? data.debts : data.debts.filter(d => d.owner === currentOwner()));

function dueInfo(d) {
  const t = today();
  const due = nextDue(d, t);
  if (!due) return null;
  const days = daysBetween(t, due);
  let when, cls = '';
  if (days < 0) { when = `просрочен на ${-days} ${plural(-days, 'день', 'дня', 'дней')}`; cls = 'late'; }
  else if (days === 0) { when = 'сегодня'; cls = 'soon'; }
  else if (days === 1) { when = 'завтра'; cls = 'soon'; }
  else { when = `через ${days} ${plural(days, 'день', 'дня', 'дней')}`; if (days <= 3) cls = 'soon'; }
  // У карты без минимального платежа сумму знает только банк — не выдаём весь долг за платёж
  return { due, days, when, cls, amount: dueAmount(d, due), approx: lumpSum(d), known: !!d.minPayment || d.kind !== 'card' };
}
const dueText = i => (i.known ? `${i.approx ? '≈\u00a0' : ''}${money(i.amount)}` : 'сумма не указана');
const dueSum = items => items.reduce((s, x) => s + (x.i.known ? x.i.amount : 0), 0);

/** Шкала 100 % → 0 %: слева серым — что уже погасили, справа цветом — что осталось */
function scaleBar(list, size, opts = {}) {
  const t = totals(list);
  const open = list.filter(d => d.balance > 0).sort((a, b) => b.balance - a.balance);
  const paid = Math.max(0, t.start - t.balance);
  const paidLabel = size === 'lg' && t.start ? `<span>погашено ${pctText(paid / t.start)}%</span>` : '<span></span>';
  const segs = open.map(d => {
    const share = t.start ? d.balance / t.start : 0;
    const who = ownerLetter(d.owner);
    const label = size === 'lg' ? `<span>${who ? `<i class="who">${esc(who)}</i>` : ''}${pctText(share)}%</span>` : '<span></span>';
    const attrs = size === 'lg'
      ? `data-go="debt" data-id="${d.id}" data-tip="${esc(d.name)}|${money(d.balance)}" aria-label="${esc(d.name)}: ${money(d.balance)}"${who ? ` data-short="${esc(who)}"` : ''}`
      : '';
    return `<${size === 'lg' ? 'button' : 'div'} class="seg c${d.color}" style="flex:${d.balance} 1 0" data-fit ${attrs}>${label}</${size === 'lg' ? 'button' : 'div'}>`;
  }).join('');
  const paidBlock = paid > 0 || !open.length ? `<div class="scale-paid" style="flex:${paid || 1} 1 0" data-fit>${paidLabel}</div>` : '';
  const axis = size === 'sm'
    ? '<div class="scale-axis"><span>100%</span><span>0%</span></div>'
    : '<div class="scale-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>';
  const label = `Осталось ${pctText(t.pct)}% долга: ${money(t.balance)} из ${money(t.start)}`;
  return `<div class="scale ${size}${opts.intro ? ' intro' : ''}" role="img" aria-label="${esc(label)}"><div class="scale-track">${paidBlock}${segs}</div>${axis}</div>`;
}

/* ---------- таб-бар ---------- */
function renderTabbar() {
  const warn = loaded ? insights(visibleDebts()).filter(x => x.level === 'warn').length : 0;
  const tabs = [['home', 'Долги', ICON.chart], ['payments', 'Платежи', ICON.calendar], ['tips', 'Важное', ICON.bulb, warn]];
  return tabs.map(([key, label, icon, badge]) =>
    `<button class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${icon}${badge ? `<b class="badge">${badge}</b>` : ''}<span>${label}</span></button>`).join('');
}

/* ---------- главная ---------- */
function ownerFilter() {
  const owners = new Set(data.debts.map(d => d.owner));
  if (owners.size < 2) return '';
  const opts = [['all', 'Все'], ...data.members.filter(m => owners.has(m.id)).map(m => [m.id, m.name || 'Без имени'])];
  if (owners.has('common')) opts.push(['common', 'Общие']);
  const cur = currentOwner();
  return `<div class="seg-ctl" role="tablist">${opts.map(([k, l]) =>
    `<button class="${cur === k ? 'on' : ''}" data-action="owner" data-id="${esc(k)}" role="tab" aria-selected="${cur === k}">${esc(l)}</button>`).join('')}</div>`;
}

function totalCard(list) {
  const t = totals(list);
  const free = freeBy(list, today());
  const open = list.filter(isOpen).sort((a, b) => b.balance - a.balance);
  let forecast = '';
  if (free.never) forecast = `<br><span class="warn">По ${free.never === 1 ? 'одному долгу' : `${free.never} долгам`} платёж меньше процентов — он не уменьшается</span>`;
  else if (free.month && !free.unknown) forecast = `<br>Без долгов ≈ <b>${byMonth(free.month)}</b>, если платить минимум`;
  else if (free.month && free.unknown) forecast = '<br>Укажите минимальные платежи — посчитаю, когда закроете всё';
  return `
    <div class="card total">
      <div class="total-head">
        <div class="caption">Осталось выплатить</div>
        <div class="total-pct num">${pctText(t.pct)}<small>%</small></div>
        <div class="total-sum num">${money(t.balance)} <span>из ${money(t.start)}</span></div>
      </div>
      ${scaleBar(list, 'lg', { intro: state.intro })}
      ${open.length ? `<div class="legend">${open.map(d =>
        `<button data-go="debt" data-id="${d.id}"><span class="dot c${d.color}"></span>${esc(d.name)}</button>`).join('')}</div>` : ''}
      <div class="card-foot">
        Погашено <b>${money(t.paid)}</b> · обязательно в месяц <b>${money(t.monthly)}</b>${forecast}
      </div>
    </div>`;
}

function nextCard(list) {
  const items = list.map(d => ({ d, i: dueInfo(d) })).filter(x => x.i).sort((a, b) => a.i.due.localeCompare(b.i.due));
  if (!items.length) return '';
  const { d, i } = items[0];
  const more = items.length - 1;
  return `
    <div class="section-head lg"><h2 class="section-title lg">Ближайший платёж</h2>${more ? `<button class="link" data-tab="payments">Ещё ${more}</button>` : ''}</div>
    <div class="card next tap ${i.cls}" data-go="debt" data-id="${d.id}">
      <div class="next-date"><b>${Number(i.due.slice(8, 10))}</b><span>${MONTHS_SHORT[Number(i.due.slice(5, 7)) - 1]}</span></div>
      <div class="next-main">
        <div class="next-title"><span class="dot c${d.color}"></span><span>${esc(d.name)}</span></div>
        <div class="next-sub ${i.cls === 'late' ? 'late' : ''}">${i.when}</div>
        <div class="next-sum">${dueText(i)}</div>
      </div>
      <button class="chip" data-go="op" data-kind="payment" data-id="${d.id}" data-due="1" aria-label="Оплачено">${ICON.check}<span>Оплачено</span></button>
    </div>`;
}

function debtCard(d) {
  const p = pctLeft(d.balance, d.start);
  const i = dueInfo(d);
  const owner = ownerName(d.owner);
  const foot = !isOpen(d)
    ? '<div class="due done">Погашен ✓</div>'
    : i ? `<div class="due ${i.cls}">${i.cls === 'late' ? `Просрочен с ${dayMonth(i.due)}` : `Платёж ${dayMonth(i.due)}`}<br><b>${dueText(i)}</b></div>`
      : '<div class="due">День платежа не указан</div>';
  return `
    <button class="card debt-card tap ${isOpen(d) ? '' : 'closed'}" data-go="debt" data-id="${d.id}">
      <div class="name"><span class="dot c${d.color}"></span><span>${esc(d.name)}</span></div>
      <div class="meta">${esc([kindName(d.kind), owner].filter(Boolean).join(' · '))}</div>
      <div class="pct num">${pctText(p)}<small>%</small></div>
      <div class="sum">${money(d.balance)}</div>
      ${scaleBar([d], 'sm')}
      ${foot}
    </button>`;
}


function subscribeCard() {
  if (!remote || !data.me || data.me.subscribed || !data.bot) return '';
  return `
    <div class="card banner">
      ${ICON.bell}
      <div><b>Включите напоминания.</b> Откройте чат с ботом и нажмите «Старт» — тогда он будет писать перед каждым платежом.
        <br><button class="chip ghost" data-action="ask">Открыть чат</button></div>
    </div>`;
}

function renderHome() {
  const now = new Date();
  const list = visibleDebts();
  const open = list.filter(isOpen);
  // Микрозаймы — всегда сверху, дальше по убыванию долга, погашенные в конце
  const sorted = [...open].sort((a, b) => (b.kind === 'microloan') - (a.kind === 'microloan') || b.balance - a.balance)
    .concat(list.filter(d => !isOpen(d)));
  const head = `${demoBanner()}${installBanner()}
    <header class="hero row">
      <div>
        <div class="eyebrow">${WEEKDAYS_FULL[now.getDay()]}, ${now.getDate()} ${MONTHS_GEN[now.getMonth()]}</div>
        <h1 class="large-title">Наши долги</h1>
      </div>
      <button class="round-btn" data-go="edit" aria-label="Добавить долг">${ICON.plus}</button>
    </header>`;

  if (!data.debts.length) {
    return `${head}${subscribeCard()}
      <div class="card empty">
        <div class="empty-title">Долгов пока нет</div>
        <p>Добавьте кредитки, кредиты и займы — увидите, сколько осталось и что платить в ближайшие дни.</p>
        <button class="btn primary small" data-go="edit">Добавить долг</button>
      </div>
      <p class="hint-line">Проще всего — отправить боту договор или скриншот из банка: он сам заполнит сумму, ставку и даты.</p>`;
  }

  return `
    ${head}
    ${ownerFilter()}
    ${subscribeCard()}
    ${list.length ? totalCard(list) : emptyState('Здесь пусто', 'У этого человека долгов нет.')}
    ${nextCard(open)}
    ${trendCard(list)}
    ${sorted.length ? `
      <div class="section-head lg"><h2 class="section-title lg">По отдельности</h2></div>
      <div class="grid">${sorted.map(debtCard).join('')}</div>` : ''}
    <button class="btn primary" data-go="edit">${ICON.plus}Добавить долг</button>
    <p class="hint-line">Или отправьте боту договор, график платежей или скриншот — он заполнит всё сам.</p>`;
}

/* ---------- как меняется долг ---------- */
// Долг на дату восстанавливаем по истории: от сегодняшнего остатка откатываем всё, что случилось позже.
// Долги первой недели учёта считаем бывшими всегда, иначе внесение данных выглядело бы как рост;
// долг, появившийся позже, — ступенька вверх в день появления.
function trendModel(list) {
  const t = today();
  if (!list.length) return null;
  const born = d => (d.createdAt || t).slice(0, 10);
  const setupEnd = addDays(list.map(born).sort()[0], 7);
  const start = list.map(born).filter(x => x <= setupEnd).sort().pop();
  if (start >= t) return null;
  const ids = new Set(list.map(d => d.id));
  const events = data.events.filter(e => ids.has(e.debtId));
  const late = d => born(d) > setupEnd;
  const later = (d, day) => events.filter(e => e.debtId === d.id && e.date > day).reduce((s, e) => s + e.delta, 0);
  const valueOn = day => list.reduce((sum, d) => (late(d) && day < born(d) ? sum : sum + Math.max(0, d.balance - later(d, day))), 0);
  return { t, born, late, later, start, events, valueOn };
}

function debtTrend(list) {
  const model = trendModel(list);
  if (!model) return [];
  const { t, born, start, events, valueOn } = model;
  let dates;
  if (daysBetween(start, t) > 62) {
    dates = [start];
    let [y, m] = start.split('-').map(Number);
    for (;;) {
      const end = fromTime(Date.UTC(y, m, 0));
      if (end >= t) break;
      if (end > start) dates.push(end);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    dates.push(t);
  } else {
    dates = [...new Set([start, ...events.map(e => e.date).filter(x => x > start && x < t), ...list.map(born).filter(x => x > start && x < t), t])].sort();
  }
  return dates.map(date => ({ date, value: round2(valueOn(date)) }));
}

function trendHead(list) {
  const pts = debtTrend(list);
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1], diff = last.value - first.value;
  const change = Math.abs(diff) < 1 ? `Без изменений с ${dayMonth(first.date)}`
    : `${diff < 0 ? 'Меньше' : 'Больше'} на ${money(Math.abs(diff))}, чем ${dayMonth(first.date)}`;
  return { change, label: `Общий долг: ${dayMonth(first.date)} — ${money(first.value)}, сейчас — ${money(last.value)}` };
}

function trendCard(list) {
  const head = trendHead(list);
  if (!head) return '';
  return `
    <div class="section-head lg"><h2 class="section-title lg">Как меняется долг</h2><button class="link" data-go="trend">По месяцам</button></div>
    <div class="card trend tap" data-go="trend">
      <div class="caption">${head.change}</div>
      <div class="trend-plot" data-trend="mini" role="img" aria-label="${head.label}"></div>
    </div>`;
}

/* ---------- как менялся долг: по месяцам ---------- */
const cap = s => s[0].toUpperCase() + s.slice(1);
const nextMonth = ym => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

/** Что происходило в каждом месяце учёта, от старого к новому */
function monthStats(list) {
  const model = trendModel(list);
  if (!model) return [];
  const { t, born, late, later, start, events, valueOn } = model;
  const nowYm = t.slice(0, 7), firstYm = start.slice(0, 7);
  // Записи до начала учёта уже вошли в стартовую сумму — изменением месяца их не считаем
  const baked = (e, d) => e.date <= (late(d) ? born(d) : start);
  const out = [];
  for (let ym = firstYm; ym <= nowYm; ym = nextMonth(ym)) {
    const [y, mo] = ym.split('-').map(Number);
    const isFirst = ym === firstYm, ongoing = ym === nowYm;
    const begin = valueOn(isFirst ? start : addDays(`${ym}-01`, -1));
    const end = valueOn(ongoing ? t : fromTime(Date.UTC(y, mo, 0)));
    const row = { ym, ongoing, partial: isFirst && Number(start.slice(8, 10)) > 3, since: isFirst ? start : null, begin, end, change: round2(end - begin), paid: 0, grew: 0, fell: 0, interest: 0, added: 0 };
    const perDebt = new Map();
    const of = d => {
      if (!perDebt.has(d.id)) perDebt.set(d.id, { d, paid: 0, change: 0 });
      return perDebt.get(d.id);
    };
    for (const d of list) {
      if (!late(d) || born(d).slice(0, 7) !== ym) continue;
      const value = Math.max(0, d.balance - later(d, born(d)));
      row.added += value;
      of(d).change += value;
    }
    for (const e of events) {
      if (e.date.slice(0, 7) !== ym) continue;
      const d = list.find(x => x.id === e.debtId);
      const skip = baked(e, d);
      if (e.type === 'payment') {
        row.paid += e.amount;
        of(d).paid += e.amount;
        if (!skip) of(d).change += e.delta;
      } else if (!skip) {
        of(d).change += e.delta;
        if (e.delta > 0) row.grew += e.delta; else row.fell -= e.delta;
        if (e.type === 'interest') row.interest += e.delta;
      }
    }
    row.debts = [...perDebt.values()].filter(x => x.paid || Math.abs(x.change) >= 0.5)
      .sort((a, b) => b.paid - a.paid || Math.abs(b.change) - Math.abs(a.change));
    out.push(row);
  }
  return out;
}

/** Сводка словами. Считаем только записанные платежи. «Меньше всего» ищем лишь среди полных месяцев:
 *  текущий ещё идёт, а первый начался не с начала — иначе худшим всегда оказывался бы неполный */
function trendFacts(months, list) {
  const mo = m => Number(m.ym.slice(5, 7)) - 1;
  const repeats = new Set(months.map(mo)).size < months.length;
  const year = m => (repeats ? ` ${m.ym.slice(0, 4)}` : '');
  const inM = m => `в\u00a0${MONTHS_IN[mo(m)]}${year(m)}`;
  const nameM = m => `${MONTHS[mo(m)]}${year(m)}`;
  const maxBy = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
  const why = m => {
    if (m.added > 0.5) return 'появился новый долг';
    if (m.paid > 0) return 'платежи не перекрыли проценты и новые траты';
    const cause = m.interest > 0 ? 'начислялись проценты' : 'выросли траты или остаток по выписке';
    return withPaid.length ? `${cause}, а платежей в этом месяце не записано` : cause;
  };

  const lines = [];
  const withPaid = months.filter(m => m.paid > 0);
  const full = months.filter(m => !m.ongoing && !m.partial);
  const falls = months.filter(m => m.change < -0.5);
  const rises = months.filter(m => m.change > 0.5);

  if (!withPaid.length) {
    lines.push('Платежей пока не записано. Как только отметите оплату кнопкой «Оплачено» или напишете боту, здесь появится сводка.');
  } else if (withPaid.length === 1) {
    const m = withPaid[0];
    lines.push(`${cap(inM(m))} внесено ${money(m.paid)}${m.ongoing ? ' — месяц ещё идёт' : ''}.`);
  } else {
    const best = maxBy(withPaid, m => m.paid);
    lines.push(`Рекорд по платежам — ${nameM(best)}: ${money(best.paid)}.`);
    if (full.length >= 2) {
      const low = maxBy(full, m => -m.paid);
      if (low.paid < best.paid) lines.push(low.paid > 0 ? `Меньше всего внесено ${inM(low)} — ${money(low.paid)}.` : `${cap(inM(low))} платежей не записано.`);
    }
  }

  if (falls.length) {
    const m = maxBy(falls, x => -x.change);
    // Если месяц один, поясняем, почему долг снизился меньше, чем внесено
    const eaten = months.length === 1 && m.paid > 0 && m.grew >= 0.5 && m.fell < 0.5 && m.added < 0.5;
    if (eaten) lines.push(`${m.grew - m.interest < 0.5 ? 'Проценты добавили' : 'Проценты и новые траты добавили'} ${money(m.grew)}, поэтому долг снизился на ${money(-m.change)}.`);
    else if (falls.length >= 2) lines.push(`Сильнее всего долг снизился ${inM(m)} — на ${money(-m.change)}.`);
    else lines.push(`${cap(inM(m))} долг снизился на ${money(-m.change)}.`);
  }
  if (rises.length) {
    const m = maxBy(rises, x => x.change);
    lines.push(`${cap(inM(m))} долг вырос на ${money(m.change)}: ${why(m)}.`);
  }

  let streak = 0;
  for (let i = full.length - 1; i >= 0 && full[i].change < -0.5; i--) streak++;
  if (streak >= 2) lines.push(`Долг снижается ${streak} ${plural(streak, 'месяц', 'месяца', 'месяцев')} подряд.`);

  const average = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
  const avgPaid = full.length >= 2 ? average(full.map(m => m.paid)) : null;
  if (full.length >= 3) {
    const pace = -average(full.map(m => m.change));
    if (pace >= 1) {
      const left = Math.ceil(months[months.length - 1].end / pace);
      const [y, m] = months[months.length - 1].ym.split('-').map(Number);
      if (left <= 600) lines.push(`При среднем темпе этих месяцев без долгов ≈ ${byMonth(new Date(Date.UTC(y, m - 1 + left, 1)).toISOString().slice(0, 7))}.`);
    }
  }

  const total = months.reduce((s, m) => s + m.paid, 0);
  const rows = [];
  if (total > 0) rows.push(['Всего внесено', money(total)]);
  if (avgPaid !== null) rows.push(['В среднем за месяц', money(avgPaid)]);
  const owners = new Map();
  for (const m of months) for (const x of m.debts) if (x.paid) owners.set(x.d.owner, (owners.get(x.d.owner) || 0) + x.paid);
  if (currentOwner() === 'all' && owners.size >= 2) {
    for (const [id, sum] of [...owners].sort((a, b) => b[1] - a[1])) rows.push([`По долгам: ${esc(ownerName(id))}`, money(sum)]);
  }
  const ids = new Set(list.map(d => d.id));
  const payments = data.events.filter(e => e.type === 'payment' && ids.has(e.debtId));
  if (payments.length >= 2) {
    const top = maxBy(payments, e => e.amount);
    rows.push(['Самый большой платёж', `${money(top.amount)} · ${esc(findDebt(top.debtId)?.name || '')}`]);
  }
  const interest = months.reduce((s, m) => s + m.interest, 0);
  if (interest >= 0.5) rows.push(['Начислено процентов по займам', money(interest)]);
  return { lines, rows, partial: months.some(m => m.ongoing || m.partial) && full.length >= 2 };
}

function monthRow(m) {
  const tag = m.ongoing ? 'идёт' : m.partial ? `учёт с ${dayMonth(m.since)}` : '';
  const change = Math.abs(m.change) < 0.5 ? '<b class="month-change">без изменений</b>'
    : m.change < 0 ? `<b class="month-change minus">−${money(-m.change)}</b>` : `<b class="month-change plus">+${money(m.change)}</b>`;
  const lines = [
    ['Долг на начало', money(m.begin)],
    m.paid ? ['Внесено', `−${money(m.paid)}`] : null,
    m.interest >= 0.5 ? ['Проценты по займам', `+${money(m.interest)}`] : null,
    m.grew - m.interest >= 0.5 ? ['Траты и рост по выпискам', `+${money(m.grew - m.interest)}`] : null,
    m.fell >= 0.5 ? ['Снижение по выпискам', `−${money(m.fell)}`] : null,
    m.added >= 0.5 ? ['Новые долги', `+${money(m.added)}`] : null,
    [m.ongoing ? 'Долг сейчас' : 'Долг на конец', money(m.end)],
  ].filter(Boolean);
  return `
    <details class="card month">
      <summary>
        <div class="month-main">
          <div class="month-title">${monthYear(m.ym)}${tag ? ` <span>${tag}</span>` : ''}</div>
          <div class="month-sub">Внесено ${money(m.paid)}</div>
        </div>
        ${change}
        ${ICON.chevron}
      </summary>
      <div class="month-body">
        ${lines.map(([l, v]) => `<div class="month-line"><span>${l}</span><b class="num">${v}</b></div>`).join('')}
        ${m.debts.length ? `<div class="month-debts">${m.debts.map(x => `
          <button data-go="debt" data-id="${x.d.id}">
            <span class="dot c${x.d.color}"></span><span class="n">${esc(x.d.name)}</span>
            <span class="v">${x.paid ? `внесено ${money(x.paid)}` : Math.abs(x.change) >= 0.5 ? `${x.change > 0 ? '+' : '−'}${money(Math.abs(x.change))}` : ''}</span>
          </button>`).join('')}</div>` : ''}
      </div>
    </details>`;
}

function renderTrend() {
  const list = visibleDebts();
  const months = monthStats(list);
  const head = trendHead(list);
  if (!months.length || !head) return navBar('Как менялся долг') + ownerFilter() + emptyState('Пока рано', 'График появится на второй день учёта.');
  const facts = trendFacts(months, list);
  return `
    ${navBar('Как менялся долг')}
    ${ownerFilter()}
    <div class="card trend">
      <div class="caption">${head.change}</div>
      <div class="trend-plot" data-trend="full" role="img" aria-label="${head.label}"></div>
    </div>

    <h2 class="section-title">Сводка</h2>
    <div class="card story">${facts.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
    ${facts.rows.length ? `<div class="list" style="margin-top:12px">${facts.rows.map(([l, v]) => infoRow(l, v)).join('')}</div>` : ''}
    <p class="form-hint">Считаем записанные платежи: кнопка «Оплачено», приложение или сообщение боту.${facts.partial ? ' Неполные месяцы в «меньше всего» не участвуют.' : ''}</p>

    ${months.length >= 2 ? `
      <h2 class="section-title">Внесено по месяцам</h2>
      <div class="card"><div class="trend-plot bars" data-bars role="img" aria-label="${esc(months.map(m => `${monthYear(m.ym)}: ${money(m.paid)}`).join(', '))}"></div></div>` : ''}

    <h2 class="section-title">По месяцам</h2>
    ${[...months].reverse().map(monthRow).join('')}`;
}

function drawTrends(root = app) {
  drawBars(root);
  const plots = root.querySelectorAll('[data-trend]');
  if (!plots.length) return;
  const pts = debtTrend(visibleDebts());
  for (const el of plots) drawTrend(el, pts);
}

function drawBars(root = app) {
  const el = root.querySelector('[data-bars]');
  const w = el?.clientWidth;
  if (!w) return;
  const rows = monthStats(visibleDebts()).slice(-12);
  const h = 132, top = 22, bottom = 22;
  const band = w / rows.length, width = Math.min(24, band - 6), base = h - bottom;
  const best = rows.reduce((a, b) => (b.paid > a.paid ? b : a));
  const peak = Math.max(best.paid, 1);
  const short = m => MONTHS_SHORT[Number(m.ym.slice(5, 7)) - 1];
  const bars = rows.map((m, i) => {
    const cx = band * (i + .5);
    const barH = m.paid / peak * (base - top);
    if (m.paid <= 0) return '';
    const x0 = cx - width / 2, x1 = cx + width / 2, y = base - barH, r = Math.min(4, barH, width / 2);
    return `<path class="bar${m === best ? ' best' : ''}" d="M${x0} ${base}V${y + r}Q${x0} ${y} ${x0 + r} ${y}H${x1 - r}Q${x1} ${y} ${x1} ${y + r}V${base}Z"/>`;
  }).join('');
  // Подписываем только рекорд и текущий месяц: цифра над каждым столбиком читается хуже
  const last = rows[rows.length - 1];
  const value = m => {
    const cx = band * (rows.indexOf(m) + .5);
    const y = base - m.paid / peak * (base - top) - 6;
    const anchor = cx < 36 ? 'start' : cx > w - 36 ? 'end' : 'middle';
    return `<text class="trend-val" x="${anchor === 'start' ? 0 : anchor === 'end' ? w : cx}" y="${y}" text-anchor="${anchor}">${money(m.paid)}</text>`;
  };
  const step = rows.length > 8 ? 2 : 1;
  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <line class="trend-grid" x1="0" x2="${w}" y1="${base + .5}" y2="${base + .5}"/>
      ${bars}
      ${best.paid > 0 ? value(best) : ''}
      ${last !== best && last.paid > 0 && band > 70 ? value(last) : ''}
      ${rows.map((m, i) => ((rows.length - 1 - i) % step ? '' : `<text class="trend-x" x="${band * (i + .5)}" y="${h - 5}" text-anchor="middle">${short(m)}</text>`)).join('')}
    </svg>
    <div class="trend-tip" hidden></div>`;
  const tipEl = el.querySelector('.trend-tip');
  let timer;
  el.onpointerdown = el.onpointermove = e => {
    clearTimeout(timer);
    const i = Math.min(rows.length - 1, Math.max(0, Math.floor((e.clientX - el.getBoundingClientRect().left) / band)));
    tipEl.textContent = `${monthYear(rows[i].ym)} · ${money(rows[i].paid)}`;
    tipEl.hidden = false;
    tipEl.style.left = `${Math.min(w - tipEl.offsetWidth / 2, Math.max(tipEl.offsetWidth / 2, band * (i + .5)))}px`;
  };
  el.onpointerleave = () => { tipEl.hidden = true; };
  el.onpointerup = () => { timer = setTimeout(() => { tipEl.hidden = true; }, 1500); };
}

function drawTrend(el, pts) {
  const w = el.clientWidth;
  if (!w || pts.length < 2) return;
  const h = el.dataset.trend === 'full' ? 176 : 128, top = 26, bottom = 22, side = 6;
  const values = pts.map(p => p.value);
  const max = Math.max(...values), min = Math.min(...values);
  // Запас по высоте, чтобы мелкое изменение большого долга не выглядело обвалом
  const pad = Math.max(max * 0.04, (max - min) * 0.2, 1);
  const lo = min - pad, hi = max + pad;
  const t0 = toTime(pts[0].date), t1 = toTime(pts[pts.length - 1].date);
  const x = p => side + (toTime(p.date) - t0) / (t1 - t0) * (w - side * 2);
  const y = p => top + (hi - p.value) / (hi - lo) * (h - top - bottom);
  const first = pts[0], last = pts[pts.length - 1];
  const short = s => `${Number(s.slice(8, 10))} ${MONTHS_SHORT[Number(s.slice(5, 7)) - 1]}`;
  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <line class="trend-grid" x1="0" x2="${w}" y1="${h - bottom + .5}" y2="${h - bottom + .5}"/>
      <path class="trend-line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p).toFixed(1)}`).join('')}"/>
      <circle class="trend-dot" cx="${x(last).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4"/>
      <text class="trend-val" x="${side}" y="${(y(first) - 10).toFixed(1)}">${money(first.value)}</text>
      <text class="trend-val" x="${w - side}" y="${(y(last) - 10).toFixed(1)}" text-anchor="end">${money(last.value)}</text>
      <text class="trend-x" x="${side}" y="${h - 5}">${short(first.date)}</text>
      <text class="trend-x" x="${w - side}" y="${h - 5}" text-anchor="end">сегодня</text>
      <line class="trend-cross" y1="${top - 8}" y2="${h - bottom}" style="display:none"/>
      <circle class="trend-focus" r="4" style="display:none"/>
    </svg>
    <div class="trend-tip" hidden></div>`;
  if (el.dataset.trend === 'mini') return; // на главной тап открывает подробности
  const cross = el.querySelector('.trend-cross'), focus = el.querySelector('.trend-focus'), tipEl = el.querySelector('.trend-tip');
  let timer;
  const hide = () => { cross.style.display = focus.style.display = 'none'; tipEl.hidden = true; };
  const show = e => {
    clearTimeout(timer);
    const px = e.clientX - el.getBoundingClientRect().left;
    const p = pts.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
    cross.setAttribute('x1', x(p)); cross.setAttribute('x2', x(p));
    focus.setAttribute('cx', x(p)); focus.setAttribute('cy', y(p));
    cross.style.display = focus.style.display = '';
    tipEl.textContent = `${short(p.date)} · ${money(p.value)}`;
    tipEl.hidden = false;
    tipEl.style.left = `${Math.min(w - tipEl.offsetWidth / 2, Math.max(tipEl.offsetWidth / 2, x(p)))}px`;
  };
  el.onpointerdown = el.onpointermove = show;
  el.onpointerleave = hide;
  el.onpointerup = () => { timer = setTimeout(hide, 1500); };
}

/* ---------- платежи ---------- */
function renderPayments() {
  const t = today();
  const list = visibleDebts();
  const ids = new Set(list.map(d => d.id));
  const upcoming = list.map(d => ({ d, i: dueInfo(d) })).filter(x => x.i).sort((a, b) => a.i.due.localeCompare(b.i.due));
  const month = t.slice(0, 7);
  const dueThisMonth = dueSum(upcoming.filter(x => x.i.due.slice(0, 7) <= month));
  const paidThisMonth = data.events.filter(e => ids.has(e.debtId) && e.type === 'payment' && e.date.slice(0, 7) === month).reduce((s, e) => s + e.amount, 0);
  const events = data.events.filter(e => ids.has(e.debtId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const groups = new Map();
  for (const e of events) {
    const k = e.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  return `
    ${demoBanner()}
    <header class="hero"><h1 class="large-title">Платежи</h1></header>
    ${ownerFilter()}
    <div class="card">
      <div class="caption">Осталось оплатить в ${MONTHS_IN[Number(month.slice(5, 7)) - 1]}</div>
      <div class="total-sum num" style="margin-top:2px">${money(dueThisMonth)}</div>
      <div class="card-foot" style="margin-top:6px">Уже внесено в этом месяце <b>${money(paidThisMonth)}</b></div>
    </div>

    <h2 class="section-title">Ближайшие</h2>
    ${upcoming.length ? `<div class="list">${upcoming.map(({ d, i }) => `
      <div class="row">
        <button class="daybox" data-go="debt" data-id="${d.id}"><b>${Number(i.due.slice(8, 10))}</b><span>${MONTHS_SHORT[Number(i.due.slice(5, 7)) - 1]}</span></button>
        <button class="row-main" data-go="debt" data-id="${d.id}" style="text-align:left">
          <div class="row-title"><span class="dot c${d.color}"></span> ${esc(d.name)}</div>
          <div class="row-sub ${i.cls}">${dueText(i)} · ${i.when}</div>
        </button>
        <button class="mark" data-go="op" data-kind="payment" data-id="${d.id}" data-due="1" aria-label="Отметить оплату">${ICON.check}</button>
      </div>`).join('')}</div>`
      : '<div class="list"><div class="empty"><p>Укажите у долгов дату платежа — здесь появится график, а бот начнёт напоминать.</p></div></div>'}

    ${groups.size ? [...groups].map(([k, items]) => `
      <div class="section-head"><h2 class="section-title">${monthYear(k)}</h2>
        <span>${money(items.filter(e => e.type === 'payment').reduce((s, e) => s + e.amount, 0))}</span></div>
      <div class="list">${items.map(e => eventRow(e)).join('')}</div>`).join('')
      : emptyState('Истории пока нет', 'Отмечайте платежи здесь или пишите боту: «заплатил 5000 по Тинькофф».')}`;
}

function eventRow(e, inDebt = false) {
  const d = findDebt(e.debtId);
  const label = e.type === 'payment' ? 'Платёж' : e.type === 'charge' ? 'Долг вырос' : e.type === 'interest' ? 'Начислены проценты' : 'Новый остаток';
  const sum = e.type === 'payment' ? `<b class="minus">−${money(e.amount)}</b>`
    : e.type === 'charge' || e.type === 'interest' ? `<b class="plus">+${money(e.amount)}</b>` : `<b>${money(e.amount)}</b>`;
  const sub = [dayMonth(e.date), e.by, e.note].filter(Boolean).join(' · ');
  return `
    <button class="row" data-action="event" data-id="${e.id}">
      ${inDebt ? '' : `<span class="dot c${d?.color || 0}"></span>`}
      <div class="row-main">
        <div class="row-title">${inDebt ? label : esc(d?.name || 'Удалённый долг')}</div>
        <div class="row-sub">${esc(inDebt ? sub : `${label} · ${sub}`)}</div>
      </div>
      <div class="row-side">${sum}</div>
    </button>`;
}

/* ---------- важное ---------- */
// Проценты за месяц — оценка по ставке и остатку, без учёта беспроцентных периодов
const monthlyInterest = d => (isOpen(d) && d.rate ? (d.principal || d.balance) * d.rate / 1200 : 0);

/** Что стоит знать о долгах: { level: warn|info, icon, title, text, rows: [{ d, value, go }] } */
function insights(list) {
  const t = today();
  const open = list.filter(isOpen);
  const out = [];

  const week = open.map(d => ({ d, i: dueInfo(d) })).filter(x => x.i && x.i.days <= 7).sort((a, b) => a.i.due.localeCompare(b.i.due));
  const late = week.filter(x => x.i.cls === 'late');
  if (late.length) out.push({ level: 'warn', icon: ICON.bell, title: `Просрочено: ${money(dueSum(late))}`,
    text: 'Отметьте оплату, если уже внесли, — или внесите как можно скорее.', rows: late.map(x => ({ d: x.d, value: `${dueText(x.i)} · ${x.i.when}` })) });
  const soon = week.filter(x => x.i.cls !== 'late');
  if (soon.length) out.push({ level: 'info', icon: ICON.calendar, title: `На этой неделе: ${money(dueSum(soon))}`,
    rows: soon.map(x => ({ d: x.d, value: `${dueText(x.i)} · ${x.i.when}` })) });

  const short = open.filter(d => d.minPayment && d.minPayment < monthlyInterest(d) - 0.5);
  if (short.length) out.push({ level: 'warn', icon: ICON.up, title: 'Платёж меньше процентов',
    text: 'Если вносить только минимум, эти долги будут расти, а не уменьшаться.',
    rows: short.map(d => ({ d, value: `${money(d.minPayment)} / ≈${money(monthlyInterest(d))}` })) });

  const over = open.filter(d => d.kind === 'card' && d.limit && d.balance > d.limit + 0.5);
  if (over.length) out.push({ level: 'warn', icon: ICON.card, title: 'Долг больше лимита',
    text: 'Банки обычно берут плату за превышение лимита и могут заблокировать карту — проверьте условия.',
    rows: over.map(d => ({ d, value: `+${money(d.balance - d.limit)}` })) });
  const full = open.filter(d => d.kind === 'card' && d.limit && d.balance <= d.limit + 0.5 && d.balance / d.limit >= 0.9);
  if (full.length) out.push({ level: 'info', icon: ICON.card, title: 'Лимит почти исчерпан',
    rows: full.map(d => ({ d, value: `свободно ${money(d.limit - d.balance)}` })) });

  const first = byRate(open)[0];
  if (first) {
    const owner = ownerName(first.owner);
    out.push({ level: 'info', icon: ICON.bulb, title: 'Самая высокая ставка',
      text: `Свободные деньги сверх минимума выгоднее всего направлять на «${first.name}»${owner && first.owner !== 'common' ? ` (${owner})` : ''} — у него ${nf1.format(first.rate)}% годовых.`,
      rows: byRate(open).slice(0, 3).map(d => ({ d, value: `${nf1.format(d.rate)}%` })), ask: true });
  }

  const interest = open.map(d => ({ d, v: monthlyInterest(d) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (interest.length) out.push({ level: 'info', icon: ICON.chart, title: `Проценты ≈ ${money(interest.reduce((s, x) => s + x.v, 0))} в месяц`,
    text: 'Оценка по ставке и остатку: где действует беспроцентный период, будет меньше.',
    rows: interest.slice(0, 4).map(x => ({ d: x.d, value: `≈${money(x.v)}` })) });

  const planned = open.filter(d => d.endDate && d.kind !== 'card' && d.endDate >= t).sort((a, b) => a.endDate.localeCompare(b.endDate));
  if (planned.length) out.push({ level: 'info', icon: ICON.check, title: 'Закроются по графику',
    rows: planned.map(d => ({ d, value: `${dayMonth(d.endDate)} ${d.endDate.slice(0, 4)}` })) });

  const missing = open.map(d => ({ d, what: [!d.minPayment && 'платёж', !d.payDay && 'дата', d.rate == null && 'ставка', d.kind === 'microloan' && !d.principal && 'основной долг'].filter(Boolean) })).filter(x => x.what.length);
  if (missing.length) out.push({ level: 'info', icon: ICON.edit, title: 'Не хватает данных',
    text: 'Без них бот не напомнит точную сумму, а прогноз будет неточным.',
    rows: missing.map(x => ({ d: x.d, value: `нет: ${x.what.join(', ')}`, go: 'edit' })) });

  return out;
}

function renderTips() {
  const list = visibleDebts();
  const items = insights(list);
  loadLinks();
  const ask = data.bot || !remote ? `<button class="chip ghost" data-action="ask">${ICON.chat}Спросить бота</button>` : '';
  return `
    ${demoBanner()}
    <header class="hero"><h1 class="large-title">Важное</h1></header>
    ${ownerFilter()}
    ${items.length ? items.map(x => `
      <div class="card insight ${x.level === 'warn' ? 'alert' : ''}">
        <div class="ico">${x.icon}</div>
        <div class="insight-main">
          <div class="insight-title">${esc(x.title)}</div>
          ${x.text ? `<p>${esc(x.text)}</p>` : ''}
          ${x.rows?.length ? `<div class="insight-rows">${x.rows.map(r => `
            <button data-go="${r.go || 'debt'}" data-id="${r.d.id}"><span class="dot c${r.d.color}"></span><span class="n">${esc(r.d.name)}</span><span class="v">${esc(r.value)}</span></button>`).join('')}</div>` : ''}
          ${x.ask ? ask : ''}
        </div>
      </div>`).join('') : emptyState('Всё спокойно', 'Здесь появятся ближайшие платежи, превышения лимита и другие вещи, которые стоит знать.')}
    ${calendarCard()}
    ${phoneCard()}`;
}

/* ---------- личные ссылки: календарь и приложение на экране ---------- */
// Токены получаем заранее: внешнюю ссылку Telegram открывает только сразу после нажатия
const links = {};
let linksAsked = false;
function loadLinks() {
  if (linksAsked || !remote) return;
  linksAsked = true;
  for (const kind of inTelegram ? ['calendar', 'app'] : ['calendar']) {
    api({ action: 'token', kind }).then(r => { links[kind] = r.token; }).catch(() => { linksAsked = false; });
  }
}
function openPersonal(kind) {
  const token = links[kind];
  if (!token) {
    loadLinks();
    return toast('Секунду — готовлю ссылку, нажмите ещё раз');
  }
  const webcal = `${API_URL.replace(/^https:/, 'webcal:')}/calendar?token=${token}`;
  if (!inTelegram) { location.href = webcal; return; }
  // Из Telegram календарь напрямую не открыть: промежуточная страница передаёт адрес в Safari (после # — на сервер не уходит)
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  tg.openLink(kind === 'app' ? `${base}?t=${token}` : `${base}calendar.html#${webcal}`, { try_browser: 'safari' });
}
const linkCard = (icon, title, text, action, label) => `
  <div class="card insight">
    <div class="ico">${icon}</div>
    <div class="insight-main">
      <div class="insight-title">${title}</div>
      <p>${text}</p>
      <button class="chip ghost" data-action="${action}">${ICON.plus}${label}</button>
    </div>
  </div>`;
const calendarCard = () => (remote ? linkCard(ICON.calendar, 'Платежи в Календаре телефона',
  'Все даты появятся в обычном Календаре и будут обновляться сами. Напоминание придёт накануне, даже если Telegram заглушён.', 'calendar', 'Подключить') : '');

/* ---------- иконка на экране телефона ---------- */
let homeStatus = null; // missing | added | unknown | unsupported — так отвечает Telegram
// На iPhone — настоящее отдельное приложение: иконка Telegram всё равно сначала запускает Telegram
function phoneCard() {
  if (!inTelegram) return '';
  if (tg.platform === 'ios') return linkCard(ICON.phone, 'Отдельное приложение на iPhone',
    'Своя иконка на экране: открывается сразу, без Telegram, и работает без интернета.', 'install', 'Установить');
  if (!['missing', 'unknown'].includes(homeStatus)) return '';
  return linkCard(ICON.phone, 'Иконка на экране телефона', '«Наши долги» будут открываться одним нажатием, без поиска чата с ботом.', 'home-screen', 'Добавить на экран');
}
function checkHome() {
  if (!tgVersion('8.0') || !tg.checkHomeScreenStatus) return;
  try {
    tg.checkHomeScreenStatus(s => {
      homeStatus = s;
      if (state.tab === 'tips') refresh();
    });
  } catch { /* старый клиент */ }
}

const TABS = { home: renderHome, payments: renderPayments, tips: renderTips };

/* ---------- экран долга ---------- */
// Заём: сумма растёт каждый день, поэтому показываем её на сегодня и к сроку
function accrualCard(d, i) {
  if (d.kind !== 'microloan' || !isOpen(d)) return '';
  if (!accrues(d)) {
    return `<div class="card banner tap" data-go="edit" data-id="${d.id}">${ICON.bell}<div><b>Проценты растут каждый день.</b> Укажите ставку и основной долг — покажу точную сумму на сегодня и к дате возврата.</div></div>`;
  }
  const t = today();
  const due = i?.due && i.due > t ? i.due : null;
  return `
    <div class="card accrual">
      <div><span>Сегодня к возврату</span><b class="num">≈\u00a0${money(amountOn(d, t))}</b></div>
      ${due ? `<div><span>К ${dayMonth(due)} будет</span><b class="num">≈\u00a0${money(amountOn(d, due))}</b></div>` : ''}
      <div class="card-foot">Основной долг ${money(d.principal)} · проценты ≈\u00a0${money(perDay(d))} в день</div>
    </div>`;
}

function notFound() {
  return navBar('') + emptyState('Долг не найден', 'Возможно, его удалили.');
}

function forecastText(d) {
  if (!isOpen(d)) return '<span class="done">Погашен</span>';
  const m = payoffMonths(d, today());
  if (m === null) return 'укажите платёж';
  if (m === Infinity) return '<span class="warn">платёж меньше процентов</span>';
  const [y, mo] = today().split('-').map(Number);
  const ym = new Date(Date.UTC(y, mo - 1 + m, 1)).toISOString().slice(0, 7);
  return `${byMonth(ym)} · ${m}\u00a0мес.`;
}

function renderDebt({ id }) {
  const d = findDebt(id);
  if (!d) return notFound();
  const p = pctLeft(d.balance, d.start);
  const i = dueInfo(d);
  const owner = ownerName(d.owner);
  const events = data.events.filter(e => e.debtId === d.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return `
    ${navBar('', `<button class="nav-link" data-go="edit" data-id="${d.id}">Изменить</button>`)}
    <div class="debt-head">
      <span class="pill ${isOpen(d) ? '' : 'done'}"><span class="dot c${d.color}"></span>${isOpen(d) ? esc(kindName(d.kind)) : 'Погашен'}</span>
      <h1 class="title">${esc(d.name)}</h1>
      <div class="caption">${esc([d.creditor, owner].filter(Boolean).join(' · '))}</div>
    </div>

    <div class="card">
      <div class="mid-pct">
        <div class="big num">${pctText(p)}<small>%</small></div>
        <div class="sum">${money(d.balance)}<span>осталось из ${money(Math.max(d.start, d.balance))}</span></div>
      </div>
      ${scaleBar([d], 'md')}
      <div class="card-foot">Погашено <b>${money(Math.max(0, d.start - d.balance))}</b></div>
    </div>
    ${accrualCard(d, i)}

    <div class="actions">
      <button class="action" data-go="op" data-kind="payment" data-id="${d.id}">${ICON.check}<span>Платёж</span></button>
      <button class="action" data-go="op" data-kind="balance" data-id="${d.id}">${ICON.edit}<span>Уточнить остаток</span></button>
      <button class="action" data-go="op" data-kind="charge" data-id="${d.id}">${ICON.up}<span>Долг вырос</span></button>
    </div>

    ${i ? `
      <h2 class="section-title">Ближайший платёж</h2>
      <div class="card next ${i.cls}" style="margin:0">
        <div class="next-date"><b>${Number(i.due.slice(8, 10))}</b><span>${MONTHS_SHORT[Number(i.due.slice(5, 7)) - 1]}</span></div>
        <div class="next-main">
          <div class="next-sum" style="margin:0">${dueText(i)}</div>
          <div class="next-sub ${i.cls === 'late' ? 'late' : ''}">${i.when}</div>
        </div>
        <button class="chip" data-go="op" data-kind="payment" data-id="${d.id}" data-due="1" aria-label="Оплачено">${ICON.check}<span>Оплачено</span></button>
      </div>` : ''}

    <h2 class="section-title">Условия</h2>
    <div class="list">
      ${infoRow('Ставка', d.rate !== null && d.rate !== undefined ? `${nf1.format(d.rate)}% годовых` : '—')}
      ${infoRow(d.kind === 'card' ? 'Минимальный платёж' : 'Ежемесячный платёж', d.minPayment ? money(d.minPayment) : '—')}
      ${infoRow('День платежа', d.payDay ? `${d.payDay}-е число` : '—')}
      ${d.kind === 'card' ? infoRow('День выписки', d.statementDay ? `${d.statementDay}-е число` : 'за неделю до платежа спрошу скрин') : ''}
      ${d.kind === 'card' || d.limit ? infoRow('Кредитный лимит', d.limit ? money(d.limit) : '—') : ''}
      ${d.endDate ? infoRow('Окончание', `${dayMonth(d.endDate)} ${d.endDate.slice(0, 4)}`) : ''}
      ${infoRow('Закроется', forecastText(d))}
    </div>

    ${d.notes ? `<h2 class="section-title">Заметки</h2><div class="card text">${esc(d.notes)}</div>` : ''}

    ${d.files?.length ? `
      <h2 class="section-title">Документы</h2>
      <div class="list">${d.files.map(f => `
        <button class="row" data-action="file" data-id="${d.id}" data-file="${esc(f.id)}">
          ${ICON.doc}<div class="row-main"><div class="row-title">${esc(f.name)}</div><div class="row-sub">Прислать в чат с ботом</div></div>${ICON.chevron}
        </button>`).join('')}</div>` : ''}

    <h2 class="section-title">История</h2>
    ${events.length ? `<div class="list">${events.map(e => eventRow(e, true)).join('')}</div>`
      : '<div class="list"><div class="empty"><p>Платежей пока не было</p></div></div>'}

    <button class="btn plain danger" data-action="delete" data-id="${d.id}">Удалить долг</button>`;
}

/* ---------- форма долга ---------- */
function renderEdit({ id }) {
  const d = id ? findDebt(id) : null;
  if (id && !d) return notFound();
  const t = today();
  const kind = d?.kind || 'card';
  const owner = d?.owner || (data.me?.id && data.members.some(m => m.id === data.me.id) ? data.me.id : 'common');
  const color = d?.color || freeColor(data.debts);
  const next = d ? nextDue(d, t) : '';
  const owners = [...data.members.map(m => [m.id, m.name || 'Без имени']), ['common', 'Общий']];

  return `
    <form data-form="edit" data-id="${d ? d.id : ''}" autocomplete="off">
      ${navBar(d ? 'Изменить' : 'Новый долг', '<button class="nav-link strong" type="submit">Готово</button>')}

      <h2 class="section-title">Что это</h2>
      <div class="list">
        ${field('Название', `<input name="name" required maxlength="60" placeholder="Тинькофф Платинум" value="${esc(d?.name)}">`)}
        ${field('Банк или МФО', `<input name="creditor" maxlength="60" placeholder="Т-Банк" value="${esc(d?.creditor)}">`)}
      </div>
      <h2 class="section-title">Тип</h2>
      <div class="chips">${KINDS.map(k => `<label><input type="radio" name="kind" value="${k.key}" ${kind === k.key ? 'checked' : ''}><span>${k.name}</span></label>`).join('')}</div>
      <h2 class="section-title">Чей долг</h2>
      <div class="chips">${owners.map(([k, l]) => `<label><input type="radio" name="owner" value="${esc(k)}" ${owner === k ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>

      <h2 class="section-title">Суммы</h2>
      <div class="list">
        ${moneyField('Осталось', 'balance', d?.balance, '0', 'required')}
        ${moneyField('Было (100%)', 'start', d?.start, 'как «осталось»')}
        ${moneyField('Лимит карты', 'limit', d?.limit)}
        ${field('Основной долг', `<input name="principal" inputmode="decimal" placeholder="без процентов" value="${groupNum(d?.principal)}"><em>₽</em>`, 'num only-microloan')}
      </div>
      <p class="form-hint">«Было» — сумма кредита по договору или долг на момент, с которого считаете. От неё шкала идёт к 0%.</p>

      <h2 class="section-title">Платежи</h2>
      <div class="list">
        ${moneyField('Платёж в месяц', 'minPayment', d?.minPayment, 'минимальный')}
        ${field('Ближайший', `<input name="nextPayment" type="date" value="${esc(next || '')}">`)}
        ${field('Ставка', `<input name="rate" inputmode="decimal" placeholder="0" value="${groupNum(d?.rate)}"><em>%</em>`, 'num')}
        ${field('Окончание', `<input name="endDate" type="date" value="${esc(d?.endDate || '')}">`)}
        ${field('День выписки', `<input name="statementDay" inputmode="numeric" maxlength="2" placeholder="1–31" value="${d?.statementDay ?? ''}"><em>число</em>`, 'num only-card')}
      </div>
      <p class="form-hint">По дате ближайшего платежа бот поймёт число месяца и будет напоминать за 3 дня, накануне и в день оплаты. Ставка — % годовых. После дня выписки бот попросит свежий скриншот из банка. У займа по основному долгу и ставке проценты считаются сами каждый день.</p>

      <h2 class="section-title">Цвет на графике</h2>
      <div class="swatches">${[1, 2, 3, 4, 5, 6, 7, 8].map(c =>
        `<label class="c${c}"><input type="radio" name="color" value="${c}" ${color === c ? 'checked' : ''} aria-label="Цвет ${c}"><span></span></label>`).join('')}</div>

      <h2 class="section-title">Заметки</h2>
      <div class="list"><textarea name="notes" rows="3" maxlength="2000" placeholder="Льготный период, номер договора, страховка…">${esc(d?.notes)}</textarea></div>

      <button class="btn primary" type="submit">Сохранить</button>
    </form>`;
}

/* ---------- платёж / остаток ---------- */
const OPS = {
  payment: { title: 'Платёж', label: 'Сколько внесли', btn: 'Записать платёж' },
  balance: { title: 'Остаток', label: 'Сколько осталось сейчас', btn: 'Сохранить остаток' },
  charge: { title: 'Долг вырос', label: 'На сколько вырос долг', btn: 'Записать' },
};

function renderOp({ id, kind }) {
  const d = findDebt(id);
  if (!d) return notFound();
  const op = OPS[kind] || OPS.payment;
  const i = dueInfo(d);
  // Заём одной суммой платят по сегодняшнему остатку, а не по прогнозу к сроку
  const owed = amountOn(d, today());
  const value = kind === 'payment' ? (lumpSum(d) ? owed : i?.known ? i.amount : d.minPayment || '') : kind === 'balance' ? d.balance : '';
  const quick = kind === 'payment' && d.balance > 0
    ? [d.minPayment && d.minPayment < owed && !lumpSum(d) ? ['Минимум', d.minPayment] : null, ['Весь долг', owed]].filter(Boolean) : [];
  return `
    <form data-form="op" data-id="${d.id}" data-kind="${kind}" autocomplete="off">
      ${navBar(op.title, '<button class="nav-link strong" type="submit">Готово</button>')}
      <div class="op-amount">
        <div class="caption"><span class="dot c${d.color}"></span> ${esc(d.name)}</div>
        <input name="amount" inputmode="decimal" placeholder="0 ₽" value="${value ? groupNum(round2(value)) : ''}" required aria-label="${op.label}">
        <div class="caption">${op.label}${kind !== 'balance' ? ` · сейчас ${money(d.balance)}` : ''}</div>
      </div>
      ${quick.length ? `<div class="quick">${quick.map(([l, v]) => `<button type="button" class="chip ghost" data-action="quick" data-id="${v}">${l} · ${money(v)}</button>`).join('')}</div>` : ''}
      <div class="list" style="margin-top:16px">
        ${field('Дата', `<input name="date" type="date" value="${today()}" max="${today()}" required>`)}
        ${field('Комментарий', '<input name="note" maxlength="120" placeholder="необязательно">')}
      </div>
      ${kind === 'payment' && i?.known && !lumpSum(d) ? `<p class="form-hint">Если внесёте не меньше ${money(i.amount)}, платёж за ${dayMonth(i.due)} отметится как оплаченный.</p>` : ''}
      <button class="btn primary" type="submit">${op.btn}</button>
    </form>`;
}

function renderDenied() {
  if (denied === 'link') {
    return `
    <div class="card empty" style="margin-top:40px">
      <div class="empty-title">Ссылка больше не действует</div>
      <p>Откройте бота в Telegram, вкладку «Важное» в приложении и установите его заново.</p>
    </div>`;
  }
  return `
    <div class="card empty" style="margin-top:40px">
      <div class="empty-title">Нет доступа</div>
      <p>Это личное приложение. Ваш Telegram ID: <b>${esc(denied)}</b><br>Чтобы получить доступ, добавьте его в настройку DEBTS_ALLOWED_IDS.</p>
    </div>`;
}

const SCREENS = { debt: renderDebt, edit: renderEdit, op: renderOp, trend: renderTrend };

/* ---------- сохранение ---------- */

function saveEdit(form) {
  const fd = new FormData(form);
  const id = form.dataset.id;
  const input = {
    name: String(fd.get('name') || '').trim(),
    creditor: String(fd.get('creditor') || '').trim(),
    kind: fd.get('kind') || 'other',
    owner: fd.get('owner') || 'common',
    balance: parseNum(fd.get('balance')) ?? 0,
    start: parseNum(fd.get('start')),
    limit: parseNum(fd.get('limit')),
    minPayment: parseNum(fd.get('minPayment')),
    rate: parseNum(fd.get('rate')),
    principal: parseNum(fd.get('principal')),
    statementDay: parseInt(fd.get('statementDay'), 10) || null,
    nextPayment: fd.get('nextPayment') || null,
    endDate: fd.get('endDate') || null,
    color: Number(fd.get('color')) || 1,
    notes: String(fd.get('notes') || '').trim(),
  };
  if (!input.name) return toast('Введите название');
  // payDay: null — убрать график, если дату ближайшего платежа стёрли
  const debtId = id || uid(), eventId = uid();
  const payload = { ...input, id: debtId, payDay: input.nextPayment ? undefined : null };
  const ok = mutate({ action: 'save_debt', create: !id, eventId, debt: payload }, () => {
    const t = today();
    if (id) {
      const d = findDebt(id);
      const prevNext = nextDue(d, t);
      Object.assign(d, { name: input.name, creditor: input.creditor, kind: input.kind, owner: input.owner, limit: input.limit, minPayment: input.minPayment, rate: input.rate, endDate: input.endDate, color: input.color, notes: input.notes, principal: input.principal, statementDay: input.statementDay });
      if (d.kind === 'microloan' && d.rate && d.principal && !d.accruedTo) d.accruedTo = t;
      if (input.start !== null) d.start = input.start;
      if (input.nextPayment && input.nextPayment !== prevNext) setSchedule(d, t, null, input.nextPayment);
      if (!input.nextPayment) setSchedule(d, t, null, null);
      if (input.balance !== d.balance) data.events.push({ ...applyBalance(d, input.balance, t, meName(), 'Остаток изменён вручную'), id: eventId });
      d.start = Math.max(d.start, d.balance);
    } else {
      const d = { id: debtId, ...input, start: Math.max(input.start ?? 0, input.balance), payDay: null, paidDue: null, files: [], closed: false, createdAt: new Date().toISOString(), accruedTo: input.kind === 'microloan' && input.rate && input.principal ? t : null };
      delete d.nextPayment;
      setSchedule(d, t, null, input.nextPayment);
      data.debts.push(d);
    }
  });
  if (ok) {
    haptic('success');
    back();
  }
}

function saveOp(form) {
  const fd = new FormData(form);
  const { id, kind } = form.dataset;
  const amount = parseNum(fd.get('amount'));
  if (amount === null || (kind !== 'balance' && amount <= 0)) return toast('Введите сумму');
  const date = fd.get('date') || today();
  const note = String(fd.get('note') || '').trim();
  const d0 = findDebt(id);
  // Лишний ноль — частая опечатка: платёж больше долга сначала переспрашиваем
  if (kind === 'payment' && d0 && amount > amountOn(d0, today()) + 0.5 && !form.dataset.over) {
    return confirmAsk(`Это больше всего долга (${money(amountOn(d0, today()))}). Записать и считать долг погашенным?`, ok => {
      if (!ok) return;
      form.dataset.over = '1';
      saveOp(form);
    }, 'Записать');
  }
  const eventId = uid();
  const ok = mutate({ action: kind === 'payment' ? 'pay' : kind, debtId: id, amount, date, note, eventId }, () => {
    const d = findDebt(id);
    if (kind === 'payment') accrue(d, today());
    const e = kind === 'payment'
      ? applyPayment(d, data.events, amount, date, meName(), note, today())
      : kind === 'charge'
        ? Object.assign(applyBalance(d, d.balance + amount, date, meName(), note, 'charge'), { amount })
        : applyBalance(d, amount, date, meName(), note);
    data.events.push({ ...e, id: eventId });
  });
  if (ok) {
    haptic('success');
    const d = findDebt(id);
    const undo = { label: 'Отменить', run: () => deleteEvent(eventId) };
    if (d && kind === 'payment' && d.balance === 0) toast('Долг погашен! 🎉', undo);
    else toast({ payment: `Платёж ${money(amount)} записан`, balance: 'Остаток обновлён', charge: `Долг вырос на ${money(amount)}` }[kind], undo);
    back();
  }
}

function deleteEvent(id) {
  const e = data.events.find(x => x.id === id);
  if (!e) return;
  mutate({ action: 'delete_event', id }, () => {
    const d = findDebt(e.debtId);
    if (d) revertEvent(d, e);
    data.events = data.events.filter(x => x.id !== id);
  });
  tick();
  render();
}

async function handleAction(action, id, el) {
  if (action === 'back') return back();
  if (action === 'owner') {
    state.owner = id;
    writeJSON(VIEW_KEY, { owner: id });
    tick();
    return render();
  }
  if (action === 'calendar') return openPersonal('calendar');
  if (action === 'install') return openPersonal('app');
  if (action === 'home-screen') {
    try { tg.addToHomeScreen(); } catch { toast('Эта версия Telegram не умеет добавлять иконку'); }
    return;
  }
  if (action === 'ask') {
    const link = botLink();
    if (link) return openLink(link);
    if (inTelegram) return tg.close();
    return toast('В Telegram эта кнопка откроет чат с ботом');
  }
  if (action === 'reset-demo') {
    return confirmAsk('Вернуть пример данных? Ваши изменения в демо пропадут.', ok => {
      if (!ok) return;
      data = seed();
      saveLocal();
      state.stack = [];
      state.intro = true;
      render(true);
    }, 'Сбросить');
  }
  if (action === 'quick') {
    const input = app.querySelector('input[name="amount"]');
    if (input) input.value = groupNum(id);
    return tick();
  }
  if (action === 'file') {
    if (!remote) return toast('В демо-режиме файлов нет');
    try {
      await api({ action: 'send_file', debtId: id, fileId: el.dataset.file });
      toast('Отправил документ в чат с ботом');
    } catch (e) {
      toast(e.message);
    }
    return;
  }
  if (action === 'event') {
    const e = data.events.find(x => x.id === id);
    if (!e || e.type === 'interest') return;
    const what = e.type === 'payment' ? `платёж ${money(e.amount)}` : 'эту запись';
    return confirmAsk(`Удалить ${what} от ${dayMonth(e.date)}? Остаток долга вернётся как было.`, ok => ok && deleteEvent(id));
  }
  if (action === 'delete') {
    const d = findDebt(id);
    return confirmAsk(`Удалить «${d?.name}» вместе с историей платежей?`, ok => {
      if (!ok) return;
      const done = mutate({ action: 'delete_debt', id }, () => {
        data.debts = data.debts.filter(x => x.id !== id);
        data.events = data.events.filter(x => x.debtId !== id);
      });
      if (done) {
        state.stack = state.stack.filter(s => s.id !== id);
        render(true, 'pop');
      }
    });
  }
}

/* ---------- события ---------- */
document.addEventListener('click', e => {
  const act = e.target.closest('[data-action]');
  if (act) {
    e.preventDefault();
    return handleAction(act.dataset.action, act.dataset.id, act);
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  const target = e.target.closest('[data-go]');
  if (target) {
    e.stopPropagation();
    const { go: type, ...rest } = target.dataset;
    go({ type, ...rest });
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.form === 'edit') saveEdit(form);
  if (form.dataset.form === 'op') saveOp(form);
});

// Суммы разбиваем на разряды прямо при вводе, курсор остаётся у той же цифры
document.addEventListener('input', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.inputMode !== 'decimal') return;
  const pos = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, pos).replace(/[^\d.,]/g, '').length;
  const next = groupNum(el.value);
  if (next === el.value) return;
  el.value = next;
  let i = 0;
  for (let n = 0; i < next.length && n < before; i++) if (/[\d,]/.test(next[i])) n++;
  el.setSelectionRange(i, i);
});

// Подсказка над полоской: название и сумма
function showTip(el) {
  const [name, sum] = el.dataset.tip.split('|');
  tip.innerHTML = `${esc(name)} · <b>${esc(sum)}</b>`;
  const r = el.getBoundingClientRect();
  tip.hidden = false;
  const half = tip.offsetWidth / 2 + 8;
  tip.style.left = Math.min(window.innerWidth - half, Math.max(half, r.left + r.width / 2)) + 'px';
  tip.style.top = r.top + 'px';
}
document.addEventListener('pointerover', e => {
  const el = e.target.closest?.('[data-tip]');
  if (el && e.pointerType === 'mouse') showTip(el);
});
document.addEventListener('pointerout', e => {
  if (e.target.closest?.('[data-tip]')) tip.hidden = true;
});
document.addEventListener('focusin', e => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el);
});
document.addEventListener('focusout', () => { tip.hidden = true; });
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

/* ---------- смахивание вправо = назад ---------- */
// Палец ведёт экран, под ним уже виден предыдущий — как в обычных приложениях iPhone.
// Не мешаем полям ввода и вертикальной прокрутке.
const SWIPE_SKIP = 'input, textarea, select, .swatches, .chips, [data-trend]';
let swipe = null;

function swipeLayer() {
  const prev = state.stack[state.stack.length - 2];
  const layer = document.createElement('div');
  layer.id = 'under';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<div class="under-col">${prev ? SCREENS[prev.type](prev) : offlineLine() + TABS[state.tab]()}</div>`;
  document.body.prepend(layer);
  fitLabels(layer);
  drawTrends(layer);
  if (!prev) tabbar.hidden = false;
  return layer;
}

document.addEventListener('touchstart', e => {
  swipe = null;
  if (e.touches.length !== 1 || !state.stack.length || denied || document.querySelector('.sheet-wrap')) return;
  if (e.target.closest?.(SWIPE_SKIP) || document.activeElement?.matches?.('input, textarea')) return;
  const p = e.touches[0];
  swipe = { x: p.clientX, y: p.clientY, at: e.timeStamp, dx: 0, on: false, layer: null };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!swipe) return;
  const p = e.touches[0];
  const dx = p.clientX - swipe.x, dy = p.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.hypot(dx, dy) < 10) return;
    if (dx <= 0 || Math.abs(dy) > dx * 0.6) { swipe = null; return; }
    swipe.on = true;
    app.classList.remove('push', 'pop');
    document.body.classList.add('swiping');
    swipe.layer = swipeLayer();
  }
  if (e.cancelable) e.preventDefault();
  swipe.dx = Math.max(0, dx);
  app.style.transform = `translate3d(${swipe.dx}px, 0, 0)`;
  swipe.layer.style.transform = `translate3d(${(swipe.dx / window.innerWidth - 1) * 28}%, 0, 0)`;
}, { passive: false });

function endSwipe(e) {
  const s = swipe;
  swipe = null;
  if (!s?.on) return;
  const w = window.innerWidth;
  const fast = s.dx > 48 && s.dx / Math.max(1, e.timeStamp - s.at) > 0.5;
  const leave = e.type === 'touchend' && (s.dx > w * 0.3 || fast);
  app.style.transition = s.layer.style.transition = 'transform .2s ease-out';
  app.style.transform = leave ? `translate3d(${w}px, 0, 0)` : 'translate3d(0, 0, 0)';
  s.layer.style.transform = leave ? 'translate3d(0, 0, 0)' : 'translate3d(-28%, 0, 0)';
  setTimeout(() => {
    app.style.transition = app.style.transform = '';
    document.body.classList.remove('swiping');
    s.layer.remove();
    if (leave) {
      state.stack.pop();
      tick();
      render(true);
    } else {
      tabbar.hidden = !!state.stack.length;
    }
  }, 210);
}
document.addEventListener('touchend', endSwipe);
document.addEventListener('touchcancel', endSwipe);

/* ---------- старт ---------- */
function applyTheme() {
  if (!inTelegram) return;
  const dark = tg.colorScheme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    tg.setHeaderColor(dark ? '#000000' : '#F2F2F7');
    tg.setBackgroundColor(dark ? '#000000' : '#F2F2F7');
    tg.setBottomBarColor?.(dark ? '#000000' : '#F2F2F7');
  } catch { /* старый клиент */ }
}

if (inTelegram) {
  tg.expand();
  applyTheme();
  tg.onEvent('themeChanged', applyTheme);
  if (tgBack) tg.BackButton.onClick(back);
  // Кнопка «Открыть» уже запускает на весь экран (режим задан в BotFather); повторная просьба заставила бы экран дёрнуться
  if (tgVersion('8.0') && ['ios', 'android'].includes(tg.platform) && !tg.isFullscreen) {
    try { tg.requestFullscreen(); } catch { /* не поддерживается */ }
  }
  if (tgVersion('7.7')) tg.disableVerticalSwipes();
  checkHome();
  tg.onEvent('homeScreenAdded', () => {
    homeStatus = 'added';
    toast('Иконка добавлена на экран');
    refresh();
  });
  // Отступы от шапки Telegram приходят уже после запуска: запоминаем их, чтобы в следующий раз экран сразу стоял на месте (см. index.html)
  const saveInsets = () => {
    if (tg.isFullscreen) writeJSON('debts.insets.v1', { t: tg.safeAreaInset?.top || 0, c: tg.contentSafeAreaInset?.top || 0 });
  };
  tg.onEvent('safeAreaChanged', saveInsets);
  tg.onEvent('contentSafeAreaChanged', saveInsets);
}

render();
// «Готово» говорим только после первого кадра: до этого Telegram держит заставку, и не видно, как экран собирается
if (inTelegram) requestAnimationFrame(() => requestAnimationFrame(() => tg.ready()));

if (remote) {
  pull();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  window.addEventListener('online', pull);
  window.addEventListener('offline', () => {
    offline = true;
    refresh();
  });
}

// Файлы приложения кладём в кэш телефона: открывается мгновенно и без сети показывает последние данные
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* webview без service worker — работаем как раньше */ });
}
