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
  createAgentMessage,
  createPurchaseEvaluationThread,
  getOrCreateGeneralThread,
  listAgentMessages,
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

  const openConversation = (id: string) => {
    setActiveId(id);
    setPrompt('');
    setPhotos([]);
    setError('');
    setOpen(false);
    router.setParams({ evaluationId: id });
  };

  const analyze = async () => {
    if (!session) return;
    const text = prompt.trim();
    if (!text && !photos.length) {
      setError('请描述商品、粘贴链接，或添加一张图片');
      return;
    }

    setLoading(true);
    setError('');
    let uploadedPaths: string[] = [];
    let saved = false;
    try {
      let product: ParsedProduct;

      if (photos.length) {
        const uploaded = await uploadPhotos(
          photos.map((photo) => photo.base64 ?? ''),
          session.user.id,
        );
        uploadedPaths = uploaded.map((photo) => photo.path);
        const recognized = await analyzeProductPhotos(
          uploaded.map((photo) => photo.signedUrl),
        );
        product = {
          ...recognized,
          price: recognized.price ?? extractProductPrice(text),
          source_text: text,
        };
      } else {
        const normalizedUrl = normalizeProductUrl(text);
        if ('url' in normalizedUrl) {
          product = await parseProduct(normalizedUrl.url);
        } else {
          const description = normalizeProductDescription(text);
          if ('error' in description) {
            setError(description.error);
            return;
          }
          const interpreted = await normalizeProductText(
            description.text,
            extractProductPrice(description.text),
          );
          if (interpreted.intent === 'chat' || !interpreted.product) {
            const thread =
              generalThread.data ??
              (await getOrCreateGeneralThread(session.user.id));
            const messages = (generalMessages.data ?? []).map(
              ({ role, content }) => ({ role, content }),
            );
            messages.push({ role: 'user', content: text });
            await createAgentMessage(
              thread.id,
              session.user.id,
              'user',
              text,
            );
            await queryClient.invalidateQueries({
              queryKey: ['agent-messages', thread.id],
            });
            const response = await chatFreely(messages.slice(-100));
            await createAgentMessage(
              thread.id,
              session.user.id,
              'assistant',
              response.message ||
                interpreted.reply ||
                '我在，慢慢说。',
            );
            await queryClient.invalidateQueries({
              queryKey: ['agent-messages', thread.id],
            });
            setPrompt('');
            return;
          }
          product = interpreted.product;
        }
      }

      const assets = await listEvaluationAssets();
      const result = await evaluatePurchase(product, assets);
      const thread = await createPurchaseEvaluationThread(
        session.user.id,
        result.product.title,
      );
      const evaluation = await createPurchaseEvaluation(
        session.user.id,
        thread.id,
        result,
        { imagePaths: uploadedPaths },
      );
      saved = true;
      await queryClient.invalidateQueries({
        queryKey: ['purchase-evaluations'],
      });
      setPrompt('');
      setPhotos([]);
      setConversationTitle(evaluation.product_title);
      setActiveId(evaluation.id);
    } catch (caught) {
      if (!saved && uploadedPaths.length) {
        await removePhotos(uploadedPaths).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const headerTitle = activeId ? conversationTitle : '聊天';

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
