-- 第 2/5 步：导入资产、估值和出售记录
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

insert into public.assets (
  id, user_id, photo_paths, name, brand, model, specs,
  category, subcategory, "condition", search_query, status,
  latest_market_price, latest_market_price_low, latest_market_price_high,
  latest_valuation_at, purchase_date, purchase_price, photo_cutout_paths,
  status_confirmed_at, status_source
) values
(
  '10000000-0000-0000-0000-000000000001', auth.uid(),
  array['assets/demo/airpods-pro-2/1.jpg'],
  'AirPods Pro 2', 'Apple', 'A2700',
  '{"color":"白色","connectivity":"蓝牙5.3","noise_cancellation":"主动降噪"}',
  '数码', '耳机', '几乎全新', 'Apple AirPods Pro 2 耳机', 'idle',
  1200, 900, 1500, '2026-07-20T10:00:00Z',
  '2025-03-15', 1899, '{}', '2026-07-20T10:00:00Z', 'user'
),
(
  '10000000-0000-0000-0000-000000000002', auth.uid(),
  array['assets/demo/mx-master-3s/1.jpg'],
  '罗技 MX Master 3S', 'Logitech', '',
  '{"color":"石墨黑","connectivity":"USB-C 蓝牙","dpi":"8000"}',
  '数码', '鼠标', '轻微使用痕迹',
  'Logitech MX Master 3S 无线鼠标', 'in_use',
  450, 300, 600, '2026-07-20T10:05:00Z',
  '2025-01-20', 699, '{}', '2026-07-20T10:05:00Z', 'user'
),
(
  '10000000-0000-0000-0000-000000000003', auth.uid(),
  array['assets/demo/dyson-v15/1.jpg'],
  '戴森 V15 吸尘器', 'Dyson', 'V15 Detect',
  '{"type":"无线吸尘器","power":"230AW"}',
  '家电', '清洁电器', '明显使用痕迹',
  'Dyson V15 Detect 无线吸尘器', 'in_use',
  2800, 2000, 3500, '2026-07-20T10:10:00Z',
  '2024-06-10', 4990, '{}', null, 'default'
),
(
  '10000000-0000-0000-0000-000000000004', auth.uid(),
  array['assets/demo/brateck-desk/1.jpg'],
  '北弧电动升降桌', 'Brateck', 'E2 Pro',
  '{"size":"140x70cm","height_range":"72-120cm","load_capacity":"80kg"}',
  '家具', '桌子', '轻微使用痕迹',
  'Brateck 北弧电动升降桌', 'idle',
  1500, 1000, 2000, '2026-07-20T10:15:00Z',
  '2025-08-01', 2399, '{}', '2026-07-20T10:15:00Z', 'user'
),
(
  '10000000-0000-0000-0000-000000000005', auth.uid(),
  array['assets/demo/iphone-14-pro/1.jpg'],
  'iPhone 14 Pro', 'Apple', 'A2890',
  '{"storage":"256GB","color":"暗紫色","chip":"A16 Bionic"}',
  '数码', '手机', '重度使用或有瑕疵',
  'Apple iPhone 14 Pro 256GB 手机', 'sold',
  3500, 2500, 4500, '2026-06-15T08:00:00Z',
  '2023-01-10', 8999, '{}', '2026-03-01T00:00:00Z', 'user'
),
(
  '10000000-0000-0000-0000-000000000006', auth.uid(),
  array['assets/demo/sony-xm5/1.jpg'],
  '索尼 WH-1000XM5', 'Sony', 'WH-1000XM5',
  '{"color":"黑色","noise_cancellation":"自适应降噪","battery":"30小时"}',
  '数码', '耳机', '几乎全新',
  'Sony WH-1000XM5 头戴式降噪耳机', 'in_use',
  1800, 1200, 2200, '2026-07-20T10:20:00Z',
  '2025-05-20', 2499, '{}', '2026-07-20T10:20:00Z', 'user'
);

insert into public.valuations (
  id, asset_id, user_id, estimated_price, price_low, price_high,
  sample_count, query, sample_summary, created_at
) values
(
  '11000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', auth.uid(),
  1200, 900, 1500, 23, 'AirPods Pro 2 耳机',
  '[{"title":"AirPods Pro 2 二手","price":1200,"condition":"几乎全新"},{"title":"AirPods Pro 第二代","price":1350,"condition":"几乎全新"},{"title":"AirPods Pro 2 USB-C","price":1100,"condition":"轻微使用痕迹"}]',
  '2026-07-20T10:00:00Z'
),
(
  '11000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', auth.uid(),
  450, 300, 600, 18, 'Logitech MX Master 3S 鼠标',
  '[{"title":"罗技MX Master 3S","price":450,"condition":"轻微使用痕迹"},{"title":"MX Master 3S 无线鼠标","price":500,"condition":"几乎全新"},{"title":"Logitech MX Master 3S","price":380,"condition":"明显使用痕迹"}]',
  '2026-07-20T10:05:00Z'
),
(
  '11000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003', auth.uid(),
  2800, 2000, 3500, 15, 'Dyson V15 Detect 吸尘器',
  '[{"title":"Dyson V15 Detect","price":2800,"condition":"明显使用痕迹"},{"title":"戴森V15 无线吸尘器","price":3200,"condition":"轻微使用痕迹"},{"title":"Dyson V15 二手","price":2500,"condition":"重度使用或有瑕疵"}]',
  '2026-07-20T10:10:00Z'
),
(
  '11000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000004', auth.uid(),
  1500, 1000, 2000, 12, 'Brateck 北弧电动升降桌',
  '[{"title":"北弧电动升降桌 E2 Pro","price":1500,"condition":"轻微使用痕迹"},{"title":"Brateck 升降桌 140x70","price":1800,"condition":"几乎全新"},{"title":"北弧升降桌 二手","price":1200,"condition":"明显使用痕迹"}]',
  '2026-07-20T10:15:00Z'
),
(
  '11000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000006', auth.uid(),
  1800, 1200, 2200, 27, 'Sony WH-1000XM5 耳机',
  '[{"title":"WH-1000XM5 黑色","price":1800,"condition":"几乎全新"},{"title":"索尼XM5 头戴式耳机","price":2000,"condition":"全新未使用"},{"title":"WH-1000XM5 二手","price":1500,"condition":"轻微使用痕迹"}]',
  '2026-07-20T10:20:00Z'
);

insert into public.asset_sales (
  id, user_id, asset_id, sold_at, sale_price, platform, notes,
  created_at, updated_at
) values (
  '40000000-0000-0000-0000-000000000001', auth.uid(),
  '10000000-0000-0000-0000-000000000005',
  '2026-03-01', 5200, '转转', '置换升级 iPhone 16 Pro',
  '2026-03-01T08:00:00Z', '2026-03-01T08:00:00Z'
);

commit;

select 'assets completed' as result;
