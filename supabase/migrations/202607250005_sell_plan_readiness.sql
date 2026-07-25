-- Adds explicit sellability confirmation and traceable sell-plan snapshots.
alter table public.assets
add column status_confirmed_at timestamptz,
add column status_source text not null default 'default'
  check (status_source in ('default', 'user', 'system'));

-- Preserve statuses that were explicitly changed before this migration.
update public.assets as asset
set
  status_confirmed_at = (
    select event.created_at
    from public.asset_status_events as event
    where event.asset_id = asset.id
      and event.to_status = asset.status
      and event.from_status is not null
    order by event.created_at desc
    limit 1
  ),
  status_source = 'user'
where exists (
  select 1
  from public.asset_status_events as event
  where event.asset_id = asset.id
    and event.to_status = asset.status
    and event.from_status is not null
);

create index assets_user_status_confirmation_idx
  on public.assets (user_id, status_confirmed_at, status);

create or replace function public.set_asset_status(
  p_asset_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null
    or p_status not in ('in_use', 'idle', 'listed')
  then
    raise exception 'invalid direct asset status';
  end if;

  delete from public.asset_sales
  where asset_id = p_asset_id
    and user_id = (select auth.uid());

  update public.assets
  set
    status = p_status,
    status_confirmed_at = now(),
    status_source = 'user',
    updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'asset not found';
  end if;
end;
$$;

create or replace function public.confirm_asset_sellability(
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_asset_id uuid;
  v_asset_status text;
  update_count integer;
begin
  if p_updates is null
    or jsonb_typeof(p_updates) <> 'array'
    or jsonb_array_length(p_updates) < 1
    or jsonb_array_length(p_updates) > 100
  then
    raise exception 'invalid sellability updates';
  end if;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    v_asset_id := nullif(item->>'id', '')::uuid;
    v_asset_status := item->>'status';

    if v_asset_id is null
      or v_asset_status not in ('in_use', 'idle', 'listed')
    then
      raise exception 'invalid sellability update';
    end if;

    delete from public.asset_sales
    where asset_sales.asset_id = v_asset_id
      and asset_sales.user_id = (select auth.uid());

    update public.assets
    set
      status = v_asset_status,
      status_confirmed_at = now(),
      status_source = 'user',
      updated_at = now()
    where assets.id = v_asset_id
      and assets.user_id = (select auth.uid());

    get diagnostics update_count = row_count;
    if update_count <> 1 then
      raise exception 'asset not found';
    end if;
  end loop;
end;
$$;

create or replace function public.record_asset_sale(
  p_asset_id uuid,
  p_sold_at date,
  p_sale_price numeric
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
    user_id,
    asset_id,
    sold_at,
    sale_price
  )
  values (
    (select auth.uid()),
    p_asset_id,
    p_sold_at,
    p_sale_price
  )
  on conflict (asset_id) do update
  set
    sold_at = excluded.sold_at,
    sale_price = excluded.sale_price,
    updated_at = now();

  update public.assets
  set
    status = 'sold',
    status_confirmed_at = now(),
    status_source = 'user',
    updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());
end;
$$;

revoke all on function public.confirm_asset_sellability(jsonb) from public;
grant execute on function public.confirm_asset_sellability(jsonb)
  to authenticated;

alter table public.sell_plan_snapshots
add column input_fingerprint text not null default '',
add column readiness_counts jsonb not null default '{}'::jsonb,
add column calculation_version text not null default 'sell-plan-v2',
add column valuation_as_of timestamptz,
add column explanation jsonb not null default '{}'::jsonb;
