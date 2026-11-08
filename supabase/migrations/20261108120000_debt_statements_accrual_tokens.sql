-- День выписки по карте; проценты по займам МФО, которые растут каждый день; личные ссылки участников.
alter table debts
  add column if not exists statement_day smallint check (statement_day between 1 and 31), -- число месяца, когда банк формирует выписку
  add column if not exists principal numeric(14, 2),                                       -- основной долг займа: на него начисляются проценты
  add column if not exists accrued_to date;                                                -- по какой день проценты уже в balance

alter table debt_events drop constraint if exists debt_events_type_check;
alter table debt_events add constraint debt_events_type_check check (type in ('payment', 'balance', 'charge', 'interest'));

alter table debt_members
  add column if not exists app_token text,      -- вход в приложение с экрана телефона, без Telegram
  add column if not exists calendar_token text; -- подписка на платежи в Календаре (только чтение)
create unique index if not exists debt_members_app_token_idx on debt_members (app_token) where app_token is not null;
create unique index if not exists debt_members_calendar_token_idx on debt_members (calendar_token) where calendar_token is not null;
