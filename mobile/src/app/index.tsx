import { Redirect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { useSession } from '@/providers/session-provider';

export default function IndexScreen() {
  const { session, loading, error, retry } = useSession();
  if (loading) return <LoadingState label="正在进入资产库…" />;
  if (error || !session) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          gap: 16,
          backgroundColor: colors.background,
        }}>
        <Text selectable style={{ color: colors.danger, textAlign: 'center' }}>
          {error || '管理员会话不可用'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => ({
            alignItems: 'center',
            padding: 14,
            borderRadius: 14,
            backgroundColor: colors.green,
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text style={{ color: 'white', fontWeight: '700' }}>重试</Text>
        </Pressable>
      </View>
    );
  }
  return <Redirect href="/(tabs)/(assets)" />;
}
