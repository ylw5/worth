update public.assets
set condition = '无法判断'
where condition not in (
  '全新未使用',
  '几乎全新',
  '轻微使用痕迹',
  '明显使用痕迹',
  '重度使用或有瑕疵',
  '无法判断'
);

alter table public.assets
  alter column condition set default '无法判断',
  add constraint assets_condition_check
  check (
    condition in (
      '全新未使用',
      '几乎全新',
      '轻微使用痕迹',
      '明显使用痕迹',
      '重度使用或有瑕疵',
      '无法判断'
    )
  );
