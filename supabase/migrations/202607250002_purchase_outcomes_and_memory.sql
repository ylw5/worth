-- Separates the assistant recommendation from the user's real choice and
-- records how a purchased item turns out over time.
alter table public.purchase_evaluations
add column user_choice text not null default 'pending'
  check (user_choice in ('pending', 'buy', 'skip', 'postponed')),
add column outcome_status text not null default 'unknown'
  check (
    outcome_status in (
      'unknown',
      'not_bought',
      'in_use',
      'idle',
      'listed',
      'returned',
      'sold'
    )
  ),
add column linked_asset_id uuid
  references public.assets(id) on delete set null,
add column user_choice_at timestamptz,
add column outcome_updated_at timestamptz;

create unique index purchase_evaluations_linked_asset_idx
  on public.purchase_evaluations (linked_asset_id)
  where linked_asset_id is not null;

drop policy if exists purchase_evaluations_owner
  on public.purchase_evaluations;

create policy purchase_evaluations_owner on public.purchase_evaluations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      linked_asset_id is null
      or exists (
        select 1
        from public.assets
        where assets.id = linked_asset_id
          and assets.user_id = (select auth.uid())
      )
    )
  );

create table public.purchase_outcome_events (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null
    references public.purchase_evaluations(id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'choice_buy',
      'choice_skip',
      'choice_postponed',
      'choice_reset',
      'outcome_unknown',
      'not_bought',
      'in_use',
      'idle',
      'listed',
      'returned',
      'sold',
      'asset_linked',
      'asset_unlinked'
    )
  ),
  asset_id uuid references public.assets(id) on delete set null,
  note text not null default '' check (length(note) <= 2000),
  source text not null default 'user'
    check (source in ('user', 'asset', 'system')),
  occurred_at timestamptz not null default now()
);

create index purchase_outcome_events_evaluation_created_idx
  on public.purchase_outcome_events (evaluation_id, occurred_at desc);

create index purchase_outcome_events_user_created_idx
  on public.purchase_outcome_events (user_id, occurred_at desc);

alter table public.purchase_outcome_events enable row level security;

create policy purchase_outcome_events_owner
  on public.purchase_outcome_events
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.purchase_evaluations
      where purchase_evaluations.id = evaluation_id
        and purchase_evaluations.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.purchase_evaluations
      where purchase_evaluations.id = evaluation_id
        and purchase_evaluations.user_id = (select auth.uid())
    )
    and (
      asset_id is null
      or exists (
        select 1
        from public.assets
        where assets.id = asset_id
          and assets.user_id = (select auth.uid())
      )
    )
  );

create or replace function public.record_purchase_outcome(
  p_evaluation_id uuid,
  p_user_choice text,
  p_outcome_status text,
  p_linked_asset_id uuid default null,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous record;
begin
  if p_user_choice not in ('pending', 'buy', 'skip', 'postponed') then
    raise exception 'invalid user choice';
  end if;

  if p_outcome_status not in (
    'unknown',
    'not_bought',
    'in_use',
    'idle',
    'listed',
    'returned',
    'sold'
  ) then
    raise exception 'invalid outcome status';
  end if;

  if length(p_note) > 2000 then
    raise exception 'note is too long';
  end if;

  select
    user_choice,
    outcome_status,
    linked_asset_id
  into previous
  from public.purchase_evaluations
  where id = p_evaluation_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'evaluation not found';
  end if;

  if p_linked_asset_id is not null and not exists (
    select 1
    from public.assets
    where id = p_linked_asset_id
      and user_id = (select auth.uid())
  ) then
    raise exception 'asset not found';
  end if;

  update public.purchase_evaluations
  set
    user_choice = p_user_choice,
    outcome_status = p_outcome_status,
    linked_asset_id = p_linked_asset_id,
    user_choice_at = case
      when user_choice is distinct from p_user_choice then now()
      else user_choice_at
    end,
    outcome_updated_at = case
      when outcome_status is distinct from p_outcome_status
        or linked_asset_id is distinct from p_linked_asset_id
      then now()
      else outcome_updated_at
    end,
    updated_at = now()
  where id = p_evaluation_id
    and user_id = (select auth.uid());

  if previous.user_choice is distinct from p_user_choice then
    insert into public.purchase_outcome_events (
      evaluation_id,
      user_id,
      event_type,
      asset_id,
      note
    )
    values (
      p_evaluation_id,
      (select auth.uid()),
      case p_user_choice
        when 'buy' then 'choice_buy'
        when 'skip' then 'choice_skip'
        when 'postponed' then 'choice_postponed'
        else 'choice_reset'
      end,
      p_linked_asset_id,
      p_note
    );
  end if;

  if previous.outcome_status is distinct from p_outcome_status then
    insert into public.purchase_outcome_events (
      evaluation_id,
      user_id,
      event_type,
      asset_id,
      note
    )
    values (
      p_evaluation_id,
      (select auth.uid()),
      case p_outcome_status
        when 'unknown' then 'outcome_unknown'
        else p_outcome_status
      end,
      p_linked_asset_id,
      p_note
    );
  end if;

  if previous.linked_asset_id is distinct from p_linked_asset_id then
    insert into public.purchase_outcome_events (
      evaluation_id,
      user_id,
      event_type,
      asset_id,
      note
    )
    values (
      p_evaluation_id,
      (select auth.uid()),
      case
        when p_linked_asset_id is null then 'asset_unlinked'
        else 'asset_linked'
      end,
      coalesce(p_linked_asset_id, previous.linked_asset_id),
      p_note
    );
  end if;
end;
$$;

grant execute on function public.record_purchase_outcome(
  uuid, text, text, uuid, text
) to authenticated;
