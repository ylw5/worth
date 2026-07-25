-- Confirming "忍住消费" is also the user's real purchase outcome.
create or replace function public.confirm_spending_resolution(
  p_resolution_id uuid
)
returns setof public.spending_resolutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution public.spending_resolutions%rowtype;
begin
  select *
  into v_resolution
  from public.spending_resolutions
  where id = p_resolution_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    return;
  end if;

  if v_resolution.confirmed_at is null then
    update public.spending_resolutions
    set confirmed_at = now(),
        updated_at = now()
    where id = p_resolution_id
    returning * into v_resolution;

    perform public.record_purchase_outcome(
      v_resolution.evaluation_id,
      'skip',
      'not_bought',
      null,
      ''
    );
  end if;

  return next v_resolution;
end;
$$;

-- Bring earlier confirmations into the existing purchase-memory trigger path.
update public.purchase_evaluations as evaluation
set
  user_choice = 'skip',
  outcome_status = 'not_bought',
  user_choice_at = resolution.confirmed_at,
  outcome_updated_at = resolution.confirmed_at,
  updated_at = greatest(evaluation.updated_at, resolution.confirmed_at)
from public.spending_resolutions as resolution
where resolution.evaluation_id = evaluation.id
  and resolution.confirmed_at is not null
  and evaluation.user_choice = 'pending'
  and evaluation.outcome_status = 'unknown';
