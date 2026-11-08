// Ежедневный запуск по расписанию pg_cron: проценты по займам, напоминания о платежах, просьбы прислать выписку
import { reminderKeyboard, reminderText, statementText } from './bot.ts';
import { isAllowed, TZ } from './config.ts';
import * as db from './db.ts';
import { accrue, daysBetween, type Debt, isOpen, nextDue, statementAsk, today } from './logic.ts';
import { sendText } from './telegram.ts';

/** За 3 дня (или 2, если cron пропустил день), накануне, в день платежа и после просрочки */
function stageFor(days: number) {
  if (days > 3) return null;
  if (days >= 2) return 'd3';
  if (days === 1) return 'd1';
  if (days === 0) return 'd0';
  if (days > -7) return 'late';
  return 'late7';
}

export async function runReminders() {
  const t = today(TZ);
  const [debts, members] = await Promise.all([db.debts(), db.members(), db.loadAllowed()]);
  const chats = members.filter(m => m.chatId && isAllowed(m.id));
  const sent: string[] = [];

  // Сначала проценты: напоминания и приложение должны видеть сумму на сегодня
  for (const d of debts) {
    const added = accrue(d, t);
    if (!added) continue;
    await db.addInterest(d, added, t);
    await db.saveDebt(d);
  }

  for (const d of debts.filter(isOpen)) {
    const due = nextDue(d, t);
    if (!due) continue;
    const stage = stageFor(daysBetween(t, due));
    if (!stage || !(await db.claimReminder(d.id, due, stage))) continue;
    const owner = members.find(m => m.id === d.owner)?.name;
    for (const c of chats) {
      try {
        await sendText(c.chatId!, reminderText(d, due, t, owner), reminderKeyboard(d, due, t));
      } catch (e) {
        console.error('reminder', c.id, e); // например, человек заблокировал бота
      }
    }
    sent.push(`${d.name}: ${due} (${stage})`);
  }
  const asked = await askStatements(debts, chats, t);
  return { today: t, chats: chats.length, sent, asked };
}

/** Выписку видит только владелец карты в приложении своего банка — его и просим; общую карту — всех */
async function askStatements(debts: Debt[], chats: db.Member[], t: string) {
  const asked: string[] = [];
  const events = await db.events(300);
  for (const d of debts) {
    const ask = statementAsk(d, t);
    if (!ask) continue;
    if (events.some(e => e.debtId === d.id && e.type === 'balance' && e.date >= ask.freshSince)) continue; // только что обновляли
    if (!(await db.claimReminder(d.id, ask.date, 'statement'))) continue;
    const owner = chats.filter(c => c.id === d.owner);
    const text = statementText(d, ask.known, t, nextDue(d, t));
    for (const c of owner.length ? owner : chats) {
      try {
        await sendText(c.chatId!, text);
        // В историю разговора: ответный скриншот бот поймёт как обновление этой карты
        await db.remember(c.chatId!, 'assistant', text.replace(/<[^>]+>/g, ''));
      } catch (e) {
        console.error('statement', c.id, e);
      }
    }
    asked.push(`${d.name}: ${ask.date}`);
  }
  return asked;
}
