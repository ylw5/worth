-- Adds a decision column so evaluations can end with a clear buy / skip conclusion.
alter table public.purchase_evaluations
add column decision text not null default 'pending'
  check (decision in ('pending', 'buy', 'skip'));
