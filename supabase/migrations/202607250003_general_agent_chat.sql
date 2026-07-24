-- Adds one persistent free-chat thread per user. Purchase-evaluation threads
-- continue using evaluation_messages until the unified thread migration.
create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  thread_key text not null default 'general'
    check (length(trim(thread_key)) > 0),
  kind text not null default 'general'
    check (kind in ('general', 'purchase_evaluation')),
  evaluation_id uuid
    references public.purchase_evaluations(id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_key),
  check (
    (kind = 'general' and evaluation_id is null)
    or (kind = 'purchase_evaluation' and evaluation_id is not null)
  )
);

create index agent_threads_user_updated_idx
  on public.agent_threads (user_id, updated_at desc);

alter table public.agent_threads enable row level security;

create policy agent_threads_owner on public.agent_threads
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      evaluation_id is null
      or exists (
        select 1
        from public.purchase_evaluations
        where purchase_evaluations.id = evaluation_id
          and purchase_evaluations.user_id = (select auth.uid())
      )
    )
  );

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null
    references public.agent_threads(id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (
    length(trim(content)) > 0 and length(content) <= 8000
  ),
  route_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agent_messages_thread_created_idx
  on public.agent_messages (thread_id, created_at);

alter table public.agent_messages enable row level security;

create policy agent_messages_owner on public.agent_messages
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_threads
      where agent_threads.id = thread_id
        and agent_threads.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_threads
      where agent_threads.id = thread_id
        and agent_threads.user_id = (select auth.uid())
    )
  );

create or replace function public.touch_agent_thread_from_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.agent_threads
  set updated_at = now()
  where id = new.thread_id
    and user_id = (select auth.uid());
  return new;
end;
$$;

create trigger agent_messages_touch_parent
after insert on public.agent_messages
for each row execute function public.touch_agent_thread_from_message();
