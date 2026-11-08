// Общая часть помощника: подсказка для модели, инструменты, контекст и разговор.
// Сама модель подключается отдельно: Gemini (gemini.ts), Groq (groq.ts) — оба бесплатные — или Claude (claude.ts).
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY } from './config.ts';
import * as db from './db.ts';
import { dayMonth, moneyExact } from './format.ts';
import {
  accrues, amountOn, daysBetween, type Debt, type DebtEvent, type DebtFile, dueAmount, dueKnown, isDate, isOpen, KINDS, monthlyMin, nearPayments, nextDue,
  payoffMonths, pctLeft, perDay, round2, simulatePayoff,
} from './logic.ts';
import * as svc from './service.ts';

export const SYSTEM = `Ты — помощник семейной пары по долгам в Telegram-боте. У них кредитные карты, кредиты и займы. Твоя задача — держать учёт в порядке, помогать не пропускать платежи и вместе выбираться из долгов.

В начале каждого сообщения пользователя есть блок «Контекст»: сегодняшняя дата, кто пишет, участники и текущие долги в JSON. Это актуальные данные из базы — опирайся на них и ссылайся на долги по id. Всё, что ты меняешь инструментами, сразу видно в мини-приложении с графиком.

Документы. Когда присылают договор, график платежей, выписку, скриншот из банковского приложения или фото, найди: кредитора, тип долга, сумму по договору, текущий остаток, лимит (для карт), процентную ставку (% годовых; если указана дневная — переведи в годовые ×365 и скажи об этом), обязательный или минимальный платёж, дату или число платежа, дату окончания. ПСК — не ставка: её можно упомянуть в заметках. Если такой долг уже есть в списке (тот же банк и продукт) — обнови его, иначе добавь новый. Не придумывай значения, которых нет в документе: оставь поле пустым и коротко перечисли, чего не хватает. Если документ не про долг или его не прочитать — так и скажи.

Займы МФО: balance — сколько нужно вернуть на сегодня (с процентами), principal — основной долг без процентов, rate — ставка (0,8 % в день = 292). Если есть ставка и основной долг, проценты бот начисляет сам каждый день. Карты: если виден день формирования выписки, запиши его в statement_day. Бот сам просит свежий скриншот после выписки — такой скриншот разбирай как обновление этой карты: новый остаток и минимальный платёж.

Сообщения про деньги: «заплатил 5000 по Тинькофф» — платёж; «по карте сейчас 48 300» — новый остаток; «потратила 3000 с кредитки» — долг вырос. Если непонятно, о каком долге речь или какая сумма, — переспроси, а не угадывай. Удалять долги ты не можешь — для этого есть приложение.

Точность важнее скорости:
• Числа бери только из контекста и ответов инструментов, в уме не считай. Строка «К оплате» в контексте уже посчитана.
• next_due — следующий срок, covered_until — до какой даты обязательный платёж уже закрыт. Не говори, что месяц оплачен, если этого не видно из этих полей.
• Один реальный платёж — одна запись. Перед записью посмотри «Последние записи».
• Скриншот или выписка — это сверка. Всё совпадает — так и скажи и ничего не записывай. Остаток другой — один раз вызови set_balance и назови разницу; если записанные платежи и траты её не объясняют, скажи об этом прямо. Платёж со скрина записывай, только если его нет в истории.
• Ошибку в истории исправляй в самой записи: edit_payment или delete_event. Нельзя прятать её правкой остатка или пустой записью-комментарием и нельзя говорить, что исправить невозможно. Если после исправления остаток расходится с банком, затем вызови set_balance.
• Ответ not_recorded или not_changed значит, что ничего не записано и бот сам задаст человеку вопрос. Когда человек ответит «да», повтори вызов с confirmed_new=true или confirmed=true.
• Что изменилось, бот допишет отдельной строкой сам: новый остаток и дату следующего платежа не повторяй.

Советы — только когда человек сам спрашивает: что гасить, как быстрее закрыть, хватит ли денег, стоит ли рефинансировать. К подтверждению записи советы не добавляй. На вопрос про план сначала вызови plan_payoff с суммой в месяц (не назвали — спроси) и опирайся на его расчёт, а не на свои прикидки. Разбирай ситуацию на их цифрах: что гасить в первую очередь (обычно самое дорогое по ставке — «лавина»; или самый маленький долг ради мотивации — «снежный ком»), как не терять льготный период по картам, когда имеет смысл рефинансирование, куда направить свободные деньги. Обязательные платежи пропускать нельзя: просрочка — это штрафы и испорченная кредитная история. Займы МФО обычно самые дорогие. Не предлагай брать новые займы, чтобы закрыть старые. Если человеку тяжело, поддержи и подскажи законные варианты: реструктуризация, кредитные каникулы, разговор с банком. Ты не финансовый консультант, но говори прямо и по делу, без нравоучений.

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
  principal: { type: 'number', description: 'Только для займов МФО: основной долг без процентов, ₽ — на него начисляются проценты' },
  statement_day: { type: 'integer', minimum: 1, maximum: 31, description: 'Только для карт: число месяца, когда банк формирует выписку' },
} as const;

export interface ToolDef { name: string; description: string; properties: Record<string, unknown>; required: string[] }
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef =>
  ({ name, description, properties, required });

const idField = { debt_id: { type: 'string', description: 'id долга из контекста' } };
const dateField = { date: { type: 'string', description: 'Дата YYYY-MM-DD, по умолчанию сегодня' } };
const noteField = { note: { type: 'string', description: 'Комментарий, необязательно' } };
const eventField = { event_id: { type: 'string', description: 'id записи из «Последних записей» или payment_history' } };
const confirmedField = { confirmed: { type: 'boolean', description: 'true только после того, как человек ответил «да» на вопрос бота' } };

export const TOOLS: ToolDef[] = [
  tool('add_debt', 'Добавить новый долг: карту, кредит, займ или рассрочку.', debtFields, ['name', 'kind', 'balance']),
  tool('update_debt', 'Изменить данные существующего долга. Передавай только то, что меняется. closed=true — долг закрыт.', {
    ...idField,
    ...debtFields,
    closed: { type: 'boolean', description: 'Долг полностью закрыт' },
  }, ['debt_id']),
  tool('record_payment', 'Записать платёж по долгу: уменьшает остаток и отмечает обязательный платёж, если внесён минимум. Если за 3 дня до или после даты уже есть платёж по этому долгу, запись не произойдёт и бот спросит человека.', {
    ...idField,
    amount: { type: 'number', description: 'Сумма платежа, ₽' },
    ...dateField,
    ...noteField,
    confirmed_new: { type: 'boolean', description: 'true только после того, как человек ответил на вопрос бота, что это другой, новый платёж' },
  }, ['debt_id', 'amount']),
  tool('edit_payment', 'Исправить ошибочную запись о платеже: сумму, дату или комментарий. Остаток и срок платежа пересчитаются. Первый вызов только показывает человеку, что изменится.', {
    ...eventField,
    amount: { type: 'number', description: 'Верная сумма платежа, ₽' },
    ...dateField,
    ...noteField,
    ...confirmedField,
  }, ['event_id']),
  tool('delete_event', 'Удалить ошибочную запись из истории: лишний платёж, трату или изменение остатка. Остаток и срок платежа вернутся как было. Первый вызов только показывает человеку, что изменится.', {
    ...eventField,
    ...confirmedField,
  }, ['event_id']),
  tool('plan_payoff', 'Точный расчёт плана погашения при заданной сумме в месяц: «лавина» и «снежный ком», сколько месяцев, сколько уйдёт на проценты, в каком порядке закроются долги.', {
    monthly_budget: { type: 'number', description: 'Сколько всего в месяц идёт на все долги, ₽' },
    owner: { type: 'string', description: 'id участника, если считать только его долги; не указывай, чтобы считать все' },
  }, ['monthly_budget']),
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
  principal: 'number', statement_day: 'integer',
};
const SPECS: Record<string, { spec: Record<string, Check>; required: string[] }> = {
  add_debt: { spec: FIELD_TYPES, required: ['name', 'kind', 'balance'] },
  update_debt: { spec: { ...FIELD_TYPES, debt_id: 'string', closed: 'boolean' }, required: ['debt_id'] },
  record_payment: { spec: { debt_id: 'string', amount: 'number', date: 'string', note: 'string', confirmed_new: 'boolean' }, required: ['debt_id', 'amount'] },
  edit_payment: { spec: { event_id: 'string', amount: 'number', date: 'string', note: 'string', confirmed: 'boolean' }, required: ['event_id'] },
  delete_event: { spec: { event_id: 'string', confirmed: 'boolean' }, required: ['event_id'] },
  plan_payoff: { spec: { monthly_budget: 'number', owner: 'string' }, required: ['monthly_budget'] },
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
  principal: o.principal as number | undefined,
  statementDay: o.statement_day as number | undefined,
});

export interface Ctx {
  by: string;
  files: DebtFile[];
  today: string;
  changed: boolean;
  /** Что реально изменилось в базе: бот сам допишет это к ответу, цифры не зависят от модели */
  log: string[];
  /** О чём спросить человека, прежде чем менять записи */
  asks: { key: string; text: string }[];
  /** О чём бот спросил в прошлом сообщении: подтверждение принимается только на это */
  approved: Set<string>;
  /** Проверка поведения модели: инструменты не пишут в базу */
  dryRun: boolean;
  calls: { name: string; input: unknown; result: string }[];
}
type ToolResult = { content: string; isError?: boolean };

const WRITES = new Set(['add_debt', 'update_debt', 'record_payment', 'set_balance', 'add_charge', 'edit_payment', 'delete_event']);
const EVENT_NAMES: Record<DebtEvent['type'], string> = { payment: 'платёж', charge: 'рост долга', balance: 'новый остаток', interest: 'проценты' };
const eventLabel = (e: DebtEvent) => `${EVENT_NAMES[e.type]} ${moneyExact(e.amount)} от ${dayMonth(e.date)}`;

function afterChange(d: Debt, today: string) {
  const due = nextDue(d, today);
  return `остаток ${moneyExact(d.balance)}${due ? `, следующий платёж ${dayMonth(due)}` : ''}`;
}

function previewText(name: string, e: DebtEvent, o: Input, d: Debt | null) {
  const what = `**${d?.name ?? 'Долг'}**: ${eventLabel(e)}`;
  const without = d ? d.balance - e.delta : 0;
  const result = (n: number) => (d ? ` Остаток станет ${moneyExact(round2(Math.max(0, n)))}.` : '');
  if (name === 'delete_event') return `Удалить запись ${what}?${result(without)} Ответьте «да» или «нет».`;
  const sum = (o.amount as number | undefined) ?? e.amount;
  const day = isDate(o.date) && o.date !== e.date ? ` от ${dayMonth(o.date)}` : '';
  return `Исправить запись ${what} → ${moneyExact(sum)}${day}?${result(without - sum)} Ответьте «да» или «нет».`;
}

/** Правила, которые выполняются кодом: модель не может их обойти или забыть */
async function guard(name: string, o: Input, ctx: Ctx): Promise<ToolResult | null> {
  if (name === 'record_payment') {
    const id = String(o.debt_id);
    const key = `pay:${id}`;
    if (o.confirmed_new && ctx.approved.has(key)) return null;
    const d = await db.debt(id);
    if (!d) return null;
    const near = nearPayments(await db.events(100, id), id, isDate(o.date) ? o.date : ctx.today);
    if (!near.length) return null;
    ctx.asks.push({ key, text: `По **${d.name}** уже записан ${near.map(eventLabel).join(', ')}. Платёж ${moneyExact(o.amount as number)} — это другой, новый? Если тот же, напишите, какая сумма верная.` });
    return { content: JSON.stringify({ not_recorded: true, why: 'Рядом по дате уже есть платёж. Бот сам задаст человеку вопрос.', near: near.map(e => ({ id: e.id, amount: e.amount, date: e.date })) }) };
  }
  if (name === 'set_balance') {
    const d = await db.debt(String(o.debt_id));
    if (d && Math.abs(d.balance - (o.balance as number)) < 0.005) {
      return { content: JSON.stringify({ ok: true, unchanged: true, why: 'Остаток уже такой, запись не нужна', debt: brief(d, ctx.today) }) };
    }
    return null;
  }
  if (name === 'edit_payment' || name === 'delete_event') {
    const e = await db.event(String(o.event_id));
    if (!e) throw new svc.UserError('Запись не найдена');
    if (e.type === 'interest') throw new svc.UserError('Проценты бот начисляет сам: такую запись менять нельзя');
    if (name === 'edit_payment' && e.type !== 'payment') throw new svc.UserError('edit_payment исправляет только платежи. Другую запись удали через delete_event и внеси заново');
    const key = `edit:${e.id}`;
    if (o.confirmed && ctx.approved.has(key)) return null;
    ctx.asks.push({ key, text: previewText(name, e, o, await db.debt(e.debtId)) });
    return { content: JSON.stringify({ not_changed: true, why: 'Бот сам покажет человеку, что изменится, и спросит подтверждение.' }) };
  }
  return null;
}

function payoffReport(list: Debt[], budget: number, today: string) {
  const minimums = round2(list.reduce((s, d) => s + monthlyMin(d), 0));
  const lumpSums = list.filter(d => d.kind === 'microloan').map(d => {
    const due = nextDue(d, today);
    return { name: d.name, due, amount: due ? amountOn(d, due) : d.balance };
  });
  const names = (items: Debt[]) => items.map(d => d.name).join(', ');
  const noRate = list.filter(d => !d.rate);
  const noMin = list.filter(d => d.kind !== 'microloan' && !d.minPayment);
  const caveats = [
    ...(noRate.length ? [`Нет ставки у: ${names(noRate)}. Считаю без процентов, реальный срок будет дольше.`] : []),
    ...(noMin.length ? [`Нет минимального платежа у: ${names(noMin)}. Взял 5 % от остатка.`] : []),
    'Это оценка: льготные периоды, изменение ставок и новые траты изменят сроки.',
  ];
  if (budget < minimums) return { enough: false, monthly_budget: budget, minimums, shortfall: round2(minimums - budget), lump_sums: lumpSums, caveats };
  const avalanche = simulatePayoff(list, budget, 'avalanche', today);
  const snowball = simulatePayoff(list, budget, 'snowball', today);
  const regular = list.filter(d => d.kind !== 'microloan');
  return {
    enough: true,
    monthly_budget: budget,
    minimums,
    lump_sums: lumpSums,
    avalanche,
    snowball,
    avalanche_saves: round2(snowball.interest - avalanche.interest),
    only_minimums_without_microloans: minimums > 0 ? simulatePayoff(regular, minimums, 'avalanche', today) : undefined,
    caveats,
  };
}

export async function runTool(name: string, raw: unknown, ctx: Ctx): Promise<ToolResult> {
  const result = await execute(name, raw, ctx);
  ctx.calls.push({ name, input: raw, result: result.content.slice(0, 1500) });
  return result;
}

async function execute(name: string, raw: unknown, ctx: Ctx): Promise<ToolResult> {
  const def = SPECS[name];
  if (!def) return { content: `Нет инструмента ${name}`, isError: true };
  const problem = validate(raw, def.spec, def.required);
  if (problem) return { content: JSON.stringify({ INVALID_INPUT: problem, input: raw }), isError: true };
  const o = raw as Input;
  try {
    const stop = await guard(name, o, ctx);
    if (stop) return stop;
    if (ctx.dryRun && WRITES.has(name)) return { content: JSON.stringify({ ok: true, dry_run: true }) };
    switch (name) {
      case 'add_debt': {
        let d = await svc.createDebt(toInput(o), ctx.files[0]);
        for (const f of ctx.files.slice(1)) d = await svc.updateDebt(d.id, {}, ctx.by, f);
        ctx.changed = true;
        ctx.log.push(`✓ **${d.name}** добавлен: ${afterChange(d, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, debt: brief(d, ctx.today) }) };
      }
      case 'update_debt': {
        const id = String(o.debt_id);
        let d = await svc.updateDebt(id, toInput(o), ctx.by, ctx.files[0]);
        for (const f of ctx.files.slice(1)) d = await svc.updateDebt(id, {}, ctx.by, f);
        ctx.changed = true;
        ctx.log.push(`✓ **${d.name}** обновлён: ${afterChange(d, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, debt: brief(d, ctx.today) }) };
      }
      case 'record_payment': {
        const r = await svc.pay(String(o.debt_id), o.amount, o.date, ctx.by, (o.note as string) || '');
        ctx.changed = true;
        ctx.log.push(`✓ **${r.debt.name}**: платёж ${moneyExact(r.event.amount)}, ${afterChange(r.debt, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, debt: brief(r.debt, ctx.today) }) };
      }
      case 'edit_payment': {
        const r = await svc.editPayment(String(o.event_id), o.amount, o.date, o.note as string | undefined);
        ctx.changed = true;
        ctx.log.push(`✓ **${r.debt.name}**: платёж исправлен на ${moneyExact(r.event.amount)}, ${afterChange(r.debt, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, debt: brief(r.debt, ctx.today) }) };
      }
      case 'delete_event': {
        const d = await svc.removeEvent(String(o.event_id));
        ctx.changed = true;
        if (d) ctx.log.push(`✓ **${d.name}**: запись удалена, ${afterChange(d, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, debt: d ? brief(d, ctx.today) : undefined }) };
      }
      case 'set_balance':
      case 'add_charge': {
        const value = name === 'set_balance' ? o.balance : o.amount;
        const r = await svc.setBalance(String(o.debt_id), value, o.date, ctx.by, (o.note as string) || '', name === 'add_charge' ? 'charge' : 'balance');
        ctx.changed = true;
        ctx.log.push(name === 'set_balance'
          ? `✓ **${r.debt.name}**: остаток ${moneyExact(round2(r.debt.balance - r.event.delta))} → ${moneyExact(r.debt.balance)}`
          : `✓ **${r.debt.name}**: долг вырос на ${moneyExact(value as number)}, ${afterChange(r.debt, ctx.today)}`);
        return { content: JSON.stringify({ ok: true, change: r.event.delta, debt: brief(r.debt, ctx.today) }) };
      }
      case 'payment_history': {
        const list = await db.events(Number(o.limit) || 30, o.debt_id ? String(o.debt_id) : undefined);
        return { content: JSON.stringify(list.map(e => ({ id: e.id, debt_id: e.debtId, type: e.type, amount: e.amount, change: e.delta, date: e.date, by: e.by, note: e.note }))) };
      }
      case 'plan_payoff': {
        const list = (await db.debts()).filter(d => isOpen(d) && (!o.owner || d.owner === o.owner));
        return { content: JSON.stringify(payoffReport(list, o.monthly_budget as number, ctx.today)) };
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
    due_amount: due && dueKnown(d) ? dueAmount(d, due) : undefined,
    covered_until: d.paidDue ?? undefined,
    interest_per_month_estimate: d.rate && !accrues(d) ? Math.round(d.balance * d.rate / 1200) : undefined,
    payoff_months_at_min: months === Infinity ? 'не гасится: платёж меньше процентов' : months ?? undefined,
    end_date: d.endDate ?? undefined,
    principal: d.principal ?? undefined,
    statement_day: d.statementDay ?? undefined,
    to_repay_today: accrues(d) ? amountOn(d, today) : undefined,
    interest_per_day: accrues(d) ? perDay(d) : undefined,
    to_repay_on_due: accrues(d) && due ? amountOn(d, due) : undefined,
    notes: d.notes ? d.notes.slice(0, 300) : undefined,
    files: d.files.length || undefined,
    closed: d.closed || undefined,
  };
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** Сколько платить: посчитано кодом, чтобы модель не складывала суммы сама */
function dueSummary(debts: Debt[], today: string) {
  const items = debts.filter(isOpen).flatMap(d => {
    const due = nextDue(d, today);
    return due ? [{ d, days: daysBetween(today, due), sum: dueKnown(d) ? dueAmount(d, due) : null }] : [];
  });
  const within = (n: number) => moneyExact(round2(items.filter(x => x.days <= n).reduce((s, x) => s + (x.sum ?? 0), 0)));
  const late = items.filter(x => x.days < 0).map(x => x.d.name);
  const noSum = items.filter(x => x.sum === null).map(x => x.d.name);
  return `К оплате: в ближайшие 7 дней ${within(7)}, в ближайшие 30 дней ${within(30)}.`
    + (late.length ? ` Просрочено: ${late.join(', ')}.` : '')
    + (noSum.length ? ` Сумма платежа неизвестна и не учтена: ${noSum.join(', ')}.` : '');
}

export function contextText(st: Awaited<ReturnType<typeof svc.state>>, me: { id: string; name: string }) {
  const weekday = WEEKDAYS[new Date(st.today + 'T12:00:00Z').getUTCDay()];
  const people = st.members.map(m => `${m.name || 'без имени'} (id ${m.id})`).join(', ') || 'пока никого';
  const names = new Map(st.debts.map(d => [d.id, d.name]));
  const recent = st.events.slice(0, 12).map(e => ({ id: e.id, debt: names.get(e.debtId) ?? e.debtId, type: e.type, amount: e.amount, change: e.delta, date: e.date, by: e.by || undefined, note: e.note || undefined }));
  return [
    'Контекст',
    `Сегодня: ${st.today}, ${weekday}.`,
    `Пишет: ${me.name || 'без имени'} (id ${me.id}).`,
    `Участники: ${people}. Владелец "common" — общий долг.`,
    `Долги (${st.debts.length}): ${JSON.stringify(st.debts.map(d => brief(d, st.today)))}`,
    dueSummary(st.debts, st.today),
    `Последние записи, новые сверху: ${JSON.stringify(recent)}`,
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

// Метка в сохранённой переписке: о чём бот спросил. Человек её не видит, подделать её своим сообщением нельзя
const ASKED = /⟦ask:([^⟧]+)⟧/g;

/** Итог для человека: вопросы и строки «что изменилось» формирует код, а не модель */
function finalReply(said: string, ctx: Ctx) {
  const log = ctx.log.join('\n');
  // Модель могла написать «записал», хотя запись остановлена, поэтому при вопросе её текст не показываем
  const asks = [...new Map(ctx.asks.map(a => [a.key, a.text])).values()];
  if (asks.length) return [log, ...asks].filter(Boolean).join('\n\n');
  return [said.replace(ASKED, '').trim(), log].filter(Boolean).join('\n\n') || 'Не получилось ответить. Попробуйте переформулировать.';
}

export async function chat(opts: { chatId: number; me: { id: string; name: string }; text: string; attachments: Attachment[]; dry?: boolean }) {
  const list = providers();
  if (!list.length) throw new AiError('none');
  const [st, past] = await Promise.all([svc.state(), db.history(opts.chatId)]);
  const stored: Turn[] = [...past];
  while (stored.length && stored[0].role !== 'user') stored.shift();
  const lastBot = [...stored].reverse().find(t => t.role === 'assistant')?.text ?? '';
  const history = stored.map(t => ({ ...t, text: t.text.replace(ASKED, '').trimEnd() }));

  const userText = opts.text.trim() || (opts.attachments.length ? 'Разбери документ и внеси в учёт.' : '');
  const ctx: Ctx = {
    by: opts.me.name, files: opts.attachments.map(a => a.file), today: st.today, changed: false,
    log: [], asks: [], approved: new Set([...lastBot.matchAll(ASKED)].map(m => m[1])), dryRun: !!opts.dry, calls: [],
  };
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
  const final = finalReply(reply, ctx);
  if (!opts.dry) {
    const names = opts.attachments.map(a => a.file.name).join(', ');
    await db.remember(opts.chatId, 'user', names ? `${userText}\n[прислал(а) файлы: ${names}]` : userText);
    await db.remember(opts.chatId, 'assistant', final + ctx.asks.map(a => `⟦ask:${a.key}⟧`).join(''));
  }
  return { reply: final, changed: ctx.changed, calls: ctx.calls };
}

/** Настоящая модель на настоящих данных, но без записи в базу и переписку: проверка поведения через /ai-check?trial=текст */
export async function trialChat(text: string) {
  const [first] = await db.members();
  return chat({ chatId: 0, me: { id: first?.id ?? '0', name: first?.name ?? '' }, text, attachments: [], dry: true });
}
