import { Stack } from 'expo-router';

import { colors } from '@/constants/colors';

export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    />
  );
}
