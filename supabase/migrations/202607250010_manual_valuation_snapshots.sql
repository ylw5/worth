-- Manual refresh writes today's market snapshot without an analysis run.
alter table public.market_snapshots
alter column run_id drop not null;

create policy market_snapshots_owner_insert on public.market_snapshots
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy market_snapshots_owner_update on public.market_snapshots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
declare
  v_user_id uuid := (select auth.uid());
  v_market_key text;
  v_snapshot_date date := (now() at time zone 'Asia/Shanghai')::date;
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
    v_user_id,
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
    and user_id = v_user_id
  returning market_key into v_market_key;

  if not found then
    raise exception 'asset not found';
  end if;

  if p_sample_count < 5
    or p_estimated_price is null
    or p_price_low is null
    or p_price_high is null then
    return;
  end if;

  insert into public.market_snapshots (
    user_id,
    asset_id,
    run_id,
    snapshot_date,
    estimated_price,
    price_low,
    price_high,
    sample_count,
    query,
    samples
  )
  select
    a.user_id,
    a.id,
    null,
    v_snapshot_date,
    p_estimated_price,
    p_price_low,
    p_price_high,
    p_sample_count,
    p_query,
    coalesce(p_sample_summary, '[]'::jsonb)
  from public.assets a
  where a.user_id = v_user_id
    and a.market_key = v_market_key
    and a.status <> 'sold'
  on conflict (asset_id, snapshot_date) do update set
    run_id = coalesce(excluded.run_id, public.market_snapshots.run_id),
    estimated_price = excluded.estimated_price,
    price_low = excluded.price_low,
    price_high = excluded.price_high,
    sample_count = excluded.sample_count,
    query = excluded.query,
    samples = excluded.samples,
    created_at = now();

  update public.assets
  set
    latest_market_price = p_estimated_price,
    latest_market_price_low = p_price_low,
    latest_market_price_high = p_price_high,
    latest_valuation_at = now(),
    updated_at = now()
  where user_id = v_user_id
    and market_key = v_market_key
    and status <> 'sold';
end;
$$;
