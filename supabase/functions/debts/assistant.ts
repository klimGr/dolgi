// Общая часть помощника: подсказка для модели, инструменты, контекст и разговор.
// Сама модель подключается отдельно: Gemini (gemini.ts), Groq (groq.ts) — оба бесплатные — или Claude (claude.ts).
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY } from './config.ts';
import * as db from './db.ts';
import { daysBetween, type Debt, type DebtFile, isDate, KINDS, nextDue, payoffMonths, pctLeft } from './logic.ts';
import * as svc from './service.ts';

export const SYSTEM = `Ты — помощник семейной пары по долгам в Telegram-боте. У них кредитные карты, кредиты и займы. Твоя задача — держать учёт в порядке, помогать не пропускать платежи и вместе выбираться из долгов.

В начале каждого сообщения пользователя есть блок «Контекст»: сегодняшняя дата, кто пишет, участники и текущие долги в JSON. Это актуальные данные из базы — опирайся на них и ссылайся на долги по id. Всё, что ты меняешь инструментами, сразу видно в мини-приложении с графиком.

Документы. Когда присылают договор, график платежей, выписку, скриншот из банковского приложения или фото, найди: кредитора, тип долга, сумму по договору, текущий остаток, лимит (для карт), процентную ставку (% годовых; если указана дневная — переведи в годовые ×365 и скажи об этом), обязательный или минимальный платёж, дату или число платежа, дату окончания. ПСК — не ставка: её можно упомянуть в заметках. Если такой долг уже есть в списке (тот же банк и продукт) — обнови его, иначе добавь новый. Не придумывай значения, которых нет в документе: оставь поле пустым и коротко перечисли, чего не хватает. Если документ не про долг или его не прочитать — так и скажи.

Сообщения про деньги: «заплатил 5000 по Тинькофф» — платёж; «по карте сейчас 48 300» — новый остаток; «потратила 3000 с кредитки» — долг вырос. Если непонятно, о каком долге речь или какая сумма, — переспроси, а не угадывай. После изменения коротко подтверди, что сделал, и назови новый остаток. Удалять долги ты не можешь — для этого есть приложение.

Советы. Разбирай ситуацию на их цифрах и предлагай конкретный план в рублях и месяцах: что гасить в первую очередь (обычно самое дорогое по ставке — «лавина»; или самый маленький долг ради мотивации — «снежный ком»), как не терять льготный период по картам, когда имеет смысл рефинансирование, куда направить свободные деньги. Обязательные платежи пропускать нельзя: просрочка — это штрафы и испорченная кредитная история. Займы МФО обычно самые дорогие. Не предлагай брать новые займы, чтобы закрыть старые. Если человеку тяжело, поддержи и подскажи законные варианты: реструктуризация, кредитные каникулы, разговор с банком. Ты не финансовый консультант, но говори прямо и по делу, без нравоучений.

Стиль: по-русски, тепло и коротко — это чат в телефоне. Простой текст без Markdown-заголовков и таблиц; суммы можно выделить **жирным**; списки — с «•». Суммы пиши как «12 500 ₽», даты — как «15 ноября».`;

/* ---------- инструменты ---------- */
const debtFields = {
  name: { type: 'string', description: 'Короткое понятное название: «Тинькофф Платинум», «Сбер — потребкредит», «Займер»' },
  kind: { type: 'string', enum: KINDS, description: 'card — кредитная карта, loan — кредит, microloan — займ МФО, installment — рассрочка, other — другое' },
  owner: { type: 'string', description: 'Чей долг: id участника из контекста или "common", если общий или неизвестно' },
  creditor: { type: 'string', description: 'Банк или МФО' },
  start: { type: 'number', description: 'Сумма, от которой считаем 100 %: сумма кредита по договору; для карты — долг на сегодня (не лимит)' },
  balance: { type: 'number', description: 'Сколько осталось отдать сейчас, ₽' },
  limit: { type: 'number', description: 'Кредитный лимит карты, ₽' },
  rate: { type: 'number', description: 'Процентная ставка, % годовых' },
  min_payment: { type: 'number', description: 'Обязательный (минимальный или ежемесячный) платёж, ₽' },
  pay_day: { type: 'integer', minimum: 1, maximum: 31, description: 'Число месяца, до которого нужно платить' },
  next_payment: { type: 'string', description: 'Дата ближайшего платежа YYYY-MM-DD, если известна точно — точнее, чем pay_day' },
  end_date: { type: 'string', description: 'Дата окончания договора или последнего платежа, YYYY-MM-DD' },
  notes: { type: 'string', description: 'Важное из договора: льготный период, ПСК, штрафы, страховка, номер договора' },
} as const;

export interface ToolDef { name: string; description: string; properties: Record<string, unknown>; required: string[] }
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef =>
  ({ name, description, properties, required });

const idField = { debt_id: { type: 'string', description: 'id долга из контекста' } };
const dateField = { date: { type: 'string', description: 'Дата YYYY-MM-DD, по умолчанию сегодня' } };
const noteField = { note: { type: 'string', description: 'Комментарий, необязательно' } };

export const TOOLS: ToolDef[] = [
  tool('add_debt', 'Добавить новый долг: карту, кредит, займ или рассрочку.', debtFields, ['name', 'kind', 'balance']),
  tool('update_debt', 'Изменить данные существующего долга. Передавай только то, что меняется. closed=true — долг закрыт.', {
    ...idField,
    ...debtFields,
    closed: { type: 'boolean', description: 'Долг полностью закрыт' },
  }, ['debt_id']),
  tool('record_payment', 'Записать платёж по долгу: уменьшает остаток и отмечает обязательный платёж, если внесён минимум.', {
    ...idField,
    amount: { type: 'number', description: 'Сумма платежа, ₽' },
    ...dateField,
    ...noteField,
  }, ['debt_id', 'amount']),
  tool('set_balance', 'Указать точный текущий остаток долга (например, из выписки или приложения банка).', {
    ...idField,
    balance: { type: 'number', description: 'Новый остаток, ₽' },
    ...dateField,
    ...noteField,
  }, ['debt_id', 'balance']),
  tool('add_charge', 'Долг вырос: покупка по кредитке, снятие наличных, штраф, начисленные проценты.', {
    ...idField,
    amount: { type: 'number', description: 'На сколько вырос долг, ₽' },
    ...dateField,
    ...noteField,
  }, ['debt_id', 'amount']),
  tool('payment_history', 'Последние платежи и изменения остатка — по одному долгу или по всем.', {
    debt_id: { type: 'string', description: 'id долга; не указывай, чтобы получить по всем' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Сколько записей, по умолчанию 30' },
  }, []),
];

/* ---------- проверка входа инструментов ---------- */
type Input = Record<string, unknown>;
type Check = 'string' | 'number' | 'integer' | 'boolean';

function validate(input: unknown, spec: Record<string, Check>, required: string[]): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Ожидался объект';
  const o = input as Input;
  for (const k of required) if (o[k] === undefined || o[k] === null || o[k] === '') return `Не хватает поля ${k}`;
  for (const [k, v] of Object.entries(o)) {
    const t = spec[k];
    if (!t) return `Неизвестное поле ${k}`;
    if (v === null || v === undefined) continue;
    const fits = t === 'integer' ? Number.isInteger(v) && (v as number) >= 0
      : t === 'number' ? typeof v === 'number' && Number.isFinite(v) && v >= 0
      : t === 'boolean' ? typeof v === 'boolean'
      : typeof v === 'string';
    if (!fits) return `Поле ${k} должно быть типа ${t}`;
  }
  for (const k of ['date', 'next_payment', 'end_date']) {
    if (o[k] !== undefined && o[k] !== null && !isDate(o[k])) return `Поле ${k} должно быть датой YYYY-MM-DD`;
  }
  if (o.kind !== undefined && !KINDS.includes(o.kind as never)) return 'Неизвестный тип долга';
  return null;
}

const FIELD_TYPES: Record<string, Check> = {
  name: 'string', kind: 'string', owner: 'string', creditor: 'string', start: 'number', balance: 'number', limit: 'number',
  rate: 'number', min_payment: 'number', pay_day: 'integer', next_payment: 'string', end_date: 'string', notes: 'string',
};
const SPECS: Record<string, { spec: Record<string, Check>; required: string[] }> = {
  add_debt: { spec: FIELD_TYPES, required: ['name', 'kind', 'balance'] },
  update_debt: { spec: { ...FIELD_TYPES, debt_id: 'string', closed: 'boolean' }, required: ['debt_id'] },
  record_payment: { spec: { debt_id: 'string', amount: 'number', date: 'string', note: 'string' }, required: ['debt_id', 'amount'] },
  set_balance: { spec: { debt_id: 'string', balance: 'number', date: 'string', note: 'string' }, required: ['debt_id', 'balance'] },
  add_charge: { spec: { debt_id: 'string', amount: 'number', date: 'string', note: 'string' }, required: ['debt_id', 'amount'] },
  payment_history: { spec: { debt_id: 'string', limit: 'integer' }, required: [] },
};

const toInput = (o: Input): svc.DebtInput => ({
  name: o.name as string | undefined,
  kind: o.kind as string | undefined,
  owner: o.owner as string | undefined,
  creditor: o.creditor as string | undefined,
  start: o.start as number | undefined,
  balance: o.balance as number | undefined,
  limit: o.limit as number | undefined,
  rate: o.rate as number | undefined,
  minPayment: o.min_payment as number | undefined,
  payDay: o.pay_day as number | undefined,
  nextPayment: o.next_payment as string | undefined,
  endDate: o.end_date as string | undefined,
  notes: o.notes as string | undefined,
  closed: o.closed as boolean | undefined,
});

export interface Ctx { by: string; files: DebtFile[]; today: string; changed: boolean }

export async function runTool(name: string, raw: unknown, ctx: Ctx): Promise<{ content: string; isError?: boolean }> {
  const def = SPECS[name];
  if (!def) return { content: `Нет инструмента ${name}`, isError: true };
  const problem = validate(raw, def.spec, def.required);
  if (problem) return { content: JSON.stringify({ INVALID_INPUT: problem, input: raw }), isError: true };
  const o = raw as Input;
  try {
    switch (name) {
      case 'add_debt': {
        let d = await svc.createDebt(toInput(o), ctx.files[0]);
        for (const f of ctx.files.slice(1)) d = await svc.updateDebt(d.id, {}, ctx.by, f);
        ctx.changed = true;
        return { content: JSON.stringify({ ok: true, debt: brief(d, ctx.today) }) };
      }
      case 'update_debt': {
        const id = String(o.debt_id);
        let d = await svc.updateDebt(id, toInput(o), ctx.by, ctx.files[0]);
        for (const f of ctx.files.slice(1)) d = await svc.updateDebt(id, {}, ctx.by, f);
        ctx.changed = true;
        return { content: JSON.stringify({ ok: true, debt: brief(d, ctx.today) }) };
      }
      case 'record_payment': {
        const r = await svc.pay(String(o.debt_id), o.amount, o.date, ctx.by, (o.note as string) || '');
        ctx.changed = true;
        return { content: JSON.stringify({ ok: true, debt: brief(r.debt, ctx.today) }) };
      }
      case 'set_balance':
      case 'add_charge': {
        const value = name === 'set_balance' ? o.balance : o.amount;
        const r = await svc.setBalance(String(o.debt_id), value, o.date, ctx.by, (o.note as string) || '', name === 'add_charge' ? 'charge' : 'balance');
        ctx.changed = true;
        return { content: JSON.stringify({ ok: true, debt: brief(r.debt, ctx.today) }) };
      }
      case 'payment_history': {
        const list = await db.events(Number(o.limit) || 30, o.debt_id ? String(o.debt_id) : undefined);
        return { content: JSON.stringify(list.map(e => ({ debt_id: e.debtId, type: e.type, amount: e.amount, change: e.delta, date: e.date, by: e.by, note: e.note }))) };
      }
    }
  } catch (e) {
    return { content: e instanceof svc.UserError ? e.message : 'Ошибка базы данных, попробуй ещё раз позже', isError: true };
  }
  return { content: 'Неизвестный инструмент', isError: true };
}

/* ---------- контекст ---------- */
function brief(d: Debt, today: string) {
  const due = nextDue(d, today);
  const months = payoffMonths(d, today);
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    owner: d.owner,
    creditor: d.creditor || undefined,
    start: d.start,
    balance: d.balance,
    left_pct: Math.round(pctLeft(d.balance, d.start) * 100),
    limit: d.limit ?? undefined,
    rate: d.rate ?? undefined,
    min_payment: d.minPayment ?? undefined,
    pay_day: d.payDay ?? undefined,
    next_due: due ?? undefined,
    days_to_due: due ? daysBetween(today, due) : undefined,
    payoff_months_at_min: months === Infinity ? 'не гасится: платёж меньше процентов' : months ?? undefined,
    end_date: d.endDate ?? undefined,
    notes: d.notes ? d.notes.slice(0, 300) : undefined,
    files: d.files.length || undefined,
    closed: d.closed || undefined,
  };
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function contextText(st: Awaited<ReturnType<typeof svc.state>>, me: { id: string; name: string }) {
  const weekday = WEEKDAYS[new Date(st.today + 'T12:00:00Z').getUTCDay()];
  const people = st.members.map(m => `${m.name || 'без имени'} (id ${m.id})`).join(', ') || 'пока никого';
  return [
    'Контекст',
    `Сегодня: ${st.today}, ${weekday}.`,
    `Пишет: ${me.name || 'без имени'} (id ${me.id}).`,
    `Участники: ${people}. Владелец "common" — общий долг.`,
    `Долги (${st.debts.length}): ${JSON.stringify(st.debts.map(d => brief(d, st.today)))}`,
  ].join('\n');
}


/* ---------- ошибки моделей ---------- */
export type AiErrorKind = 'none' | 'auth' | 'rate' | 'region' | 'bad' | 'down';

/** Ошибка ИИ, понятная боту: по ней он выбирает, что сказать человеку */
export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

/* ---------- разговор ---------- */
/** Файл из чата: PDF или картинка — в base64, текстовый файл — строкой */
export interface Attachment { file: DebtFile; mime: string; base64?: string; text?: string }
export interface Turn { role: 'user' | 'assistant'; text: string }
export interface RunArgs { history: Turn[]; context: string; attachments: Attachment[]; userText: string; ctx: Ctx }
export type Runner = (args: RunArgs) => Promise<string>;

type Provider = 'gemini' | 'groq' | 'claude';
const KEYS: Record<Provider, () => string> = { gemini: GEMINI_API_KEY, groq: GROQ_API_KEY, claude: ANTHROPIC_API_KEY };
// Провайдер с неподходящим ключом пропускаем час, чтобы не тратить на него время в каждом сообщении
const broken = new Map<Provider, number>();

async function load(p: Provider): Promise<Runner> {
  if (p === 'gemini') return (await import('./gemini.ts')).runGemini;
  if (p === 'groq') return (await import('./groq.ts')).runGroq;
  return (await import('./claude.ts')).runClaude;
}

/** Кого пробуем по очереди: DEBTS_AI=gemini|groq|claude — только его; иначе все, для кого задан ключ */
function providers(): Provider[] {
  const forced = Deno.env.get('DEBTS_AI') as Provider | undefined;
  const all: Provider[] = forced && forced in KEYS ? [forced] : ['gemini', 'groq', 'claude'];
  return all.filter(p => KEYS[p]() && (broken.get(p) ?? 0) < Date.now());
}

export async function chat(opts: { chatId: number; me: { id: string; name: string }; text: string; attachments: Attachment[] }) {
  const list = providers();
  if (!list.length) throw new AiError('none');
  const [st, past] = await Promise.all([svc.state(), db.history(opts.chatId)]);
  const history: Turn[] = [...past];
  while (history.length && history[0].role !== 'user') history.shift();

  const userText = opts.text.trim() || (opts.attachments.length ? 'Разбери документ и внеси в учёт.' : '');
  const ctx: Ctx = { by: opts.me.name, files: opts.attachments.map(a => a.file), today: st.today, changed: false };
  const args: RunArgs = { history, context: contextText(st, opts.me), attachments: opts.attachments, userText, ctx };
  let reply = '';
  for (let i = 0; i < list.length; i++) {
    try {
      reply = await (await load(list[i]))(args);
      break;
    } catch (e) {
      // Переходим к следующему ИИ, только если этот ещё ничего не успел изменить — иначе можно задвоить запись
      const last = i === list.length - 1;
      if (!(e instanceof AiError) || e.kind === 'bad' || ctx.changed || last) throw e;
      if (e.kind === 'auth' || e.kind === 'region') broken.set(list[i], Date.now() + 3600e3);
      console.error('ai fallback', list[i], e.kind, e.message.slice(0, 300));
    }
  }
  if (!reply) reply = ctx.changed ? 'Готово, данные обновил.' : 'Не получилось ответить. Попробуйте переформулировать.';

  const names = opts.attachments.map(a => a.file.name).join(', ');
  await db.remember(opts.chatId, 'user', names ? `${userText}\n[прислал(а) файлы: ${names}]` : userText);
  await db.remember(opts.chatId, 'assistant', reply);
  return { reply, changed: ctx.changed };
}
