// Обработка сообщений бота: команды, файлы, кнопки «Оплачено», разговор с Claude
import { AiError, type Attachment, chat } from './assistant.ts';
import { APP_URL, isAllowed, TZ } from './config.ts';
import * as db from './db.ts';
import { byMonth, dayMonth, esc, kindName, money, pct, toTelegramHtml, whenText } from './format.ts';
import { amountOn, type Debt, dueAmount, dueKnown, freeBy, isOpen, lumpSum, nextDue, today, totals } from './logic.ts';
import * as svc from './service.ts';
import { downloadFile, type Keyboard, keepTyping, sendText, tg, toBase64, type TgUser, userName } from './telegram.ts';

/* ---------- типы Telegram (только то, что используем) ---------- */
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  media_group_id?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
}
interface TgCallback { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

export const appButton = (text = '📊 Открыть приложение'): Keyboard | undefined =>
  APP_URL ? { inline_keyboard: [[{ text, web_app: { url: APP_URL } }]] } : undefined;

export async function handleUpdate(u: TgUpdate) {
  await db.loadAllowed();
  if (u.callback_query) return onCallback(u.callback_query);
  const m = u.message;
  if (!m?.from) return;
  if (m.chat.type !== 'private') {
    if ((m.text || '').startsWith('/')) await sendText(m.chat.id, 'Я работаю в личных сообщениях — напишите мне напрямую.');
    return;
  }
  if (!isAllowed(m.from.id)) {
    await sendText(m.chat.id, `Это личный бот для учёта долгов.\n\nВаш Telegram ID: <code>${m.from.id}</code> — чтобы получить доступ, его нужно добавить в список доступа.`);
    return;
  }
  await db.touchMember(m.from.id, userName(m.from), m.chat.id);

  const text = (m.text ?? m.caption ?? '').trim();
  if (m.text?.startsWith('/')) return onCommand(m, text);

  const file = fileOf(m);
  if (file && m.media_group_id) return onAlbum(m, file);
  if (file) return onFiles(m, [file], text);
  if (m.text) return talk(m, text, []);
  await sendText(m.chat.id, 'Я понимаю текст, PDF и фото. Пришлите договор, скриншот или просто напишите.');
}

/* ---------- команды ---------- */
async function onCommand(m: TgMessage, text: string) {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const chatId = m.chat.id;
  if (cmd === '/start' || cmd === '/help') {
    await sendText(chatId, [
      `Привет, ${esc(userName(m.from))}! Я помогу держать долги под контролем.`,
      '',
      '• Пришлите <b>договор, график платежей или скриншот</b> из банка (PDF или фото) — я сам внесу кредит, ставку, минимальный платёж и дату.',
      '• Пишите обычным языком: «заплатил 5000 по Тинькофф», «по карте Сбера сейчас 48 300».',
      '• Спрашивайте совета: «что гасить первым?», «когда закроем все долги?»',
      '• Напомню о платеже за 3 дня, накануне и в день оплаты.',
      '',
      'Команды: /summary — сводка, /next — ближайшие платежи, /reset — начать разговор заново.',
    ].join('\n'), appButton('📊 Открыть график долгов'));
    return;
  }
  if (cmd === '/summary' || cmd === '/debts') return void await sendText(chatId, await summaryText(), appButton());
  if (cmd === '/next') return void await sendText(chatId, await upcomingText(), appButton());
  if (cmd === '/reset') {
    await db.forget(chatId);
    return void await sendText(chatId, 'Начали разговор заново. Данные о долгах на месте.');
  }
  if (cmd === '/id') return void await sendText(chatId, `Ваш Telegram ID: <code>${m.from!.id}</code>`);
  await talk(m, text, []);
}

export async function summaryText() {
  const { debts, members, today: t } = await svc.state();
  if (!debts.length) return 'Долгов пока нет. Пришлите договор или напишите, например: «Кредитка Тинькофф, долг 48 000, минимальный платёж 3 000 до 15 числа».';
  const sum = totals(debts);
  const free = freeBy(debts, t);
  const lines = [
    '<b>Наши долги</b>',
    `Осталось <b>${money(sum.balance)}</b> — ${pct(sum.pct)} от ${money(sum.start)}`,
    `Уже погашено ${money(sum.paid)} · обязательно в месяц ${money(sum.monthly)}`,
  ];
  if (free.month && !free.never && !free.unknown) lines.push(`При минимальных платежах — без долгов ${byMonth(free.month)}`);
  lines.push('');
  for (const d of debts.filter(isOpen).sort((a, b) => b.balance - a.balance)) {
    const due = nextDue(d, t);
    const owner = members.find(x => x.id === d.owner)?.name;
    lines.push(`• <b>${esc(d.name)}</b>${owner ? ` (${esc(owner)})` : ''} — ${money(d.balance)}, ${pct(d.balance / Math.max(d.start, 1))}` +
      (due ? `\n   платёж ${dayMonth(due)} · ${dueText(d, due)}` : ''));
  }
  const closed = debts.filter(d => !isOpen(d)).length;
  if (closed) lines.push(`\nЗакрыто: ${closed} ✅`);
  return lines.join('\n');
}

async function upcomingText() {
  const { debts, today: t } = await svc.state();
  const list = debts.map(d => ({ d, due: nextDue(d, t) })).filter((x): x is { d: Debt; due: string } => !!x.due)
    .sort((a, b) => a.due.localeCompare(b.due));
  if (!list.length) return 'Ближайших платежей нет. Укажите день платежа у долгов — и я начну напоминать.';
  return ['<b>Ближайшие платежи</b>', ...list.slice(0, 15).map(({ d, due }) =>
    `• ${dayMonth(due)} (${whenText(t, due)}) — <b>${dueText(d, due)}</b>, ${esc(d.name)}`)].join('\n');
}

/* ---------- файлы ---------- */
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain', 'text/csv'];

function fileOf(m: TgMessage): db.MediaFile | null {
  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    return { fileId: p.file_id, name: 'Фото', mime: 'image/jpeg', type: 'photo', size: p.file_size };
  }
  if (m.document) {
    const d = m.document;
    return { fileId: d.file_id, name: d.file_name || 'Документ', mime: d.mime_type || 'application/octet-stream', type: 'document', size: d.file_size };
  }
  return null;
}

// Альбом приходит отдельными сообщениями: ждём остальные и обрабатываем пачкой в первом
async function onAlbum(m: TgMessage, file: db.MediaFile) {
  const group = m.media_group_id!;
  await db.addMedia(group, m.message_id, file, m.caption || '');
  await new Promise(r => setTimeout(r, 3000));
  const items = await db.mediaGroup(group);
  if (!items.length || items[0].messageId !== m.message_id) return;
  await db.dropMediaGroup(group);
  await onFiles(m, items.map(i => i.file), items.map(i => i.caption).filter(Boolean).join('\n'));
}

async function onFiles(m: TgMessage, files: db.MediaFile[], caption: string) {
  const bad = files.find(f => !OK_TYPES.includes(f.mime));
  if (bad) {
    return void await sendText(m.chat.id, `Не умею читать «${esc(bad.name)}». Пришлите договор в PDF или сфотографируйте страницы.`);
  }
  if (files.some(f => (f.size || 0) > 20e6)) return void await sendText(m.chat.id, 'Файл больше 20 МБ — Telegram не даёт боту его скачать. Пришлите поменьше или фото страниц.');

  const stop = keepTyping(m.chat.id);
  try {
    const attachments: Attachment[] = [];
    for (const f of files) {
      const { bytes } = await downloadFile(f.fileId);
      const ref = { id: f.fileId, name: f.name, type: f.type };
      if (f.mime.startsWith('text/')) {
        attachments.push({ file: ref, mime: f.mime, text: new TextDecoder().decode(bytes).slice(0, 200_000) });
      } else {
        if (f.mime.startsWith('image/') && bytes.length > 5e6) throw new svc.UserError('Картинка больше 5 МБ — пришлите её как фото, а не файлом.');
        attachments.push({ file: ref, mime: f.mime, base64: toBase64(bytes) });
      }
    }
    await talk(m, caption, attachments, stop);
  } catch (e) {
    stop();
    await sendText(m.chat.id, errorText(e));
  }
}

/* ---------- разговор ---------- */
async function talk(m: TgMessage, text: string, attachments: Attachment[], stopTyping?: () => void) {
  const stop = stopTyping ?? keepTyping(m.chat.id);
  try {
    const { reply, changed } = await chat({
      chatId: m.chat.id,
      me: { id: String(m.from!.id), name: userName(m.from) },
      text,
      attachments,
    });
    stop();
    await sendText(m.chat.id, toTelegramHtml(reply), changed ? appButton() : undefined);
  } catch (e) {
    stop();
    console.error('chat', e);
    await sendText(m.chat.id, errorText(e));
  }
}

function errorText(e: unknown) {
  if (e instanceof svc.UserError) return esc(e.message);
  if (e instanceof AiError) {
    console.error('ai', e.kind, e.message);
    return {
      none: 'ИИ пока не подключён, поэтому договоры и вопросы я не разбираю. Работают /summary, /next, напоминания и приложение.',
      auth: 'Ключ ИИ не подошёл. Проверьте секреты GEMINI_API_KEY и GROQ_API_KEY в Supabase.',
      rate: 'Бесплатный лимит ИИ на сейчас закончился. Попробуйте через минуту, а если не поможет — завтра.',
      region: 'Google не обслуживает регион, из которого пришёл запрос. Напишите разработчику — нужно сменить регион функции.',
      bad: 'ИИ не смог обработать этот запрос — возможно, файл слишком большой. Пришлите другой файл или напишите текстом.',
      down: 'ИИ сейчас недоступен. Попробуйте чуть позже.',
    }[e.kind];
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

/* ---------- кнопки под напоминаниями ---------- */
async function onCallback(q: TgCallback) {
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
  if (!isAllowed(q.from.id)) return answer('Нет доступа');
  const [kind, debtId, due] = (q.data || '').split(':');
  const d = debtId ? await db.debt(debtId) : null;
  if (!d) return answer('Долг не найден — возможно, его удалили');

  // Сумму платежа по карте знает только банк — не списываем весь долг одной кнопкой, спрашиваем сумму
  if (kind === 'other' || (kind === 'pay' && !dueKnown(d))) {
    await answer('Напишите сумму в чат');
    return void await sendText(q.from.id, `Сколько внесли по «${esc(d.name)}»? Напишите, например: «оплатил 7000 по ${esc(d.name)}».`);
  }
  if (kind !== 'pay') return answer('');

  const t = today(TZ);
  const current = nextDue(d, t);
  if (!current || current > due) {
    await answer('Этот платёж уже отмечен');
  } else {
    // Заём одной суммой платят по сегодняшнему остатку, а не по прогнозу к сроку
    const sum = lumpSum(d) ? amountOn(d, t) : dueAmount(d);
    const by = userName(q.from);
    // Номер записи привязан к сроку: второе быстрое нажатие база не примет и платёж не задвоится
    const eventId = `rem${d.id}${String(due).replaceAll('-', '')}`;
    let r: Awaited<ReturnType<typeof svc.pay>>;
    try {
      r = await svc.pay(d.id, sum, t, by, 'Отмечено из напоминания', eventId);
    } catch (e) {
      console.error('callback pay', e);
      return answer(/duplicate key/i.test(String(e)) ? 'Этот платёж уже отмечен' : 'Не получилось записать, попробуйте ещё раз');
    }
    await answer('Записал платёж ✅');
    const next = nextDue(r.debt, t);
    const html = [
      `✅ <b>${esc(d.name)}</b>: оплачено ${money(sum)}${by ? ` · ${esc(by)}` : ''}`,
      `Остаток: ${money(r.debt.balance)}`,
      next ? `Следующий платёж: ${dayMonth(next)}` : r.debt.closed ? 'Долг закрыт 🎉' : '',
    ].filter(Boolean).join('\n');
    if (q.message) {
      await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: html, parse_mode: 'HTML' }).catch(() => {});
    }
  }
}

/* ---------- текст напоминания ---------- */
export function reminderText(d: Debt, due: string, t: string, owner?: string) {
  const when = whenText(t, due);
  const head = due < t ? `⚠️ Платёж ${when}` : due === t ? '‼️ Платёж сегодня' : `⏰ Платёж ${when} — ${dayMonth(due)}`;
  return [
    head,
    `<b>${esc(d.name)}</b>${owner ? ` · ${esc(owner)}` : ''} · ${kindName(d).toLowerCase()}`,
    lumpSum(d)
      ? `К оплате к ${dayMonth(due)}: <b>≈ ${money(dueAmount(d, due))}</b> — сегодня к возврату ${money(amountOn(d, t))}`
      : dueKnown(d)
      ? `К оплате: <b>${money(dueAmount(d))}</b>${d.minPayment ? '' : ' (минимальный платёж не указан — показан весь остаток)'}`
      : 'К оплате: сумма не указана — посмотрите в приложении банка',
    `Остаток долга: ${money(d.balance)}`,
  ].join('\n');
}

/** Просьба прислать свежую выписку по карте */
export function statementText(d: Debt, known: boolean, t: string, due: string | null) {
  const head = known ? 'банк сформировал новую выписку' : `платёж ${due ? `${whenText(t, due)} — ${dayMonth(due)}` : 'уже скоро'}`;
  return [
    `📄 <b>${esc(d.name)}</b>: ${head}.`,
    'Пришлите скриншот из приложения банка — обновлю долг и минимальный платёж, чтобы напоминания были точными.',
  ].join('\n');
}

export function reminderKeyboard(d: Debt, due: string, t?: string): Keyboard {
  const row2: Record<string, unknown>[] = [{ text: 'Другая сумма', callback_data: `other:${d.id}` }];
  if (APP_URL) row2.push({ text: '📊 Открыть', web_app: { url: APP_URL } });
  const pay = dueKnown(d)
    ? { text: `✅ Оплачено ${money(lumpSum(d) && t ? amountOn(d, t) : dueAmount(d))}`, callback_data: `pay:${d.id}:${due}` }
    : { text: '✅ Внёс — указать сумму', callback_data: `other:${d.id}` };
  return { inline_keyboard: [[pay], row2] };
}

const dueText = (d: Debt, due?: string) => (dueKnown(d) ? `${due && lumpSum(d) ? '≈ ' : ''}${money(dueAmount(d, due))}` : 'сумма не указана');
