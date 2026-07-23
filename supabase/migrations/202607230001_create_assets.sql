create extension if not exists pgcrypto;

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  photo_path text not null,
  name text not null check (length(trim(name)) > 0),
  brand text not null default '',
  model text not null default '',
  specs jsonb not null default '{}'::jsonb,
  category text not null check (
    category in ('数码', '家电', '家具', '服饰箱包', '珠宝腕表', '收藏', '交通工具', '其他')
  ),
  condition text not null default '',
  search_query text not null check (length(trim(search_query)) > 0),
  latest_market_price numeric(12, 2) check (latest_market_price > 0),
  latest_valuation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.valuations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estimated_price numeric(12, 2) not null check (estimated_price > 0),
  price_low numeric(12, 2) not null check (price_low > 0),
  price_high numeric(12, 2) not null check (price_high >= price_low),
  sample_count integer not null check (sample_count >= 5),
  query text not null,
  sample_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index assets_user_created_idx
  on public.assets (user_id, created_at desc);
create index valuations_asset_created_idx
  on public.valuations (asset_id, created_at desc);
create index valuations_user_id_idx on public.valuations (user_id);

alter table public.assets enable row level security;
alter table public.valuations enable row level security;

create policy assets_owner on public.assets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy valuations_owner on public.valuations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.assets
      where assets.id = asset_id
        and assets.user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', false)
on conflict (id) do update set public = excluded.public;

create policy asset_photos_owner on storage.objects
  for all to authenticated
  using (
    bucket_id = 'asset-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'asset-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

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
    latest_valuation_at = now(),
    updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'asset not found';
  end if;
end;
$$;

grant execute on function public.record_valuation(
  uuid, numeric, numeric, numeric, integer, text, jsonb
) to authenticated;
