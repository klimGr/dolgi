-- В новых проектах Supabase таблицы не открыты для Data API по умолчанию.
-- Доступ нужен только серверной функции (service_role); anon и authenticated по-прежнему без прав.
grant select, insert, update, delete on table
  public.debt_members, public.debts, public.debt_events, public.debt_reminders,
  public.debt_chat, public.debt_media, public.debt_settings
to service_role;
grant usage, select on sequence public.debt_chat_id_seq to service_role;
