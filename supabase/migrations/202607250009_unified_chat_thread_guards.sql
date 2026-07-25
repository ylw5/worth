-- Guard purchase_evaluations.thread_id ownership and delete behavior.
-- Follow-up to 202607250008_unified_chat_threads.sql (do not rewrite 008).

-- 1) Prevent deleting a thread that still has evaluations attached
alter table public.purchase_evaluations
  drop constraint if exists purchase_evaluations_thread_id_fkey;

alter table public.purchase_evaluations
  add constraint purchase_evaluations_thread_id_fkey
  foreign key (thread_id)
  references public.agent_threads(id)
  on delete restrict;

-- 2) RLS: thread_id must belong to the same auth.uid()
-- Mirrors agent_threads_owner evaluation_id ownership check in 202607250003.
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
    and exists (
      select 1
      from public.agent_threads
      where agent_threads.id = thread_id
        and agent_threads.user_id = (select auth.uid())
    )
  );

-- 3) Belt-and-suspenders: save_evaluation_reply verifies thread ownership
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

  if not exists (
    select 1
    from public.agent_threads
    where id = v_evaluation.thread_id
      and user_id = (select auth.uid())
  ) then
    raise exception 'Evaluation thread not found';
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
