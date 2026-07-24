alter table public.wishlist_items
add column price_source_url text,
add column price_checked_at timestamptz;

create table public.replacement_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  wishlist_item_id uuid not null
    references public.wishlist_items(id) on delete cascade,
  forecast_id uuid not null
    references public.asset_forecasts(id) on delete cascade,
  horizon_months integer not null check (horizon_months in (6, 12)),
  target_price numeric(12, 2) not null check (target_price > 0),
  current_asset_value numeric(12, 2) not null check (current_asset_value > 0),
  future_asset_value numeric(12, 2) not null check (future_asset_value > 0),
  change_now_cash numeric(12, 2) not null,
  change_later_cash numeric(12, 2) not null,
  waiting_cash_difference numeric(12, 2) not null,
  assumptions jsonb not null,
  created_at timestamptz not null default now()
);

create index replacement_scenarios_asset_created_idx
  on public.replacement_scenarios (asset_id, created_at desc);
alter table public.replacement_scenarios enable row level security;
create policy replacement_scenarios_owner on public.replacement_scenarios
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.assets
      where assets.id = asset_id
        and assets.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.wishlist_items
      where wishlist_items.id = wishlist_item_id
        and wishlist_items.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.asset_forecasts
      where asset_forecasts.id = forecast_id
        and asset_forecasts.asset_id = replacement_scenarios.asset_id
        and asset_forecasts.user_id = (select auth.uid())
    )
  );

alter table public.asset_sales
add column platform text not null default '',
add column notes text not null default '';

create function public.record_asset_sale(
  p_asset_id uuid,
  p_sold_at date,
  p_sale_price numeric,
  p_platform text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sold_at is null or p_sold_at > current_date then
    raise exception 'invalid sold date';
  end if;
  if p_sale_price is null or p_sale_price <= 0 then
    raise exception 'invalid sale price';
  end if;

  perform 1
  from public.assets
  where id = p_asset_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'asset not found';
  end if;

  insert into public.asset_sales (
    user_id, asset_id, sold_at, sale_price, platform, notes
  ) values (
    (select auth.uid()), p_asset_id, p_sold_at, p_sale_price,
    p_platform, p_notes
  )
  on conflict (asset_id) do update set
    sold_at = excluded.sold_at,
    sale_price = excluded.sale_price,
    platform = excluded.platform,
    notes = excluded.notes,
    updated_at = now();

  update public.assets
  set status = 'sold', updated_at = now()
  where id = p_asset_id and user_id = (select auth.uid());
end;
$$;

revoke all on function public.record_asset_sale(
  uuid, date, numeric, text, text
) from public;
grant execute on function public.record_asset_sale(
  uuid, date, numeric, text, text
) to authenticated;

create view public.forecast_backtest_results
with (security_invoker = true)
as
select
  f.user_id,
  f.id as forecast_id,
  f.asset_id,
  h.horizon_months,
  f.forecast_date,
  (f.forecast_date + make_interval(months => h.horizon_months))::date
    as target_date,
  h.predicted_value,
  coalesce(s.sale_price, m.estimated_price) as observed_value,
  case
    when coalesce(s.sale_price, m.estimated_price) is null then null
    else round(
      abs(h.predicted_value - coalesce(s.sale_price, m.estimated_price))
      / coalesce(s.sale_price, m.estimated_price),
      4
    )
  end as absolute_percentage_error,
  case
    when s.sale_price is not null then 'sale'
    when m.estimated_price is not null then 'market_snapshot'
    else null
  end as observation_source
from public.asset_forecasts f
cross join lateral (
  values (6, f.value_6m), (12, f.value_12m)
) as h(horizon_months, predicted_value)
left join lateral (
  select sale_price
  from public.asset_sales
  where asset_sales.asset_id = f.asset_id
    and abs(asset_sales.sold_at - (
      f.forecast_date + make_interval(months => h.horizon_months)
    )::date) <= 30
  order by abs(asset_sales.sold_at - (
    f.forecast_date + make_interval(months => h.horizon_months)
  )::date)
  limit 1
) s on true
left join lateral (
  select estimated_price
  from public.market_snapshots
  where market_snapshots.asset_id = f.asset_id
    and abs(market_snapshots.snapshot_date - (
      f.forecast_date + make_interval(months => h.horizon_months)
    )::date) <= 30
  order by abs(market_snapshots.snapshot_date - (
    f.forecast_date + make_interval(months => h.horizon_months)
  )::date)
  limit 1
) m on s.sale_price is null
where h.predicted_value is not null;

grant select on public.forecast_backtest_results to authenticated;
