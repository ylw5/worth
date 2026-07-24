import { Stack } from 'expo-router';

import { colors } from '@/constants/colors';

export default function EvaluationLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    />
  );
}
