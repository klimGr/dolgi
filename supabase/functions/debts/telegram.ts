// Обёртки над Bot API и проверка входа из мини-приложения
import { BOT_TOKEN } from './config.ts';

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result as T;
}

/** Вызов с файлами (multipart/form-data): файлы — отдельными полями, ссылка на них — attach://<поле> */
export async function tgUpload<T = unknown>(method: string, fields: Record<string, unknown>, files: Record<string, Blob>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const [k, f] of Object.entries(files)) form.append(k, f, k);
  const res = await fetch(`${API}/${method}`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result as T;
}

export type Keyboard = { inline_keyboard: Record<string, unknown>[][] } | Record<string, unknown>;

/** Отправить HTML; длинное режем на части; если разметка сломалась — шлём простым текстом */
export async function sendText(chatId: number, html: string, keyboard?: Keyboard) {
  const parts = splitText(html, 3900);
  for (let i = 0; i < parts.length; i++) {
    const markup = i === parts.length - 1 && keyboard ? { reply_markup: keyboard } : {};
    try {
      await tg('sendMessage', { chat_id: chatId, text: parts[i], parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup });
    } catch {
      const plain = parts[i].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      await tg('sendMessage', { chat_id: chatId, text: plain, ...markup });
    }
  }
}

function splitText(text: string, max: number) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Пока бот думает — показываем «печатает…» (статус гаснет через 5 секунд, поэтому обновляем) */
export function keepTyping(chatId: number) {
  const send = () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  send();
  const timer = setInterval(send, 4500);
  return () => clearInterval(timer);
}

export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const file = await tg<{ file_path: string; file_size?: number }>('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error('Не удалось скачать файл из Telegram');
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
}

export function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------- вход из мини-приложения ---------- */
const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

let secretKey: Promise<Uint8Array> | undefined; // зависит только от токена — считаем один раз

export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }

/** Проверка подписи initData по алгоритму Telegram. Возвращает пользователя или null */
export async function verifyInitData(initData: string, maxAgeSec = 30 * 86400): Promise<TgUser | null> {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  secretKey ??= hmac(enc.encode('WebAppData'), BOT_TOKEN);
  const secret = await secretKey;
  const sig = hex(await hmac(secret, check));
  if (sig.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

export const userName = (u: TgUser | undefined) => u?.first_name || u?.username || '';
