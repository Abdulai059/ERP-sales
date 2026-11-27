create table pos_outlet (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('retail','restaurant')),
  currency char(3) not null,
  tax_inclusive boolean not null default false,   -- are product prices tax-inclusive at this outlet?
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table pos_register (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references pos_outlet(id),
  name text not null,
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),   -- receipt prefix, e.g. MAIN-1042
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, name)
);
create table pos_tax (
  code text primary key,
  name text not null,
  rate_bp int not null check (rate_bp between 0 and 10000)      -- 1500 = 15.00%
);
create table pos_payment_method (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('cash','card','mobile_money','other')),
  active boolean not null default true
);
insert into pos_payment_method (code, name, type) values ('cash', 'Cash', 'cash');

create table pos_session (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references pos_register(id),
  cashier_id uuid not null,
  state text not null default 'open' check (state in ('open','closed')),
  opening_cash_minor bigint not null check (opening_cash_minor >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  counted_cash_minor bigint,
  expected_cash_minor bigint,
  difference_minor bigint
);
create unique index pos_session_one_open on pos_session (register_id) where state = 'open';

create table pos_order (
  id uuid primary key default gen_random_uuid(),     -- may be supplied by the client (idempotent create)
  session_id uuid not null references pos_session(id),
  register_id uuid not null references pos_register(id),
  state text not null default 'open' check (state in ('open','paid','cancelled','refunded')),
  currency char(3) not null,
  tax_inclusive boolean not null,
  subtotal_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  receipt_no text unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index pos_order_session_idx on pos_order (session_id);

create table pos_order_line (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_order(id),
  product_id uuid not null references product(id),
  name text not null,                                   -- snapshot at sale time
  qty_milli bigint not null check (qty_milli > 0),      -- 1000 = 1 unit; 500 = 0.5 kg
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  tax_code text,
  tax_rate_bp int not null,
  net_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  created_at timestamptz not null default now()
);

create table pos_payment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_order(id),
  session_id uuid not null references pos_session(id),  -- the session in which the money moved
  method_id uuid not null references pos_payment_method(id),
  kind text not null check (kind in ('payment','refund')),
  amount_minor bigint not null check (amount_minor <> 0),   -- refunds are negative
  tendered_minor bigint,
  change_minor bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table pos_order_adjustment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_order(id),
  kind text not null check (kind in ('cancel','refund')),
  reason text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);

-- Append-only: payments and adjustments can never be changed or removed.
create function pos_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger pos_payment_append_only before update or delete on pos_payment
  for each row execute function pos_append_only();
create trigger pos_adjustment_append_only before update or delete on pos_order_adjustment
  for each row execute function pos_append_only();

-- Orders are never deleted; once not open, amounts are frozen and only paid -> refunded is allowed.
create function pos_order_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'orders cannot be deleted'; end if;
  if old.state <> 'open' then
    if new.total_minor <> old.total_minor or new.subtotal_minor <> old.subtotal_minor
       or new.tax_minor <> old.tax_minor or new.receipt_no is distinct from old.receipt_no then
      raise exception 'closed order amounts cannot change';
    end if;
    if not (old.state = 'paid' and new.state in ('paid','refunded')) and new.state <> old.state then
      raise exception 'invalid order state change % -> %', old.state, new.state;
    end if;
  end if;
  return new;
end $$;
create trigger pos_order_guard_t before update or delete on pos_order
  for each row execute function pos_order_guard();

-- Lines are frozen once the order is no longer open.
create function pos_line_guard() returns trigger language plpgsql as $$
declare st text;
begin
  select state into st from pos_order where id = coalesce(old.order_id, new.order_id);
  if st <> 'open' then raise exception 'lines of a % order cannot change', st; end if;
  return coalesce(new, old);
end $$;
create trigger pos_line_guard_t before update or delete on pos_order_line
  for each row execute function pos_line_guard();
