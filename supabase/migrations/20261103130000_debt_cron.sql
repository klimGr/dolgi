-- Напоминания о платежах: каждый день в 07:00 UTC = 10:00 МСК функция обходит долги.
-- Ключ для вызова берётся из debt_settings, никуда копировать его не нужно.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('debts-reminders', '0 7 * * *', $job$
  select net.http_post(
    url := 'https://fpyxaygiiiivnjrujqyf.supabase.co/functions/v1/debts/cron',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select value from public.debt_settings where key = 'cron_key')),
    body := '{}'::jsonb
  );
$job$);
