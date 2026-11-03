-- Трекер долгов: бот и мини-приложение в Telegram.
-- Все таблицы с префиксом debt*.
-- Доступ только у серверной функции (service role), поэтому RLS включён без политик.

create table if not exists debt_members (
  tg_id      bigint primary key,
  name       text not null default '',
  chat_id    bigint,
  created_at timestamptz not null default now()
);

create table if not exists debts (
  id           text primary key,
  name         text not null,
  kind         text not null default 'loan'
               check (kind in ('card', 'loan', 'microloan', 'installment', 'other')),
  owner        text not null default 'common',      -- Telegram ID владельца или 'common'
  creditor     text not null default '',
  color        smallint not null default 1,         -- номер цвета 1–8
  start_amount numeric(14, 2) not null default 0,   -- от этой суммы считаем 100 %
  balance      numeric(14, 2) not null default 0,   -- сколько осталось отдать
  credit_limit numeric(14, 2),
  rate         numeric(8, 3),                       -- % годовых
  min_payment  numeric(14, 2),
  pay_day      smallint check (pay_day between 1 and 31),
  paid_due     date,                                -- последний закрытый срок платежа
  end_date     date,
  notes        text not null default '',
  files        jsonb not null default '[]'::jsonb,  -- [{id, name, type}] — file_id из Telegram
  closed       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists debt_events (
  id         text primary key,
  debt_id    text not null references debts (id) on delete cascade,
  type       text not null check (type in ('payment', 'balance', 'charge')),
  amount     numeric(14, 2) not null,
  delta      numeric(14, 2) not null default 0,      -- как изменился остаток
  date       date not null,
  by_name    text not null default '',
  note       text not null default '',
  due_before date,                                   -- paid_due до события (для отмены)
  due_after  date,
  created_at timestamptz not null default now()
);
create index if not exists debt_events_debt_idx on debt_events (debt_id, date desc);

-- Какие напоминания уже отправлены, чтобы не повторяться
create table if not exists debt_reminders (
  debt_id text not null references debts (id) on delete cascade,
  due     date not null,
  stage   text not null,
  sent_at timestamptz not null default now(),
  primary key (debt_id, due, stage)
);

-- Короткая история переписки с ботом (только текст)
create table if not exists debt_chat (
  id         bigserial primary key,
  chat_id    bigint not null,
  role       text not null check (role in ('user', 'assistant')),
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists debt_chat_idx on debt_chat (chat_id, id desc);

-- Альбомы: Telegram присылает каждое фото отдельно, собираем их в одну пачку
create table if not exists debt_media (
  group_id   text not null,
  message_id bigint not null,
  file       jsonb not null,
  caption    text not null default '',
  created_at timestamptz not null default now(),
  primary key (group_id, message_id)
);

alter table debt_members   enable row level security;
alter table debts          enable row level security;
alter table debt_events    enable row level security;
alter table debt_reminders enable row level security;
alter table debt_chat      enable row level security;
alter table debt_media     enable row level security;
