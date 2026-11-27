create table room (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  type text not null check (type in ('single','double','suite')),
  rate_cents int not null check (rate_cents >= 0),
  status text not null default 'available'
    check (status in ('available','occupied','cleaning','maintenance')),
  created_at timestamptz not null default now()
);
