-- Expands shopping evaluation to text/image sources and persistent chat.
alter table public.purchase_evaluations
drop constraint if exists purchase_evaluations_product_url_check;

alter table public.purchase_evaluations
alter column product_url set default '',
add column source_type text not null default 'url'
  check (source_type in ('url', 'text', 'image')),
add column source_text text not null default '',
add column image_paths text[] not null default '{}'::text[],
add column updated_at timestamptz not null default now();

alter table public.purchase_evaluations
add constraint purchase_evaluations_source_payload_check
check (
  (source_type = 'url' and length(trim(product_url)) > 0)
  or (source_type = 'text' and length(trim(source_text)) > 0)
  or (source_type = 'image' and cardinality(image_paths) between 1 and 5)
);

create table public.evaluation_messages (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null
    references public.purchase_evaluations(id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (
    length(trim(content)) > 0 and length(content) <= 8000
  ),
  created_at timestamptz not null default now()
);

create index evaluation_messages_evaluation_created_idx
  on public.evaluation_messages (evaluation_id, created_at);

alter table public.evaluation_messages enable row level security;

create policy evaluation_messages_owner on public.evaluation_messages
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

create or replace function public.touch_evaluation_from_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.purchase_evaluations
  set updated_at = now()
  where id = new.evaluation_id
    and user_id = (select auth.uid());
  return new;
end;
$$;

create trigger evaluation_messages_touch_parent
after insert on public.evaluation_messages
for each row execute function public.touch_evaluation_from_message();
