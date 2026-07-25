-- 第 3/5 步：导入心愿单、聊天线程和购买评估
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

insert into public.wishlist_items (
  id, user_id, name, target_price, notes,
  price_source_url, price_checked_at
) values
(
  '20000000-0000-0000-0000-000000000001', auth.uid(),
  'iPad Air M2', 4800, '用来画画和记笔记，等教育优惠',
  'https://www.apple.com/cn/shop/buy-ipad/ipad-air',
  '2026-07-22T14:00:00Z'
),
(
  '20000000-0000-0000-0000-000000000002', auth.uid(),
  '徕卡 Q3', 35000,
  '全画幅便携相机，旅游用。需要组合资金（忍住消费 + 卖闲置）',
  'https://www.leica-camera.cn/',
  '2026-07-22T14:30:00Z'
);

-- 保留账号已有的 general 线程，没有时才创建。
insert into public.agent_threads (
  user_id, thread_key, kind, evaluation_id, title, created_at, updated_at
) values (
  auth.uid(), 'general', 'general', null, '',
  '2026-07-24T09:00:00Z', '2026-07-24T09:00:05Z'
)
on conflict (user_id, thread_key) do nothing;

insert into public.agent_threads (
  id, user_id, thread_key, kind, evaluation_id, title,
  created_at, updated_at
) values
(
  '70000000-0000-0000-0000-000000000002', auth.uid(),
  'demo:airpods-max', 'general', null, 'AirPods Max 购买评估',
  '2026-07-22T16:29:00Z', '2026-07-22T16:30:05Z'
),
(
  '70000000-0000-0000-0000-000000000003', auth.uid(),
  'demo:apple-watch-ultra-2', 'general', null,
  'Apple Watch Ultra 2 购买评估',
  '2026-07-23T10:14:00Z', '2026-07-23T10:15:05Z'
);

insert into public.purchase_evaluations (
  id, user_id, thread_id,
  product_url, product_title, product_price,
  category, subcategory, source_type, source_text, image_paths,
  matched_assets, facts, narrative, parser_snapshot,
  decision, user_choice, outcome_status, linked_asset_id,
  user_choice_at, outcome_updated_at, created_at, updated_at
) values
(
  '30000000-0000-0000-0000-000000000001',
  auth.uid(),
  '70000000-0000-0000-0000-000000000002',
  '', 'AirPods Max 头戴式耳机', 3999,
  '数码', '耳机', 'text',
  'Apple AirPods Max 头戴式耳机 价格 3999 元',
  array[]::text[],
  '[{"id":"10000000-0000-0000-0000-000000000006","name":"索尼 WH-1000XM5","brand":"Sony","model":"WH-1000XM5","category":"数码","subcategory":"耳机","status":"in_use"}]',
  '{"total":6,"in_use":3,"idle":2,"listed":0,"sold":1}',
  '你目前拥有索尼 WH-1000XM5 头戴式降噪耳机（购入价 ¥2,499，目前使用中，二手参考价 ¥1,800）。AirPods Max 与它同属头戴式降噪耳机品类，用途高度重叠。建议考虑是否真的需要第二副头戴式耳机。[decision:skip]',
  '{"product":{"url":"","title":"AirPods Max 头戴式耳机","price":3999,"category":"数码","subcategory":"耳机","source_type":"text","source_text":"Apple AirPods Max 头戴式耳机 价格 3999 元"}}',
  'skip', 'skip', 'not_bought', null,
  '2026-07-22T16:30:05Z', '2026-07-22T16:30:05Z',
  '2026-07-22T16:29:00Z', '2026-07-22T16:30:05Z'
),
(
  '30000000-0000-0000-0000-000000000002',
  auth.uid(),
  '70000000-0000-0000-0000-000000000003',
  '', 'Apple Watch Ultra 2', 5999,
  '数码', '穿戴设备', 'text',
  'Apple Watch Ultra 2 智能手表 GPS 版 价格 5999 元',
  array[]::text[],
  '[]',
  '{"total":6,"in_use":3,"idle":2,"listed":0,"sold":1}',
  '你的资产库中暂未发现智能穿戴设备。Apple Watch Ultra 2 与现有资产无功能重叠。二手市场参考价约 ¥4,200–¥5,200，当前新品价 ¥5,999 偏高，建议关注降价节点。[decision:buy]',
  '{"product":{"url":"","title":"Apple Watch Ultra 2","price":5999,"category":"数码","subcategory":"穿戴设备","source_type":"text","source_text":"Apple Watch Ultra 2 智能手表 GPS 版 价格 5999 元"}}',
  'buy', 'postponed', 'unknown', null,
  '2026-07-23T10:15:05Z', null,
  '2026-07-23T10:14:00Z', '2026-07-23T10:15:05Z'
);

commit;

select 'evaluations completed' as result;
