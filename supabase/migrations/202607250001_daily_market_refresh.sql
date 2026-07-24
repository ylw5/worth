create or replace function public.enqueue_daily_market_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select
    a.user_id,
    (array_agg(a.id order by a.id))[1],
    a.market_key,
    'market',
    (now() at time zone 'Asia/Shanghai')::date
  from public.assets a
  where a.status <> 'sold'
  group by a.user_id, a.market_key
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create or replace function public.complete_market_run(
  p_run_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.analysis_runs;
begin
  select * into strict run
  from public.analysis_runs
  where id = p_run_id and kind = 'market' and status = 'running'
  for update;

  insert into public.market_snapshots (
    user_id, asset_id, run_id, snapshot_date, estimated_price,
    price_low, price_high, sample_count, query, samples
  )
  select
    run.user_id, a.id, run.id, run.run_date,
    (p_result->>'estimated_price')::numeric,
    (p_result->>'price_low')::numeric,
    (p_result->>'price_high')::numeric,
    (p_result->>'sample_count')::integer,
    p_result->>'query',
    p_result->'samples'
  from public.assets a
  where a.user_id = run.user_id
    and a.market_key = run.market_key
    and a.status <> 'sold'
  on conflict (asset_id, snapshot_date) do update set
    run_id = excluded.run_id,
    estimated_price = excluded.estimated_price,
    price_low = excluded.price_low,
    price_high = excluded.price_high,
    sample_count = excluded.sample_count,
    query = excluded.query,
    samples = excluded.samples,
    created_at = now();

  update public.assets
  set
    latest_market_price = (p_result->>'estimated_price')::numeric,
    latest_market_price_low = (p_result->>'price_low')::numeric,
    latest_market_price_high = (p_result->>'price_high')::numeric,
    latest_valuation_at = now(),
    updated_at = now()
  where user_id = run.user_id
    and market_key = run.market_key
    and status <> 'sold';

  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

revoke all on function public.enqueue_daily_market_runs() from public;
revoke all on function public.complete_market_run(uuid, jsonb) from public;
grant execute on function public.enqueue_daily_market_runs() to service_role;
grant execute on function public.complete_market_run(uuid, jsonb) to service_role;
