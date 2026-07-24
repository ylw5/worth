alter table public.wishlist_items
  add column actual_price numeric(12, 2)
    check (actual_price is null or actual_price > 0),
  add column fulfilled_at timestamptz,
  add constraint wishlist_items_fulfillment_state_check
    check ((actual_price is null) = (fulfilled_at is null));

create table public.wishlist_funding_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wishlist_item_id uuid not null references public.wishlist_items(id),
  spending_resolution_id uuid references public.spending_resolutions(id),
  asset_sale_id uuid references public.asset_sales(id),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (
    (spending_resolution_id is not null)::integer
    + (asset_sale_id is not null)::integer = 1
  )
);

create unique index wishlist_allocations_resolution_once_idx
  on public.wishlist_funding_allocations (
    wishlist_item_id,
    spending_resolution_id
  )
  where spending_resolution_id is not null;

create unique index wishlist_allocations_sale_once_idx
  on public.wishlist_funding_allocations (
    wishlist_item_id,
    asset_sale_id
  )
  where asset_sale_id is not null;

create index wishlist_allocations_user_wishlist_idx
  on public.wishlist_funding_allocations (user_id, wishlist_item_id);
create index wishlist_allocations_resolution_idx
  on public.wishlist_funding_allocations (spending_resolution_id)
  where spending_resolution_id is not null;
create index wishlist_allocations_sale_idx
  on public.wishlist_funding_allocations (asset_sale_id)
  where asset_sale_id is not null;

alter table public.wishlist_funding_allocations enable row level security;

create policy wishlist_allocations_owner_select
  on public.wishlist_funding_allocations
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.wishlist_funding_allocations
  from anon, authenticated;
grant select on table public.wishlist_funding_allocations to authenticated;

drop policy wishlist_items_owner on public.wishlist_items;

create policy wishlist_items_owner_select
  on public.wishlist_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy wishlist_items_owner_insert
  on public.wishlist_items
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and actual_price is null
    and fulfilled_at is null
  );

create policy wishlist_items_owner_delete_unfulfilled
  on public.wishlist_items
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and fulfilled_at is null
  );

revoke update on table public.wishlist_items from authenticated;

create function public.prevent_allocated_asset_sale_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.wishlist_funding_allocations
    where asset_sale_id = old.id
  ) then
    raise exception 'sale is allocated';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger asset_sales_prevent_allocated_change
before update or delete on public.asset_sales
for each row execute function public.prevent_allocated_asset_sale_change();

create function public.fulfill_wishlist_item(
  p_wishlist_item_id uuid,
  p_actual_price numeric,
  p_allocations jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist public.wishlist_items%rowtype;
  v_allocation record;
  v_source_amount numeric;
  v_used_amount numeric;
  v_funded_amount numeric;
begin
  if p_actual_price is null
    or p_actual_price <= 0
    or p_actual_price > 9999999999.99
    or scale(p_actual_price) > 2 then
    raise exception 'invalid actual price';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'invalid allocations';
  end if;

  select *
  into v_wishlist
  from public.wishlist_items
  where id = p_wishlist_item_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'wishlist item not found';
  end if;
  if v_wishlist.fulfilled_at is not null then
    raise exception 'wishlist item already fulfilled';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type is null
      or source_type not in ('spending_resolution', 'asset_sale')
      or source_id is null
      or amount is null
      or amount <= 0
      or amount > 9999999999.99
      or scale(amount) > 2
  ) then
    raise exception 'invalid allocation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    group by source_type, source_id
    having count(*) > 1
  ) then
    raise exception 'duplicate funding source';
  end if;

  select coalesce(sum(amount), 0)
  into v_funded_amount
  from jsonb_to_recordset(p_allocations)
    as item(source_type text, source_id uuid, amount numeric);

  if v_funded_amount > p_actual_price then
    raise exception 'allocations exceed actual price';
  end if;

  perform source.id
  from public.spending_resolutions as source
  where source.id in (
    select source_id
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type = 'spending_resolution'
  )
    and source.user_id = (select auth.uid())
  order by source.id
  for update;

  perform source.id
  from public.asset_sales as source
  where source.id in (
    select source_id
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type = 'asset_sale'
  )
    and source.user_id = (select auth.uid())
  order by source.id
  for update;

  for v_allocation in
    select source_type, source_id, amount
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
  loop
    if v_allocation.source_type = 'spending_resolution' then
      select source.amount, coalesce(sum(existing.amount), 0)
      into v_source_amount, v_used_amount
      from public.spending_resolutions as source
      left join public.wishlist_funding_allocations as existing
        on existing.spending_resolution_id = source.id
      where source.id = v_allocation.source_id
        and source.user_id = (select auth.uid())
        and source.confirmed_at is not null
      group by source.id, source.amount;

      if not found then
        raise exception 'funding source not found';
      end if;

      if v_allocation.amount > v_source_amount - v_used_amount then
        raise exception 'funding balance changed';
      end if;

      insert into public.wishlist_funding_allocations (
        user_id,
        wishlist_item_id,
        spending_resolution_id,
        amount
      )
      values (
        (select auth.uid()),
        p_wishlist_item_id,
        v_allocation.source_id,
        v_allocation.amount
      );
    else
      select source.sale_price, coalesce(sum(existing.amount), 0)
      into v_source_amount, v_used_amount
      from public.asset_sales as source
      left join public.wishlist_funding_allocations as existing
        on existing.asset_sale_id = source.id
      where source.id = v_allocation.source_id
        and source.user_id = (select auth.uid())
      group by source.id, source.sale_price;

      if not found then
        raise exception 'funding source not found';
      end if;

      if v_allocation.amount > v_source_amount - v_used_amount then
        raise exception 'funding balance changed';
      end if;

      insert into public.wishlist_funding_allocations (
        user_id,
        wishlist_item_id,
        asset_sale_id,
        amount
      )
      values (
        (select auth.uid()),
        p_wishlist_item_id,
        v_allocation.source_id,
        v_allocation.amount
      );
    end if;
  end loop;

  update public.wishlist_items
  set actual_price = p_actual_price,
      fulfilled_at = now()
  where id = p_wishlist_item_id;
end;
$$;

create function public.unfulfill_wishlist_item(
  p_wishlist_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist public.wishlist_items%rowtype;
begin
  select *
  into v_wishlist
  from public.wishlist_items
  where id = p_wishlist_item_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'wishlist item not found';
  end if;
  if v_wishlist.fulfilled_at is null then
    raise exception 'wishlist item is not fulfilled';
  end if;

  delete from public.wishlist_funding_allocations
  where wishlist_item_id = p_wishlist_item_id
    and user_id = (select auth.uid());

  update public.wishlist_items
  set actual_price = null,
      fulfilled_at = null
  where id = p_wishlist_item_id;
end;
$$;

revoke all on function public.prevent_allocated_asset_sale_change()
  from public;
revoke all on function public.fulfill_wishlist_item(uuid, numeric, jsonb)
  from public;
revoke all on function public.unfulfill_wishlist_item(uuid)
  from public;

grant execute on function public.fulfill_wishlist_item(uuid, numeric, jsonb)
  to authenticated;
grant execute on function public.unfulfill_wishlist_item(uuid)
  to authenticated;
