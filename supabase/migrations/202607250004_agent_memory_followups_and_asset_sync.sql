-- Makes cross-conversation memory user-manageable, links unambiguous new
-- assets to purchase evaluations, mirrors asset lifecycle outcomes, and
-- schedules lightweight follow-up reminders.

create table public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  memory_type text not null default 'purchase_episode'
    check (memory_type in ('purchase_episode', 'preference', 'pattern')),
  summary text not null check (
    length(trim(summary)) > 0 and length(summary) <= 2000
  ),
  facts jsonb not null default '{}'::jsonb,
  source_evaluation_id uuid
    references public.purchase_evaluations(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_evaluation_id)
);

create index agent_memories_user_active_updated_idx
  on public.agent_memories (user_id, is_active, updated_at desc);

alter table public.agent_memories enable row level security;

create policy agent_memories_owner on public.agent_memories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      source_evaluation_id is null
      or exists (
        select 1
        from public.purchase_evaluations
        where purchase_evaluations.id = source_evaluation_id
          and purchase_evaluations.user_id = (select auth.uid())
      )
    )
  );

create table public.agent_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  evaluation_id uuid not null
    references public.purchase_evaluations(id) on delete cascade,
  kind text not null
    check (kind in ('decision_checkin', 'usage_checkin')),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'dismissed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, kind)
);

create index agent_followups_user_status_due_idx
  on public.agent_followups (user_id, status, due_at);

alter table public.agent_followups enable row level security;

create policy agent_followups_owner on public.agent_followups
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
  );

create or replace function public.sync_purchase_evaluation_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agent_memories (
    user_id,
    memory_type,
    summary,
    facts,
    source_evaluation_id,
    updated_at
  )
  values (
    new.user_id,
    'purchase_episode',
    format(
      '曾聊过「%s」；用户选择：%s；后续：%s',
      new.product_title,
      new.user_choice,
      new.outcome_status
    ),
    jsonb_build_object(
      'id', new.id,
      'product_title', new.product_title,
      'product_price', new.product_price,
      'category', new.category,
      'subcategory', new.subcategory,
      'user_choice', new.user_choice,
      'outcome_status', new.outcome_status,
      'linked_asset_id', new.linked_asset_id,
      'created_at', new.created_at
    ),
    new.id,
    now()
  )
  on conflict (source_evaluation_id) do update
  set
    summary = excluded.summary,
    facts = excluded.facts,
    updated_at = now();
  return new;
end;
$$;

create trigger purchase_evaluations_sync_agent_memory
after insert or update of
  product_title,
  product_price,
  category,
  subcategory,
  user_choice,
  outcome_status,
  linked_asset_id
on public.purchase_evaluations
for each row execute function public.sync_purchase_evaluation_memory();

insert into public.agent_memories (
  user_id,
  memory_type,
  summary,
  facts,
  source_evaluation_id,
  created_at,
  updated_at
)
select
  evaluation.user_id,
  'purchase_episode',
  format(
    '曾聊过「%s」；用户选择：%s；后续：%s',
    evaluation.product_title,
    evaluation.user_choice,
    evaluation.outcome_status
  ),
  jsonb_build_object(
    'id', evaluation.id,
    'product_title', evaluation.product_title,
    'product_price', evaluation.product_price,
    'category', evaluation.category,
    'subcategory', evaluation.subcategory,
    'user_choice', evaluation.user_choice,
    'outcome_status', evaluation.outcome_status,
    'linked_asset_id', evaluation.linked_asset_id,
    'created_at', evaluation.created_at
  ),
  evaluation.id,
  evaluation.created_at,
  now()
from public.purchase_evaluations as evaluation
on conflict (source_evaluation_id) do nothing;

create or replace function public.sync_purchase_followup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_choice = 'buy'
    and new.outcome_status not in ('idle', 'listed', 'returned', 'sold')
  then
    insert into public.agent_followups (
      user_id,
      evaluation_id,
      kind,
      due_at
    )
    values (
      new.user_id,
      new.id,
      'usage_checkin',
      coalesce(new.user_choice_at, now()) + interval '30 days'
    )
    on conflict (evaluation_id, kind) do update
    set
      due_at = excluded.due_at,
      status = case
        when public.agent_followups.status = 'dismissed'
          then public.agent_followups.status
        else 'pending'
      end,
      completed_at = null,
      updated_at = now();
  elsif new.user_choice = 'postponed' then
    insert into public.agent_followups (
      user_id,
      evaluation_id,
      kind,
      due_at
    )
    values (
      new.user_id,
      new.id,
      'decision_checkin',
      coalesce(new.user_choice_at, now()) + interval '7 days'
    )
    on conflict (evaluation_id, kind) do update
    set
      due_at = excluded.due_at,
      status = case
        when public.agent_followups.status = 'dismissed'
          then public.agent_followups.status
        else 'pending'
      end,
      completed_at = null,
      updated_at = now();
  end if;

  if new.user_choice in ('buy', 'skip') then
    update public.agent_followups
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where evaluation_id = new.id
      and kind = 'decision_checkin'
      and status = 'pending';
  end if;

  if new.outcome_status in ('idle', 'listed', 'returned', 'sold')
    or new.user_choice = 'skip'
  then
    update public.agent_followups
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where evaluation_id = new.id
      and kind = 'usage_checkin'
      and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger purchase_evaluations_sync_followup
after insert or update of user_choice, outcome_status, user_choice_at
on public.purchase_evaluations
for each row execute function public.sync_purchase_followup();

insert into public.agent_followups (
  user_id,
  evaluation_id,
  kind,
  due_at
)
select
  user_id,
  id,
  case
    when user_choice = 'postponed' then 'decision_checkin'
    else 'usage_checkin'
  end,
  coalesce(user_choice_at, created_at) + case
    when user_choice = 'postponed' then interval '7 days'
    else interval '30 days'
  end
from public.purchase_evaluations
where
  user_choice = 'postponed'
  or (
    user_choice = 'buy'
    and outcome_status not in ('idle', 'listed', 'returned', 'sold')
  )
on conflict (evaluation_id, kind) do nothing;

create or replace function public.sync_linked_asset_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_ids uuid[];
  evaluation_record record;
  mapped_outcome text;
begin
  mapped_outcome := case new.status
    when 'in_use' then 'in_use'
    when 'idle' then 'idle'
    when 'listed' then 'listed'
    when 'sold' then 'sold'
    else 'unknown'
  end;

  if tg_op = 'INSERT' and length(trim(new.subcategory)) > 0 then
    select array_agg(id order by created_at desc)
    into candidate_ids
    from public.purchase_evaluations
    where user_id = new.user_id
      and linked_asset_id is null
      and user_choice = 'buy'
      and subcategory = new.subcategory
      and created_at >= now() - interval '90 days'
      and (
        new.purchase_date is null
        or new.purchase_date >= created_at::date - 7
      );

    if cardinality(candidate_ids) = 1 then
      select outcome_status
      into evaluation_record
      from public.purchase_evaluations
      where id = candidate_ids[1]
        and linked_asset_id is null
      for update;

      if not found then
        return new;
      end if;

      update public.purchase_evaluations
      set
        linked_asset_id = new.id,
        outcome_status = mapped_outcome,
        outcome_updated_at = now(),
        updated_at = now()
      where id = candidate_ids[1]
        and user_id = new.user_id
        and linked_asset_id is null;

      insert into public.purchase_outcome_events (
        evaluation_id,
        user_id,
        event_type,
        asset_id,
        source
      )
      values (
        candidate_ids[1],
        new.user_id,
        'asset_linked',
        new.id,
        'asset'
      );

      if evaluation_record.outcome_status is distinct from mapped_outcome then
        insert into public.purchase_outcome_events (
          evaluation_id,
          user_id,
          event_type,
          asset_id,
          source
        )
        values (
          candidate_ids[1],
          new.user_id,
          mapped_outcome,
          new.id,
          'asset'
        );
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    select id, outcome_status
    into evaluation_record
    from public.purchase_evaluations
    where linked_asset_id = new.id
      and user_id = new.user_id
    for update;

    if found and evaluation_record.outcome_status is distinct from mapped_outcome then
      update public.purchase_evaluations
      set
        outcome_status = mapped_outcome,
        outcome_updated_at = now(),
        updated_at = now()
      where id = evaluation_record.id;

      insert into public.purchase_outcome_events (
        evaluation_id,
        user_id,
        event_type,
        asset_id,
        source
      )
      values (
        evaluation_record.id,
        new.user_id,
        mapped_outcome,
        new.id,
        'asset'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger assets_sync_purchase_outcome
after insert or update of status on public.assets
for each row execute function public.sync_linked_asset_outcome();

create or replace function public.set_agent_memory_active(
  p_memory_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.agent_memories
  set is_active = p_is_active, updated_at = now()
  where id = p_memory_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'memory not found';
  end if;
end;
$$;

create or replace function public.update_agent_followup(
  p_followup_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('completed', 'dismissed') then
    raise exception 'invalid followup status';
  end if;

  update public.agent_followups
  set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() else null end,
    updated_at = now()
  where id = p_followup_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'followup not found';
  end if;
end;
$$;

create or replace function public.complete_evaluation_followup(
  p_evaluation_id uuid,
  p_kind text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_kind not in ('decision_checkin', 'usage_checkin') then
    raise exception 'invalid followup kind';
  end if;

  update public.agent_followups
  set
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  where evaluation_id = p_evaluation_id
    and user_id = (select auth.uid())
    and kind = p_kind
    and status = 'pending';
end;
$$;

grant execute on function public.set_agent_memory_active(uuid, boolean)
  to authenticated;
grant execute on function public.update_agent_followup(uuid, text)
  to authenticated;
grant execute on function public.complete_evaluation_followup(uuid, text)
  to authenticated;

revoke all on function public.sync_purchase_evaluation_memory() from public;
revoke all on function public.sync_purchase_followup() from public;
revoke all on function public.sync_linked_asset_outcome() from public;
