// API для мини-приложения. Каждый запрос подписан Telegram (initData) — проверяем подпись и доступ.
import { isAllowed } from './config.ts';
import * as db from './db.ts';
import * as svc from './service.ts';
import { tg, userName, verifyInitData } from './telegram.ts';

let botName = '';
async function botUsername() {
  if (!botName) botName = await tg<{ username: string }>('getMe').then(r => r.username).catch(() => '');
  return botName;
}

type Body = Record<string, unknown> & { initData?: string; action?: string };

export async function handleApi(body: Body): Promise<{ status: number; data: unknown }> {
  const user = await verifyInitData(String(body.initData || ''));
  if (!user) return { status: 401, data: { error: 'Не удалось проверить вход через Telegram' } };
  await db.loadAllowed();
  if (!isAllowed(user.id)) return { status: 403, data: { error: 'Нет доступа', id: user.id } };
  const by = userName(user);
  // Запоминаем участника параллельно с операцией: на ответ это время не тратим
  const touching = db.touchMember(user.id, by).catch(e => console.error('touch', e));
  const eventId = typeof body.eventId === 'string' ? body.eventId : undefined;

  try {
    switch (body.action) {
      case 'state':
        break;
      case 'save_debt': {
        const input = (body.debt || {}) as svc.DebtInput & { id?: string };
        if (input.id && !body.create) await svc.updateDebt(input.id, input, by, undefined, eventId);
        else await svc.createDebt(input, undefined, input.id);
        break;
      }
      case 'delete_debt':
        await svc.removeDebt(String(body.id));
        break;
      case 'pay':
        await svc.pay(String(body.debtId), body.amount, body.date, by, String(body.note || ''), eventId);
        break;
      case 'balance':
        await svc.setBalance(String(body.debtId), body.amount, body.date, by, String(body.note || ''), 'balance', eventId);
        break;
      case 'charge':
        await svc.setBalance(String(body.debtId), body.amount, body.date, by, String(body.note || ''), 'charge', eventId);
        break;
      case 'delete_event':
        await svc.removeEvent(String(body.id));
        break;
      case 'send_file': {
        const d = await db.debt(String(body.debtId));
        const f = d?.files.find(x => x.id === body.fileId);
        if (!d || !f) throw new svc.UserError('Файл не найден');
        try {
          await tg(f.type === 'photo' ? 'sendPhoto' : 'sendDocument', {
            chat_id: user.id,
            [f.type === 'photo' ? 'photo' : 'document']: f.id,
            caption: `${d.name} — ${f.name}`,
          });
        } catch {
          throw new svc.UserError('Не получилось отправить: сначала откройте чат с ботом и нажмите «Старт»');
        }
        return { status: 200, data: { ok: true } };
      }
      default:
        return { status: 400, data: { error: 'Неизвестное действие' } };
    }
  } catch (e) {
    if (e instanceof svc.UserError) return { status: 400, data: { error: e.message } };
    throw e;
  }

  const people = touching.then(() => db.members());
  const [st, all, bot] = await Promise.all([svc.state(people), people, botUsername()]);
  const me = all.find(m => m.id === String(user.id));
  return { status: 200, data: { ...st, me: { id: String(user.id), name: by, subscribed: !!me?.chatId }, bot } };
}
