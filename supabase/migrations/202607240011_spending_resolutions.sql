alter table public.purchase_evaluations
  add column if not exists decision text not null default 'pending';

alter table public.purchase_evaluations
  drop constraint if exists purchase_evaluations_decision_check;

alter table public.purchase_evaluations
  add constraint purchase_evaluations_decision_check
  check (decision in ('pending', 'buy', 'skip'));

create table public.spending_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null unique
    references public.purchase_evaluations(id),
  message_id uuid not null unique
    references public.evaluation_messages(id),
  amount numeric(12, 2) not null check (amount > 0),
  product_snapshot jsonb not null
    check (
      jsonb_typeof(product_snapshot) = 'object'
      and coalesce(length(trim(product_snapshot->>'title')), 0) > 0
    ),
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index spending_resolutions_user_confirmed_idx
  on public.spending_resolutions (user_id, confirmed_at);

alter table public.spending_resolutions enable row level security;

create policy spending_resolutions_owner_select
  on public.spending_resolutions
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.spending_resolutions from anon, authenticated;
grant select on table public.spending_resolutions to authenticated;

create or replace function public.save_evaluation_reply(
  p_evaluation_id uuid,
  p_content text,
  p_decision text default null,
  p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.purchase_evaluations%rowtype;
  v_message_id uuid;
begin
  if p_content is null
    or length(trim(p_content)) = 0
    or length(p_content) > 8000 then
    raise exception 'Invalid assistant message';
  end if;
  if p_decision is not null
    and p_decision not in ('buy', 'skip') then
    raise exception 'Invalid decision';
  end if;
  if p_amount is not null
    and (p_amount <= 0 or scale(p_amount) > 2) then
    raise exception 'Invalid resolution amount';
  end if;

  select *
  into v_evaluation
  from public.purchase_evaluations
  where id = p_evaluation_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Evaluation not found';
  end if;

  insert into public.evaluation_messages (
    evaluation_id, user_id, role, content
  )
  values (
    p_evaluation_id, (select auth.uid()), 'assistant', trim(p_content)
  )
  returning id into v_message_id;

  if p_decision is not null then
    update public.purchase_evaluations
    set decision = p_decision
    where id = p_evaluation_id;
  end if;

  if p_decision = 'buy' then
    delete from public.spending_resolutions
    where evaluation_id = p_evaluation_id
      and user_id = (select auth.uid())
      and confirmed_at is null;
  elsif p_decision = 'skip' and p_amount is not null then
    insert into public.spending_resolutions as existing (
      user_id,
      evaluation_id,
      message_id,
      amount,
      product_snapshot,
      image_paths
    )
    values (
      (select auth.uid()),
      p_evaluation_id,
      v_message_id,
      p_amount,
      jsonb_build_object(
        'url', v_evaluation.product_url,
        'title', v_evaluation.product_title,
        'price', v_evaluation.product_price,
        'category', v_evaluation.category,
        'subcategory', v_evaluation.subcategory,
        'source_type', v_evaluation.source_type,
        'source_text', v_evaluation.source_text
      ),
      v_evaluation.image_paths
    )
    on conflict (evaluation_id) do update
    set message_id = excluded.message_id,
        amount = excluded.amount,
        product_snapshot = excluded.product_snapshot,
        image_paths = excluded.image_paths,
        updated_at = now()
    where existing.confirmed_at is null;
  end if;

  return v_message_id;
end;
$$;

create or replace function public.confirm_spending_resolution(
  p_resolution_id uuid
)
returns setof public.spending_resolutions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.spending_resolutions
  set confirmed_at = now(),
      updated_at = now()
  where id = p_resolution_id
    and user_id = (select auth.uid())
    and confirmed_at is null
  returning *;

  if not found then
    return query
    select *
    from public.spending_resolutions
    where id = p_resolution_id
      and user_id = (select auth.uid())
      and confirmed_at is not null;
  end if;
end;
$$;

revoke all on function public.save_evaluation_reply(
  uuid, text, text, numeric
) from public;
revoke all on function public.confirm_spending_resolution(uuid) from public;
grant execute on function public.save_evaluation_reply(
  uuid, text, text, numeric
) to authenticated;
grant execute on function public.confirm_spending_resolution(uuid)
  to authenticated;
