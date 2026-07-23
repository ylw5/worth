create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  target_price numeric(12, 2) not null check (target_price > 0),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index wishlist_items_user_created_idx
  on public.wishlist_items (user_id, created_at desc);

alter table public.wishlist_items enable row level security;

create policy wishlist_items_owner on public.wishlist_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
