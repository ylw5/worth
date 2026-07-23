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
        <NativeTabs.Trigger.Label hidden>资产</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(wishlist)">
        <NativeTabs.Trigger.Icon sf="heart.fill" md="favorite" />
        <NativeTabs.Trigger.Label hidden>心愿单</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(chat)">
        <NativeTabs.Trigger.Icon sf="bubble.left.fill" md="chat_bubble" />
        <NativeTabs.Trigger.Label hidden>聊天</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
        <NativeTabs.Trigger.Label hidden>账号</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
