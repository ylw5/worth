import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatHistoryDrawer } from '@/components/chat-history-drawer';
import { ChatThread } from '@/components/chat-thread';
import { colors, spacing } from '@/constants/colors';
import {
  getThreadIdForEvaluation,
  listAgentThreads,
} from '@/lib/agent-chat';

export default function EvaluationScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    threadId?: string;
    evaluationId?: string;
  }>();
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    typeof params.threadId === 'string' ? params.threadId : null,
  );
  const [conversationTitle, setConversationTitle] = useState('聊天');
  const threads = useQuery({
    queryKey: ['agent-threads'],
    queryFn: listAgentThreads,
  });

  useEffect(() => {
    if (typeof params.threadId === 'string' && params.threadId) {
      setActiveThreadId(params.threadId);
      return;
    }
    if (typeof params.evaluationId !== 'string' || !params.evaluationId) {
      return;
    }
    let cancelled = false;
    getThreadIdForEvaluation(params.evaluationId).then((threadId) => {
      if (cancelled || !threadId) return;
      setActiveThreadId(threadId);
      router.setParams({ threadId, evaluationId: undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [params.threadId, params.evaluationId]);

  const startNewChat = () => {
    setActiveThreadId(null);
    setConversationTitle('聊天');
    setOpen(false);
    router.replace('/(tabs)/(evaluation)');
  };

  const headerTitle = activeThreadId ? conversationTitle : '聊天';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        drawerPosition="left"
        drawerType="front"
        drawerStyle={{ width: '82%', backgroundColor: colors.surface }}
        overlayStyle={{ backgroundColor: 'rgba(11, 11, 13, 0.28)' }}
        renderDrawerContent={() => (
          <ChatHistoryDrawer
            items={threads.data ?? []}
            loading={threads.isLoading}
            errorMessage={threads.error?.message}
            selectedId={activeThreadId}
            onClose={() => setOpen(false)}
            onSelect={(id) => {
              setActiveThreadId(id);
              const item = threads.data?.find((thread) => thread.id === id);
              if (item?.title) setConversationTitle(item.title);
              setOpen(false);
              router.setParams({ threadId: id });
            }}
            onNewChat={startNewChat}
          />
        )}>
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              paddingTop: insets.top + spacing.sm,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开历史"
              onPress={() => setOpen(true)}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 99,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              })}>
              <SymbolView
                name={{
                  ios: 'line.3.horizontal',
                  android: 'menu',
                  web: 'menu',
                }}
                size={18}
                tintColor={colors.textPrimary}
              />
            </Pressable>
            <View style={{ flex: 1, height: 22, justifyContent: 'center', overflow: 'hidden' }}>
              <Text
                selectable
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  textAlign: 'center',
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: '600',
                  color: colors.textPrimary,
                }}>
                {headerTitle}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新聊天"
              onPress={startNewChat}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 99,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              })}>
              <SymbolView
                name={{
                  ios: 'square.and.pencil',
                  android: 'edit',
                  web: 'edit',
                }}
                size={18}
                tintColor={colors.textPrimary}
              />
            </Pressable>
          </View>

          <ChatThread
            threadId={activeThreadId}
            onThreadIdChange={(id) => {
              setActiveThreadId(id);
              router.setParams({ threadId: id });
            }}
            onTitleChange={setConversationTitle}
          />
        </KeyboardAvoidingView>
      </Drawer>
    </>
  );
}
