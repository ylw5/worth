-- 第 5/5 步：导入卖出方案和资金分配，并校验结果
begin;

do $$
declare v_user_id uuid;
begin
  select id into v_user_id from auth.users
  where lower(email) = lower('admin@worth.local') limit 1;
  if v_user_id is null then raise exception '未找到账号 admin@worth.local'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

insert into public.sell_plan_snapshots (
  id, user_id, wishlist_item_id, plan_date,
  target_price, estimated_total, coverage_ratio, is_reachable,
  items, refresh_failures, input_fingerprint,
  readiness_counts, calculation_version, valuation_as_of, explanation
) values (
  '60000000-0000-0000-0000-000000000001',
  auth.uid(),
  '20000000-0000-0000-0000-000000000001',
  '2026-07-25',
  4800,
  5500,
  1.1458,
  true,
  '[
    {"asset_id":"10000000-0000-0000-0000-000000000001","name":"AirPods Pro 2","valuation":1200,"status":"idle","status_confirmed":true},
    {"asset_id":"10000000-0000-0000-0000-000000000003","name":"戴森 V15 吸尘器","valuation":2800,"status":"in_use","status_confirmed":false,"note":"需要先将状态改为闲置/准备出售"},
    {"asset_id":"10000000-0000-0000-0000-000000000004","name":"北弧电动升降桌","valuation":1500,"status":"idle","status_confirmed":true}
  ]',
  0,
  'ipad-air-m2-2026-07-25-v1',
  '{"confirmed":2,"unconfirmed":1,"total":3}',
  'sell-plan-v2',
  '2026-07-25T08:00:00Z',
  '{"strategy":"minimal_items","description":"选择较少资产覆盖目标价，保留高使用频率资产","unreachable_reason":null}'
);

insert into public.wishlist_funding_allocations (
  id, user_id, wishlist_item_id,
  spending_resolution_id, asset_sale_id, amount
) values
(
  '80000000-0000-0000-0000-000000000001',
  auth.uid(),
  '20000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000001',
  null,
  3999
),
(
  '80000000-0000-0000-0000-000000000002',
  auth.uid(),
  '20000000-0000-0000-0000-000000000002',
  null,
  '40000000-0000-0000-0000-000000000001',
  5200
);

do $$
begin
  if (
    select count(*)
    from public.assets
    where user_id = auth.uid()
      and id between
        '10000000-0000-0000-0000-000000000001'::uuid
        and '10000000-0000-0000-0000-000000000006'::uuid
  ) <> 6 then
    raise exception '资产演示数据校验失败';
  end if;

  if exists (
    select 1
    from public.assets
    where user_id = auth.uid()
      and regexp_replace(lower(trim(name)), '\s+', '', 'g') in (
        '智能手机', '讯飞ai会议耳机', '可折叠墨镜'
      )
  ) then
    raise exception '指定的三项旧资产仍然存在';
  end if;
end;
$$;

commit;

with target_user as (
  select id from auth.users
  where lower(email) = lower('admin@worth.local')
  limit 1
)
select *
from (
  select 'Assets' as table_name, count(*) as count
  from public.assets where user_id = (select id from target_user)
  union all
  select 'Valuations', count(*) from public.valuations
  where user_id = (select id from target_user)
  union all
  select 'Asset Sales', count(*) from public.asset_sales
  where user_id = (select id from target_user)
  union all
  select 'Wishlist Items', count(*) from public.wishlist_items
  where user_id = (select id from target_user)
  union all
  select 'Purchase Evaluations', count(*) from public.purchase_evaluations
  where user_id = (select id from target_user)
  union all
  select 'Spending Resolutions', count(*) from public.spending_resolutions
  where user_id = (select id from target_user)
  union all
  select 'Purchase Outcome Events', count(*) from public.purchase_outcome_events
  where user_id = (select id from target_user)
  union all
  select 'Sell Plan Snapshots', count(*) from public.sell_plan_snapshots
  where user_id = (select id from target_user)
  union all
  select 'Wishlist Allocations', count(*)
  from public.wishlist_funding_allocations
  where user_id = (select id from target_user)
  union all
  select 'Agent Threads', count(*) from public.agent_threads
  where user_id = (select id from target_user)
  union all
  select 'Agent Messages', count(*) from public.agent_messages
  where user_id = (select id from target_user)
) as result
order by table_name;
