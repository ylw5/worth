import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatConversation } from '@/components/chat-conversation';
import { ChatHistoryDrawer } from '@/components/chat-history-drawer';
import { EvaluationComposer } from '@/components/evaluation-composer';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, spacing } from '@/constants/colors';
import {
  createAgentMessage,
  getOrCreateGeneralThread,
  listAgentMessages,
} from '@/lib/agent-chat';
import {
  analyzeProductPhotos,
  chatFreely,
  evaluatePurchase,
  normalizeProductText,
  parseProduct,
} from '@/lib/api';
import { removePhotos, uploadPhotos } from '@/lib/assets';
import {
  extractProductPrice,
  normalizeProductDescription,
  normalizeProductUrl,
} from '@/lib/evaluation-input';
import {
  createPurchaseEvaluation,
  listEvaluationAssets,
  listPurchaseEvaluations,
  type ParsedProduct,
} from '@/lib/evaluations';
import type { AssetPhoto } from '@/lib/photos';
import { useSession } from '@/providers/session-provider';

export default function EvaluationScreen() {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ evaluationId?: string }>();
  const history = useQuery({
    queryKey: ['purchase-evaluations'],
    queryFn: listPurchaseEvaluations,
  });
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    typeof params.evaluationId === 'string' ? params.evaluationId : null,
  );
  const [conversationTitle, setConversationTitle] = useState('聊天');
  const generalThread = useQuery({
    queryKey: ['agent-thread', 'general', session?.user.id],
    queryFn: () => getOrCreateGeneralThread(session!.user.id),
    enabled: Boolean(session),
  });
  const generalMessages = useQuery({
    queryKey: ['agent-messages', generalThread.data?.id],
    queryFn: () => listAgentMessages(generalThread.data!.id),
    enabled: Boolean(generalThread.data?.id),
  });
  const [prompt, setPrompt] = useState('');
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (
      typeof params.evaluationId === 'string' &&
      params.evaluationId
    ) {
      const timer = setTimeout(
        () => setActiveId(params.evaluationId as string),
        0,
      );
      return () => clearTimeout(timer);
    }
  }, [params.evaluationId]);

  const handleTitleChange = useCallback((title: string) => {
    setConversationTitle(title);
  }, []);

  const startNewChat = () => {
    setActiveId(null);
    setConversationTitle('聊天');
    setPrompt('');
    setPhotos([]);
    setError('');
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
      const evaluation = await createPurchaseEvaluation(
        session.user.id,
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
            items={history.data ?? []}
            loading={history.isLoading}
            errorMessage={history.error?.message}
            selectedId={activeId}
            onClose={() => setOpen(false)}
            onSelect={openConversation}
            onNewChat={startNewChat}
          />
        )}>
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
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
            <Text
              selectable
              numberOfLines={1}
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 17,
                fontWeight: '600',
                color: colors.textPrimary,
              }}>
              {headerTitle}
            </Text>
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

          {activeId ? (
            <ChatConversation
              evaluationId={activeId}
              onTitleChange={handleTitleChange}
            />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: spacing.xl,
                paddingTop: spacing.lg,
                paddingBottom: spacing.xl,
                gap: spacing.lg,
              }}>
              <EvaluationComposer
                value={prompt}
                photos={photos}
                loading={loading}
                onChangeText={setPrompt}
                onChangePhotos={setPhotos}
                onError={setError}
                onSubmit={analyze}
              />

              {error ? (
                <Text selectable style={{ color: colors.danger }}>
                  {error}
                </Text>
              ) : null}

              {generalMessages.isLoading ? <LoadingState /> : null}
              {generalMessages.error ? (
                <ErrorState message={generalMessages.error.message} />
              ) : null}
              {(generalMessages.data ?? []).slice(-10).map((message) => {
                const fromUser = message.role === 'user';
                return (
                  <View
                    key={message.id}
                    style={{
                      maxWidth: '88%',
                      alignSelf: fromUser ? 'flex-end' : 'flex-start',
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      borderRadius: 16,
                      backgroundColor: fromUser
                        ? colors.green
                        : colors.greenSoft,
                    }}>
                    <Text
                      selectable
                      style={{
                        color: fromUser ? 'white' : colors.text,
                        lineHeight: 22,
                        fontSize: 15,
                      }}>
                      {message.content}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Drawer>
    </>
  );
}
