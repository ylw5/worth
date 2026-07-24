-- Adds the evaluation and daily sell-plan data foundation.
alter table public.assets
add column subcategory text not null default '',
add column status text not null default 'in_use'
  check (status in ('in_use', 'idle', 'listed', 'sold')),
add column latest_market_price_low numeric(12, 2)
  check (latest_market_price_low > 0),
add column latest_market_price_high numeric(12, 2)
  check (latest_market_price_high > 0);

alter table public.assets
add constraint assets_latest_market_price_range
check (
  latest_market_price_low is null
  or latest_market_price_high is null
  or latest_market_price_high >= latest_market_price_low
);

create index assets_user_status_idx
  on public.assets (user_id, status, updated_at desc);

create or replace function public.record_valuation(
  p_asset_id uuid,
  p_estimated_price numeric,
  p_price_low numeric,
  p_price_high numeric,
  p_sample_count integer,
  p_query text,
  p_sample_summary jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.valuations (
    asset_id,
    user_id,
    estimated_price,
    price_low,
    price_high,
    sample_count,
    query,
    sample_summary
  )
  values (
    p_asset_id,
    (select auth.uid()),
    p_estimated_price,
    p_price_low,
    p_price_high,
    p_sample_count,
    p_query,
    p_sample_summary
  );

  update public.assets
  set
    latest_market_price = p_estimated_price,
    latest_market_price_low = p_price_low,
    latest_market_price_high = p_price_high,
    latest_valuation_at = now(),
    updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'asset not found';
  end if;
end;
$$;

create table public.purchase_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  product_url text not null check (length(trim(product_url)) > 0),
  product_title text not null check (length(trim(product_title)) > 0),
  product_price numeric(12, 2) check (product_price > 0),
  category text not null check (
    category in ('数码', '家电', '家具', '服饰箱包', '珠宝腕表', '收藏', '交通工具', '其他')
  ),
  subcategory text not null default '',
  matched_assets jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  narrative text not null check (length(trim(narrative)) > 0),
  parser_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index purchase_evaluations_user_created_idx
  on public.purchase_evaluations (user_id, created_at desc);

alter table public.purchase_evaluations enable row level security;

create policy purchase_evaluations_owner on public.purchase_evaluations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.sell_plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  wishlist_item_id uuid not null
    references public.wishlist_items(id) on delete cascade,
  plan_date date not null,
  target_price numeric(12, 2) not null check (target_price > 0),
  estimated_total numeric(12, 2) not null check (estimated_total >= 0),
  coverage_ratio numeric(8, 4) not null check (coverage_ratio >= 0),
  is_reachable boolean not null,
  items jsonb not null default '[]'::jsonb,
  refresh_failures integer not null default 0 check (refresh_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, wishlist_item_id, plan_date)
);

create index sell_plan_snapshots_wishlist_date_idx
  on public.sell_plan_snapshots (wishlist_item_id, plan_date desc);

alter table public.sell_plan_snapshots enable row level security;

create policy sell_plan_snapshots_owner on public.sell_plan_snapshots
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.wishlist_items
      where wishlist_items.id = wishlist_item_id
        and wishlist_items.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.wishlist_items
      where wishlist_items.id = wishlist_item_id
        and wishlist_items.user_id = (select auth.uid())
    )
  );
