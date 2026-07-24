import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/constants/colors';
import { SessionProvider } from '@/providers/session-provider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: colors.background },
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
            }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="asset/[id]"
              options={{ title: '资产详情' }}
            />
            <Stack.Screen
              name="asset/[id]/edit"
              options={{ title: '编辑物品' }}
            />
            <Stack.Screen
              name="asset/[id]/status"
              options={{ title: '物品状态' }}
            />
            <Stack.Screen
              name="asset/[id]/sale"
              options={{ title: '成交记录' }}
            />
          </Stack>
        </QueryClientProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
