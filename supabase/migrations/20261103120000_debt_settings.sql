-- Служебные настройки бота.
-- cron_key — ключ, с которым расписание pg_cron вызывает функцию (/cron и /setup).
-- Генерируется прямо в базе и больше никуда не копируется.
create table if not exists debt_settings (
  key   text primary key,
  value text not null
);
alter table debt_settings enable row level security;

insert into debt_settings (key, value)
values ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;
