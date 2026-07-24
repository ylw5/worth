create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  market_key text not null,
  kind text not null check (kind in ('market', 'forecast')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  run_date date not null default current_date,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, market_key, kind, run_date)
);

create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  snapshot_date date not null,
  estimated_price numeric(12, 2) not null check (estimated_price > 0),
  price_low numeric(12, 2) not null check (price_low > 0),
  price_high numeric(12, 2) not null check (price_high >= price_low),
  sample_count integer not null check (sample_count >= 5),
  query text not null check (length(trim(query)) > 0),
  source text not null default 'xianyu_active_listings',
  samples jsonb not null,
  created_at timestamptz not null default now(),
  unique (asset_id, snapshot_date)
);

create index analysis_runs_due_idx
  on public.analysis_runs (status, kind, run_date);
create index market_snapshots_asset_date_idx
  on public.market_snapshots (asset_id, snapshot_date desc);

alter table public.analysis_runs enable row level security;
alter table public.market_snapshots enable row level security;
create policy analysis_runs_owner on public.analysis_runs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy market_snapshots_owner on public.market_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

alter table public.assets
add column market_key text generated always as (
  md5(lower(trim(search_query)) || '|' || condition)
) stored;
create index assets_user_market_key_idx
  on public.assets (user_id, market_key);

create function public.enqueue_daily_market_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select a.user_id, (array_agg(a.id order by a.id))[1],
         a.market_key, 'market', current_date
  from public.assets a
  where a.status <> 'sold'
    and (
      a.latest_valuation_at is null
      or a.latest_valuation_at < now() - interval '20 hours'
    )
  group by a.user_id, a.market_key
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create function public.claim_analysis_run(p_run_id uuid)
returns public.analysis_runs
language plpgsql
security definer
set search_path = ''
as $$
declare claimed public.analysis_runs;
begin
  update public.analysis_runs
  set status = 'running', started_at = now(),
      attempt_count = attempt_count + 1, error_message = null
  where id = p_run_id and status in ('queued', 'failed')
  returning * into claimed;
  return claimed;
end;
$$;

create function public.complete_market_run(p_run_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare run public.analysis_runs;
begin
  select * into strict run from public.analysis_runs
  where id = p_run_id and kind = 'market' and status = 'running' for update;

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
    p_result->>'query', p_result->'samples'
  from public.assets a
  where a.user_id = run.user_id and a.market_key = run.market_key
  on conflict (asset_id, snapshot_date) do update set
    run_id = excluded.run_id,
    estimated_price = excluded.estimated_price,
    price_low = excluded.price_low,
    price_high = excluded.price_high,
    sample_count = excluded.sample_count,
    query = excluded.query,
    samples = excluded.samples,
    created_at = now();

  update public.assets set
    latest_market_price = (p_result->>'estimated_price')::numeric,
    latest_market_price_low = (p_result->>'price_low')::numeric,
    latest_market_price_high = (p_result->>'price_high')::numeric,
    latest_valuation_at = now(), updated_at = now()
  where user_id = run.user_id and market_key = run.market_key;

  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

create function public.fail_analysis_run(p_run_id uuid, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analysis_runs
  set status = 'failed', error_message = left(p_message, 500), finished_at = now()
  where id = p_run_id and status = 'running';
$$;

revoke all on function public.enqueue_daily_market_runs() from public;
revoke all on function public.claim_analysis_run(uuid) from public;
revoke all on function public.complete_market_run(uuid, jsonb) from public;
revoke all on function public.fail_analysis_run(uuid, text) from public;
grant execute on function public.enqueue_daily_market_runs() to service_role;
grant execute on function public.claim_analysis_run(uuid) to service_role;
grant execute on function public.complete_market_run(uuid, jsonb) to service_role;
grant execute on function public.fail_analysis_run(uuid, text) to service_role;
