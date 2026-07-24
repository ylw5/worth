alter table public.assets
add column valuation_profile jsonb not null default '{}'::jsonb;

create table public.asset_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  run_id uuid not null unique references public.analysis_runs(id) on delete cascade,
  forecast_date date not null,
  method text not null check (
    method in ('own_history', 'comparable_retention', 'unavailable')
  ),
  value_6m numeric(12, 2) check (value_6m > 0),
  low_6m numeric(12, 2) check (low_6m > 0),
  high_6m numeric(12, 2) check (high_6m >= low_6m),
  value_12m numeric(12, 2) check (value_12m > 0),
  low_12m numeric(12, 2) check (low_12m > 0),
  high_12m numeric(12, 2) check (high_12m >= low_12m),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  reason text not null,
  profile jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (asset_id, forecast_date)
);

create index asset_forecasts_asset_date_idx
  on public.asset_forecasts (asset_id, forecast_date desc);
alter table public.asset_forecasts enable row level security;
create policy asset_forecasts_owner on public.asset_forecasts
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.enqueue_weekly_forecast_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select a.user_id, a.id, a.id::text, 'forecast', current_date
  from public.assets a
  where a.status <> 'sold' and a.latest_market_price is not null
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create function public.complete_forecast_run(p_run_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare run public.analysis_runs;
begin
  select * into strict run from public.analysis_runs
  where id = p_run_id and kind = 'forecast' and status = 'running' for update;

  insert into public.asset_forecasts (
    user_id, asset_id, run_id, forecast_date, method,
    value_6m, low_6m, high_6m, value_12m, low_12m, high_12m,
    confidence, reason, profile, evidence
  ) values (
    run.user_id, run.asset_id, run.id, run.run_date, p_result->>'method',
    nullif(p_result->>'value_6m', '')::numeric,
    nullif(p_result->>'low_6m', '')::numeric,
    nullif(p_result->>'high_6m', '')::numeric,
    nullif(p_result->>'value_12m', '')::numeric,
    nullif(p_result->>'low_12m', '')::numeric,
    nullif(p_result->>'high_12m', '')::numeric,
    (p_result->>'confidence')::numeric,
    p_result->>'reason', p_result->'profile', p_result->'evidence'
  )
  on conflict (asset_id, forecast_date) do update set
    run_id = excluded.run_id, method = excluded.method,
    value_6m = excluded.value_6m, low_6m = excluded.low_6m,
    high_6m = excluded.high_6m, value_12m = excluded.value_12m,
    low_12m = excluded.low_12m, high_12m = excluded.high_12m,
    confidence = excluded.confidence, reason = excluded.reason,
    profile = excluded.profile, evidence = excluded.evidence,
    created_at = now();

  update public.assets
  set valuation_profile = p_result->'profile', updated_at = now()
  where id = run.asset_id;
  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

revoke all on function public.enqueue_weekly_forecast_runs() from public;
revoke all on function public.complete_forecast_run(uuid, jsonb) from public;
grant execute on function public.enqueue_weekly_forecast_runs() to service_role;
grant execute on function public.complete_forecast_run(uuid, jsonb) to service_role;
