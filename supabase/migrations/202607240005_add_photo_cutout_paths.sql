alter table public.assets
add column photo_cutout_paths jsonb not null default '{}'::jsonb;
