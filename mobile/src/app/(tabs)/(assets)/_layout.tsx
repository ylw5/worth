import { Stack } from 'expo-router';

import { colors } from '@/constants/colors';

export default function AssetsLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    />
  );
}
