-- 第 1/5 步：清理旧演示数据及三项指定资产
-- 后续文件执行失败时，请从本文件重新开始。
begin;

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('admin@worth.local')
  limit 1;

  if v_user_id is null then
    raise exception '未找到账号 admin@worth.local';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

-- 先解除资金分配，避免资产出售记录的保护触发器阻止删除。
delete from public.wishlist_funding_allocations as allocation
where allocation.user_id = auth.uid()
  and (
    allocation.wishlist_item_id in (
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002'
    )
    or allocation.spending_resolution_id in (
      select id
      from public.spending_resolutions
      where user_id = auth.uid()
        and evaluation_id in (
          '30000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002'
        )
    )
    or allocation.asset_sale_id in (
      select sale.id
      from public.asset_sales as sale
      join public.assets as asset on asset.id = sale.asset_id
      where sale.user_id = auth.uid()
        and (
          asset.id between
            '10000000-0000-0000-0000-000000000001'::uuid
            and '10000000-0000-0000-0000-000000000006'::uuid
          or regexp_replace(lower(trim(asset.name)), '\s+', '', 'g') in (
            '智能手机', '讯飞ai会议耳机', '可折叠墨镜'
          )
        )
    )
  );

delete from public.sell_plan_snapshots
where user_id = auth.uid()
  and (
    id = '60000000-0000-0000-0000-000000000001'
    or wishlist_item_id in (
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002'
    )
  );

delete from public.spending_resolutions
where user_id = auth.uid()
  and (
    id = '50000000-0000-0000-0000-000000000001'
    or evaluation_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
  );

delete from public.agent_messages
where user_id = auth.uid()
  and id between
    '71000000-0000-0000-0000-000000000001'::uuid
    and '71000000-0000-0000-0000-000000000006'::uuid;

delete from public.purchase_evaluations
where user_id = auth.uid()
  and id in (
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002'
  );

delete from public.agent_threads
where user_id = auth.uid()
  and (
    id in (
      '70000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000003'
    )
    or thread_key in ('demo:airpods-max', 'demo:apple-watch-ultra-2')
  );

delete from public.wishlist_items
where user_id = auth.uid()
  and id in (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002'
  );

delete from public.assets
where user_id = auth.uid()
  and (
    id between
      '10000000-0000-0000-0000-000000000001'::uuid
      and '10000000-0000-0000-0000-000000000006'::uuid
    or regexp_replace(lower(trim(name)), '\s+', '', 'g') in (
      '智能手机', '讯飞ai会议耳机', '可折叠墨镜'
    )
  );

commit;

select 'cleanup completed' as result;
