alter table public.assets
add column purchase_date date,
add column purchase_price numeric(12, 2)
  check (purchase_price > 0);
