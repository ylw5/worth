create or replace function public.is_valid_evaluation_execution_trace(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_item jsonb;
  v_step numeric;
  v_duration numeric;
  v_call_ids text[] := '{}';
begin
  if jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_value) > 12
    or octet_length(p_value::text) > 16000 then
    return false;
  end if;

  for v_item in
    select item
    from jsonb_array_elements(p_value) as entries(item)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if (
      select count(*)
      from jsonb_object_keys(v_item)
    ) <> 5 then
      return false;
    end if;
    if coalesce(jsonb_typeof(v_item->'call_id'), '') <> 'string'
      or length(v_item->>'call_id') not between 1 and 256
      or coalesce(jsonb_typeof(v_item->'step'), '') <> 'number'
      or coalesce(jsonb_typeof(v_item->'tool'), '') <> 'string'
      or (v_item->>'tool') !~ '^[A-Za-z0-9_-]{1,64}$'
      or coalesce(jsonb_typeof(v_item->'status'), '') <> 'string'
      or (v_item->>'status') not in ('success', 'error')
      or coalesce(jsonb_typeof(v_item->'duration_ms'), '') <> 'number'
    then
      return false;
    end if;

    v_step := (v_item->>'step')::numeric;
    v_duration := (v_item->>'duration_ms')::numeric;
    if (v_item->>'call_id') = any(v_call_ids) then
      return false;
    end if;
    v_call_ids := array_append(v_call_ids, v_item->>'call_id');
    if v_step <> trunc(v_step)
      or v_step not between 0 and 20
      or v_duration <> trunc(v_duration)
      or v_duration not between 0 and 3600000 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.is_valid_evaluation_execution_trace(jsonb)
  from anon, authenticated, service_role, public;
grant execute on function public.is_valid_evaluation_execution_trace(jsonb)
  to authenticated, service_role;

alter table public.evaluation_messages
  add column if not exists execution_trace jsonb
  not null default '[]'::jsonb;

alter table public.evaluation_messages
  drop constraint if exists evaluation_messages_execution_trace_check;

alter table public.evaluation_messages
  add constraint evaluation_messages_execution_trace_check
  check (
    public.is_valid_evaluation_execution_trace(execution_trace)
  );

alter function public.save_evaluation_reply(
  uuid, text, text, numeric
) rename to save_evaluation_reply_base;

revoke all on function public.save_evaluation_reply_base(
  uuid, text, text, numeric
) from anon, authenticated, service_role, public;

create function public.save_evaluation_reply(
  p_evaluation_id uuid,
  p_content text,
  p_decision text default null,
  p_amount numeric default null,
  p_execution_trace jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_execution_trace jsonb;
  v_updated_count integer := 0;
begin
  v_execution_trace := coalesce(
    p_execution_trace,
    '[]'::jsonb
  );
  if not public.is_valid_evaluation_execution_trace(
    v_execution_trace
  ) then
    raise exception 'Invalid execution trace';
  end if;

  v_message_id := public.save_evaluation_reply_base(
    p_evaluation_id,
    p_content,
    p_decision,
    p_amount
  );

  update public.evaluation_messages
  set execution_trace = v_execution_trace
  where id = v_message_id
    and user_id = (select auth.uid());
  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    update public.agent_messages
    set route_result = (
      case
        when jsonb_typeof(route_result) = 'object' then route_result
        else '{}'::jsonb
      end
    ) || jsonb_build_object(
      'execution_trace',
      v_execution_trace
    )
    where id = v_message_id
      and user_id = (select auth.uid());
    get diagnostics v_updated_count = row_count;
  end if;

  if v_updated_count <> 1 then
    raise exception 'Saved assistant message not found';
  end if;

  return v_message_id;
end;
$$;

revoke all on function public.save_evaluation_reply(
  uuid, text, text, numeric, jsonb
) from anon, authenticated, service_role, public;

grant execute on function public.save_evaluation_reply(
  uuid, text, text, numeric, jsonb
) to authenticated;
