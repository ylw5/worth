-- Unify chat history onto agent_threads / agent_messages.
-- Evaluations attach via purchase_evaluations.thread_id (many per thread).
-- Stop writing evaluation_messages from save_evaluation_reply; keep the table.

-- 1) Allow multiple free-form threads; stop requiring thread.evaluation_id
-- Constraint names from 202607250003_general_agent_chat.sql:
--   kind column check → agent_threads_kind_check
--   kind/evaluation_id pairing table check → agent_threads_check
alter table public.agent_threads
  drop constraint if exists agent_threads_kind_check;

alter table public.agent_threads
  drop constraint if exists agent_threads_check;

-- Keep kind values for readability; both kinds may have null evaluation_id
alter table public.agent_threads
  add constraint agent_threads_kind_check
  check (kind in ('general', 'purchase_evaluation'));

alter table public.agent_threads
  alter column evaluation_id drop not null;

-- Clear unused thread-level evaluation pointer (multi-eval lives on purchase_evaluations)
update public.agent_threads set evaluation_id = null;

-- 2) Evaluations belong to a thread
alter table public.purchase_evaluations
  add column if not exists thread_id uuid
    references public.agent_threads(id) on delete cascade;

create index if not exists purchase_evaluations_thread_updated_idx
  on public.purchase_evaluations (thread_id, updated_at desc);

-- 3) Detach spending_resolutions.message_id from evaluation_messages
-- FK name from 202607240011_spending_resolutions.sql inline REFERENCES
alter table public.spending_resolutions
  drop constraint if exists spending_resolutions_message_id_fkey;

-- 4) Backfill: one thread per existing evaluation + migrate messages
do $$
declare
  r record;
  m record;
  v_thread_id uuid;
  v_new_msg_id uuid;
  v_key text;
begin
  for r in
    select *
    from public.purchase_evaluations
    where thread_id is null
    order by created_at
  loop
    v_key := 'eval:' || r.id::text;

    -- Safer than ON CONFLICT DO UPDATE … RETURNING: conflict yields no row.
    insert into public.agent_threads (
      user_id, thread_key, kind, title, created_at, updated_at
    )
    values (
      r.user_id,
      v_key,
      'general',
      coalesce(nullif(trim(r.product_title), ''), '聊天'),
      r.created_at,
      coalesce(r.updated_at, r.created_at)
    )
    on conflict (user_id, thread_key) do nothing;

    select id into v_thread_id
    from public.agent_threads
    where user_id = r.user_id and thread_key = v_key;

    if v_thread_id is null then
      raise exception 'Failed to resolve agent_threads row for %', v_key;
    end if;

    update public.purchase_evaluations
    set thread_id = v_thread_id
    where id = r.id;

    for m in
      select *
      from public.evaluation_messages
      where evaluation_id = r.id
      order by created_at
    loop
      insert into public.agent_messages (
        thread_id, user_id, role, content, route_result, created_at
      )
      values (
        v_thread_id,
        m.user_id,
        m.role,
        m.content,
        jsonb_build_object(
          'evaluation_id', r.id,
          'migrated_from_evaluation_message_id', m.id
        ),
        m.created_at
      )
      returning id into v_new_msg_id;

      update public.spending_resolutions
      set message_id = v_new_msg_id
      where evaluation_id = r.id
        and message_id = m.id;
    end loop;
  end loop;
end $$;

-- Evaluations with no messages still need a thread (loop above covers all null thread_id)
-- Enforce NOT NULL for new rows
alter table public.purchase_evaluations
  alter column thread_id set not null;

-- 5) Point message_id FK at agent_messages
alter table public.spending_resolutions
  add constraint spending_resolutions_message_id_fkey
  foreign key (message_id) references public.agent_messages(id);

-- 6) Rewrite save_evaluation_reply to write agent_messages
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

  if v_evaluation.thread_id is null then
    raise exception 'Evaluation has no thread';
  end if;

  insert into public.agent_messages (
    thread_id, user_id, role, content, route_result
  )
  values (
    v_evaluation.thread_id,
    (select auth.uid()),
    'assistant',
    trim(p_content),
    jsonb_build_object('evaluation_id', p_evaluation_id)
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
