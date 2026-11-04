// Точка входа функции «debts»:
//   POST /debts/webhook — обновления от Telegram
//   POST /debts/cron    — ежедневные напоминания (pg_cron, заголовок x-cron-key)
//   GET  /debts/setup?key=… — подключить вебхук, меню и команды бота (один раз после деплоя)
//   GET  /debts/ai-check — проверить ключ ИИ и подобрать модель
//   GET  /debts/avatar?key=… — поставить боту аватарку avatar.jpg с сайта мини-приложения
//   POST /debts         — API мини-приложения
import { handleApi } from './api.ts';
import { handleUpdate, type TgUpdate } from './bot.ts';
import { APP_URL, BOT_TOKEN, GEMINI_API_KEY, SECRET, SUPABASE_URL } from './config.ts';
import { isServiceKey } from './db.ts';
import { runReminders } from './reminders.ts';
import { tg, tgUpload } from './telegram.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// Ответить Telegram сразу, а работу (Claude может думать полминуты) доделать в фоне
function background(p: Promise<unknown>) {
  const task = p.catch(e => console.error('background', e));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
  return task;
}

async function setup() {
  const base = `${SUPABASE_URL}/functions/v1/debts`;
  await tg('setWebhook', {
    url: `${base}/webhook`,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await tg('setMyCommands', {
    commands: [
      { command: 'summary', description: 'Сводка по долгам' },
      { command: 'next', description: 'Ближайшие платежи' },
      { command: 'reset', description: 'Начать разговор заново' },
      { command: 'help', description: 'Что умеет бот' },
    ],
  });
  if (APP_URL) {
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Долги', web_app: { url: APP_URL } } });
  }
  const me = await tg<{ username: string }>('getMe');
  return { ok: true, bot: `@${me.username}`, webhook: `${base}/webhook`, app: APP_URL || 'DEBTS_APP_URL не задан — кнопки приложения не будет' };
}

// Аватарка — avatar.jpg в корне репозитория; бот ставит её себе сам.
// Берём прямо из репозитория: сайт на GitHub Pages может обновиться позже
const AVATAR_URL = 'https://raw.githubusercontent.com/klimGr/dolgi/main/avatar.jpg';
async function setAvatar() {
  const res = await fetch(AVATAR_URL);
  if (!res.ok) throw new Error(`avatar.jpg: ${res.status}`);
  const photo = new Blob([await res.arrayBuffer()], { type: 'image/jpeg' });
  await tgUpload('setMyProfilePhoto', { photo: { type: 'static', photo: 'attach://avatar' } }, { avatar: photo });
  return { ok: true, size: photo.size };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, '').split('/').pop();

  if (!BOT_TOKEN || !SECRET) return json({ error: 'Не заданы секреты DEBTS_BOT_TOKEN и DEBTS_SECRET' }, 500);

  try {
    if (route === 'webhook') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('forbidden', { status: 403 });
      const update = (await req.json()) as TgUpdate;
      background(handleUpdate(update));
      return new Response('ok');
    }

    if (route === 'cron') {
      if (!(await isServiceKey(req.headers.get('x-cron-key') || url.searchParams.get('key'), SECRET))) return json({ error: 'forbidden' }, 403);
      return json(await runReminders());
    }

    if (route === 'avatar') {
      if (!(await isServiceKey(url.searchParams.get('key') || req.headers.get('x-cron-key'), SECRET))) return json({ error: 'forbidden' }, 403);
      return json(await setAvatar());
    }

    if (route === 'setup') {
      if (!(await isServiceKey(url.searchParams.get('key') || req.headers.get('x-cron-key'), SECRET))) return json({ error: 'forbidden' }, 403);
      return json(await setup());
    }

    // Проверка ключа ИИ: какие модели отвечают (ключ не раскрывается)
    if (route === 'ai-check') {
      if (!(await isServiceKey(url.searchParams.get('key') || req.headers.get('x-cron-key'), SECRET))) return json({ error: 'forbidden' }, 403);
      const { checkGemini, MODEL_CANDIDATES } = await import('./gemini.ts');
      const { checkGroq } = await import('./groq.ts');
      const models = url.searchParams.get('models')?.split(',').filter(Boolean) ?? MODEL_CANDIDATES;
      const [gemini, groq] = await Promise.all([
        GEMINI_API_KEY() ? checkGemini(models) : { configured: false },
        checkGroq(),
      ]);
      return json({ gemini, groq });
    }

    if (req.method === 'POST') {
      const { status, data } = await handleApi(await req.json());
      return json(data, status);
    }
    return json({ ok: true, name: 'debts' });
  } catch (e) {
    console.error(route, e);
    return json({ error: 'Ошибка сервера' }, 500);
  }
});
