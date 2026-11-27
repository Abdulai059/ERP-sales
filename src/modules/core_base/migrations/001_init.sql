create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table role (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);
create table permission (
  code text primary key,
  description text not null,
  module text not null
);
create table role_permission (
  role_id uuid not null references role(id) on delete cascade,
  permission_code text not null references permission(code) on delete cascade,
  primary key (role_id, permission_code)
);
create table user_role (
  user_id uuid not null references app_user(id) on delete cascade,
  role_id uuid not null references role(id) on delete cascade,
  primary key (user_id, role_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity text,
  entity_id text,
  reason text,
  data jsonb
);
create function audit_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_immutable();

create table outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts int not null default 0,
  last_error text,
  failed boolean not null default false
);
create index outbox_pending on outbox (created_at) where delivered_at is null and not failed;

create table sequence (
  name text primary key,
  prefix text not null default '',
  next_value bigint not null default 1
);

insert into role (name, description) values ('owner', 'Full access');
