-- Таблицы нужны только серверной функции (service_role). Убираем права, которые Supabase выдал ролям anon и authenticated по умолчанию:
-- RLS и так закрывает строки, но TRUNCATE под RLS не подпадает.
revoke all on table
  public.debt_members, public.debts, public.debt_events, public.debt_reminders,
  public.debt_chat, public.debt_media, public.debt_settings
from anon, authenticated;
revoke all on sequence public.debt_chat_id_seq from anon, authenticated;

-- По умолчанию pg_net ждёт ответа 5 секунд, а обход долгов и отправка напоминаний идут дольше
select cron.schedule('debts-reminders', '0 7 * * *', $job$
  select net.http_post(
    url := 'https://fpyxaygiiiivnjrujqyf.supabase.co/functions/v1/debts/cron',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select value from public.debt_settings where key = 'cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
