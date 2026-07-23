alter table public.assets
rename column photo_path to photo_paths;

alter table public.assets
alter column photo_paths type text[]
using array[photo_paths];

alter table public.assets
add constraint assets_photo_paths_count
check (cardinality(photo_paths) between 1 and 5);
