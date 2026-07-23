import { Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { useSession } from '@/providers/session-provider';

export default function AccountScreen() {
  const { session } = useSession();

  return (
    <>
      <Stack.Screen options={{ title: '账号' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View
          style={{
            padding: 18,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 8,
          }}>
          <Text selectable style={{ color: colors.muted }}>
            固定管理员
          </Text>
          <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
            {session?.user.email}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}
