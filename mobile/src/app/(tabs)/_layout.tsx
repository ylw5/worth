import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { colors } from '@/constants/colors';

export default function TabsLayout() {
  return (
    <NativeTabs
      backgroundColor={colors.card}
      indicatorColor={colors.greenSoft}
      tintColor={colors.green}>
      <NativeTabs.Trigger name="(assets)">
        <NativeTabs.Trigger.Icon sf="archivebox.fill" md="inventory_2" />
        <NativeTabs.Trigger.Label>资产</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(wishlist)">
        <NativeTabs.Trigger.Icon sf="heart.fill" md="favorite" />
        <NativeTabs.Trigger.Label>心愿单</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
        <NativeTabs.Trigger.Label>账号</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
