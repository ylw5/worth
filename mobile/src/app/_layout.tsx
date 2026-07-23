import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/constants/colors';
import { DraftProvider } from '@/providers/draft-provider';
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
          <DraftProvider>
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
                name="confirm"
                options={{ title: '确认资产信息', presentation: 'modal' }}
              />
              <Stack.Screen
                name="asset/[id]"
                options={{ title: '资产详情' }}
              />
              <Stack.Screen
                name="asset/[id]/edit"
                options={{ title: '编辑物品' }}
              />
            </Stack>
          </DraftProvider>
        </QueryClientProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
