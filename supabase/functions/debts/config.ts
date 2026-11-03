// Настройки берутся из секретов Supabase (Project Settings → Edge Functions → Secrets)
const env = (k: string, fallback = '') => Deno.env.get(k) ?? fallback;

export const BOT_TOKEN = env('DEBTS_BOT_TOKEN');
// Общий секрет: заголовок вебхука Telegram, ключ для cron и для /setup
export const SECRET = env('DEBTS_SECRET');
// Telegram ID тех, кому можно пользоваться ботом: «123,456»
export const ALLOWED = new Set(env('DEBTS_ALLOWED_IDS').split(/[\s,;]+/).filter(Boolean));
// Адрес мини-приложения, например https://klimgr.github.io/dolgi/
export const APP_URL = env('DEBTS_APP_URL');
export const TZ = env('DEBTS_TZ', 'Europe/Moscow');
export const MODEL = env('DEBTS_MODEL', 'claude-opus-5-5');
export const EFFORT = env('DEBTS_EFFORT', 'medium') as 'low' | 'medium' | 'high';
// Ключи ИИ читаем при каждом вызове: какой задан, той моделью бот и отвечает
export const GEMINI_API_KEY = () => env('GEMINI_API_KEY');
// Пусто — бот сам подберёт первую рабочую модель из списка в gemini.ts
export const GEMINI_MODEL = () => env('DEBTS_GEMINI_MODEL');
export const ANTHROPIC_API_KEY = () => env('ANTHROPIC_API_KEY');
// Ключ Groq (бесплатный тариф, можно один и тот же для нескольких ботов)
export const GROQ_API_KEY = () => env('GROQ_API_KEY');
export const SUPABASE_URL = env('SUPABASE_URL');
export const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

export const isAllowed = (id: number | string | undefined) => id !== undefined && ALLOWED.has(String(id));
