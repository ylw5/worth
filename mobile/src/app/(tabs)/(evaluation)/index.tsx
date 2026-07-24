import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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
import { colors, spacing } from '@/constants/colors';
import {
  analyzeProductPhotos,
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
  const params = useLocalSearchParams<{ id?: string }>();
  const history = useQuery({
    queryKey: ['purchase-evaluations'],
    queryFn: listPurchaseEvaluations,
  });
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    typeof params.id === 'string' ? params.id : null,
  );
  const [conversationTitle, setConversationTitle] = useState('聊天');
  const [prompt, setPrompt] = useState('');
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starterMessages, setStarterMessages] = useState<
    { id: string; role: 'user' | 'assistant'; content: string }[]
  >([]);
  const starterScrollRef = useRef<ScrollView>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (typeof params.id === 'string' && params.id) {
      setActiveId(params.id);
    }
  }, [params.id]);

  useEffect(() => {
    if (!starterMessages.length) return;
    const timer = setTimeout(() => {
      starterScrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [starterMessages.length]);

  useEffect(() => {
    const showEvent =
      process.env.EXPO_OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      process.env.EXPO_OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleTitleChange = useCallback((title: string) => {
    setConversationTitle(title);
  }, []);

  const startNewChat = () => {
    setActiveId(null);
    setConversationTitle('聊天');
    setPrompt('');
    setPhotos([]);
    setError('');
    setStarterMessages([]);
    setOpen(false);
  };

  const openConversation = (id: string) => {
    setActiveId(id);
    setPrompt('');
    setPhotos([]);
    setError('');
    setStarterMessages([]);
    setOpen(false);
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
      const assetsPromise = listEvaluationAssets();
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
            const reply =
              interpreted.reply ||
              '你好！想聊聊某件商品时，可以描述它、粘贴链接或发一张图片。';
            const stamp = Date.now();
            setStarterMessages((prev) => [
              ...prev,
              { id: `user-${stamp}`, role: 'user', content: text },
              { id: `assistant-${stamp}`, role: 'assistant', content: reply },
            ]);
            setPrompt('');
            return;
          }
          product = interpreted.product;
        }
      }

      const assets = await assetsPromise;
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
            <View style={{ flex: 1 }}>
              <ScrollView
                ref={starterScrollRef}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  flexGrow: 1,
                  paddingHorizontal: spacing.xl,
                  paddingTop: spacing.md,
                  paddingBottom: spacing.lg,
                  gap: spacing.lg,
                }}>
                {starterMessages.map((message) => {
                  const fromUser = message.role === 'user';
                  return (
                    <View
                      key={message.id}
                      style={{
                        maxWidth: fromUser ? '82%' : '88%',
                        alignSelf: fromUser ? 'flex-end' : 'flex-start',
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        borderRadius: 16,
                        backgroundColor: fromUser
                          ? colors.accentSoft
                          : colors.greenSoft,
                      }}>
                      <Text
                        selectable
                        style={{
                          color: colors.text,
                          lineHeight: 22,
                          fontSize: 15,
                        }}>
                        {message.content}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>

              <View
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingTop: spacing.sm,
                  paddingBottom: keyboardVisible ? spacing.sm : spacing.xl,
                }}>
                {error ? (
                  <Text
                    selectable
                    style={{
                      color: colors.danger,
                      marginBottom: spacing.sm,
                      paddingHorizontal: spacing.xs,
                    }}>
                    {error}
                  </Text>
                ) : null}
                <EvaluationComposer
                  value={prompt}
                  photos={photos}
                  loading={loading}
                  accessibilityLabel="描述商品或粘贴链接"
                  onChangeText={setPrompt}
                  onChangePhotos={setPhotos}
                  onError={setError}
                  onSubmit={analyze}
                />
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Drawer>
    </>
  );
}
