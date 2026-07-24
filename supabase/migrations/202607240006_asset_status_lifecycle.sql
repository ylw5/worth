create table public.asset_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  asset_id uuid not null unique
    references public.assets(id) on delete cascade,
  sold_at date not null check (sold_at <= current_date),
  sale_price numeric(12, 2) not null check (sale_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_status text check (
    from_status is null
    or from_status in ('in_use', 'idle', 'listed', 'sold')
  ),
  to_status text not null check (
    to_status in ('in_use', 'idle', 'listed', 'sold')
  ),
  created_at timestamptz not null default now()
);

create index asset_status_events_asset_created_idx
  on public.asset_status_events (asset_id, created_at desc);

alter table public.asset_sales enable row level security;
alter table public.asset_status_events enable row level security;

create policy asset_sales_owner_select on public.asset_sales
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy asset_status_events_owner_select
  on public.asset_status_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.asset_sales
  from anon, authenticated;
revoke insert, update, delete on public.asset_status_events
  from anon, authenticated;
grant select on public.asset_sales to authenticated;
grant select on public.asset_status_events to authenticated;

insert into public.asset_status_events (
  user_id,
  asset_id,
  from_status,
  to_status,
  created_at
)
select
  user_id,
  id,
  null,
  status,
  created_at
from public.assets;

create function public.record_asset_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.asset_status_events (
      user_id,
      asset_id,
      from_status,
      to_status
    )
    values (new.user_id, new.id, null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.asset_status_events (
      user_id,
      asset_id,
      from_status,
      to_status
    )
    values (new.user_id, new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger assets_record_status_event
after insert or update of status on public.assets
for each row execute function public.record_asset_status_event();

create function public.set_asset_status(
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
  set status = p_status, updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'asset not found';
  end if;
end;
$$;

create function public.record_asset_sale(
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
  set status = 'sold', updated_at = now()
  where id = p_asset_id
    and user_id = (select auth.uid());
end;
$$;

revoke all on function public.record_asset_status_event() from public;
revoke all on function public.set_asset_status(uuid, text) from public;
revoke all on function public.record_asset_sale(uuid, date, numeric)
  from public;

grant execute on function public.set_asset_status(uuid, text)
  to authenticated;
grant execute on function public.record_asset_sale(uuid, date, numeric)
  to authenticated;
