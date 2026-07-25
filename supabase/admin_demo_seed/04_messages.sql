-- 第 4/5 步：导入聊天消息、“忍住消费”和购买结果
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

insert into public.agent_messages (
  id, thread_id, user_id, role, content, route_result, created_at
) values
(
  '71000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000002', auth.uid(), 'user',
  '我已经有一个索尼 WH-1000XM5 了，音质也很好，这个真的需要吗？',
  '{"evaluation_id":"30000000-0000-0000-0000-000000000001"}',
  '2026-07-22T16:30:00Z'
),
(
  '71000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000002', auth.uid(), 'assistant',
  '从你的资产情况来看，索尼 WH-1000XM5 目前仍在正常使用中，成色几乎全新，二手参考价 ¥1,800。AirPods Max 的主动降噪能力和佩戴体验确实不同，但两副头戴式耳机同时持有容易造成闲置。如果你已经对索尼的降噪效果满意，AirPods Max 的升级空间有限。建议暂时跳过，把钱留在手里。',
  '{"evaluation_id":"30000000-0000-0000-0000-000000000001","decision":"skip","execution_trace":[{"call_id":"call_a1","step":1,"tool":"assets_list","status":"success","duration_ms":156},{"call_id":"call_a2","step":2,"tool":"assets_summary","status":"success","duration_ms":89},{"call_id":"call_a3","step":3,"tool":"market_price_snapshot","status":"success","duration_ms":1203},{"call_id":"call_a4","step":4,"tool":"evaluation_history_list","status":"success","duration_ms":412}]}',
  '2026-07-22T16:30:05Z'
),
(
  '71000000-0000-0000-0000-000000000003',
  '70000000-0000-0000-0000-000000000003', auth.uid(), 'user',
  '有点贵，等教育优惠或者降价再说吧',
  '{"evaluation_id":"30000000-0000-0000-0000-000000000002"}',
  '2026-07-23T10:15:00Z'
),
(
  '71000000-0000-0000-0000-000000000004',
  '70000000-0000-0000-0000-000000000003', auth.uid(), 'assistant',
  'Apple Watch Ultra 2 确实填补了你的穿戴设备空白。如果运动健康监测是你日常需要的功能，这是一个合理的缺口补充。教育优惠大约能减 ¥600–¥800，届时 ¥5,200 左右入手性价比更高。你可以关注 Apple 教育优惠季或官方翻新渠道。',
  '{"evaluation_id":"30000000-0000-0000-0000-000000000002","decision":"buy","execution_trace":[{"call_id":"call_b1","step":1,"tool":"assets_list","status":"success","duration_ms":132},{"call_id":"call_b2","step":2,"tool":"assets_summary","status":"success","duration_ms":78}]}',
  '2026-07-23T10:15:05Z'
),
(
  '71000000-0000-0000-0000-000000000005',
  (
    select id from public.agent_threads
    where user_id = auth.uid() and thread_key = 'general'
  ),
  auth.uid(), 'user',
  '你好，可以帮我分析一下我的资产状况吗？',
  '{}', '2026-07-24T09:00:00Z'
),
(
  '71000000-0000-0000-0000-000000000006',
  (
    select id from public.agent_threads
    where user_id = auth.uid() and thread_key = 'general'
  ),
  auth.uid(), 'assistant',
  '你好！你目前有 6 件资产，其中 3 件正在使用中、2 件闲置，另有 1 件（iPhone 14 Pro）已经以 ¥5,200 售出。你可以在「我的资产」页面查看详情，或者在聊天中输入你想评估的商品，我来帮你分析是否值得购买。',
  '{}', '2026-07-24T09:00:05Z'
);

insert into public.spending_resolutions (
  id, user_id, evaluation_id, message_id, amount,
  product_snapshot, image_paths, created_at, updated_at, confirmed_at
) values (
  '50000000-0000-0000-0000-000000000001',
  auth.uid(),
  '30000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000002',
  3999,
  '{"url":"","title":"AirPods Max 头戴式耳机","price":3999,"category":"数码","subcategory":"耳机","source_type":"text","source_text":"Apple AirPods Max 头戴式耳机 价格 3999 元"}',
  array[]::text[],
  '2026-07-22T16:30:05Z',
  '2026-07-22T16:31:00Z',
  '2026-07-22T16:31:00Z'
);

insert into public.purchase_outcome_events (
  id, evaluation_id, user_id, event_type, asset_id,
  note, source, occurred_at
) values
(
  '31000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', auth.uid(),
  'choice_skip', null, '听从 AI 建议，决定不购买 AirPods Max',
  'user', '2026-07-22T16:30:05Z'
),
(
  '31000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001', auth.uid(),
  'not_bought', null, '听从 AI 建议，决定不购买 AirPods Max',
  'user', '2026-07-22T16:30:05Z'
),
(
  '31000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000002', auth.uid(),
  'choice_postponed', null, '等教育优惠或降价',
  'user', '2026-07-23T10:15:05Z'
);

commit;

select 'messages completed' as result;
