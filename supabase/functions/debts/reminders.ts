// Ежедневные напоминания о платежах (вызывается по расписанию pg_cron)
import { reminderKeyboard, reminderText } from './bot.ts';
import { isAllowed, TZ } from './config.ts';
import * as db from './db.ts';
import { daysBetween, isOpen, nextDue, today } from './logic.ts';
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

  for (const d of debts.filter(isOpen)) {
    const due = nextDue(d, t);
    if (!due) continue;
    const stage = stageFor(daysBetween(t, due));
    if (!stage || !(await db.claimReminder(d.id, due, stage))) continue;
    const owner = members.find(m => m.id === d.owner)?.name;
    for (const c of chats) {
      try {
        await sendText(c.chatId!, reminderText(d, due, t, owner), reminderKeyboard(d, due));
      } catch (e) {
        console.error('reminder', c.id, e); // например, человек заблокировал бота
      }
    }
    sent.push(`${d.name}: ${due} (${stage})`);
  }
  return { today: t, chats: chats.length, sent };
}
