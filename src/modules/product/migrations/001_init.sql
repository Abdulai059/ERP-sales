create table product_category (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references product_category(id),
  created_at timestamptz not null default now()
);

create table product (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  barcode text unique,
  category_id uuid references product_category(id),
  price_minor bigint not null check (price_minor >= 0),   -- whole number, smallest currency unit
  currency char(3) not null,
  tax_code text,
  track_stock boolean not null default false,
  unit text not null default 'unit',
  qty_decimals smallint not null default 0 check (qty_decimals between 0 and 3), -- 3 = weighed goods
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_name_idx on product (lower(name));
create index product_category_idx on product (category_id);
