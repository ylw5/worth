import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Drawer } from 'react-native-drawer-layout';

import { ChatHistoryDrawer } from '@/components/chat-history-drawer';
import { EvaluationComposer } from '@/components/evaluation-composer';
import { colors } from '@/constants/colors';
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
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ['purchase-evaluations'],
    queryFn: listPurchaseEvaluations,
  });
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatReply, setChatReply] = useState('');

  const analyze = async () => {
    if (!session) return;
    const text = prompt.trim();
    if (!text && !photos.length) {
      setError('请描述商品、粘贴链接，或添加一张图片');
      return;
    }

    setLoading(true);
    setError('');
    setChatReply('');
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
            setChatReply(
              interpreted.reply ||
                '你好！想评估某件商品时，可以描述它、粘贴链接或发一张图片。',
            );
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
      router.push({
        pathname: '/(tabs)/(evaluation)/[id]',
        params: { id: evaluation.id },
      });
    } catch (caught) {
      if (!saved && uploadedPaths.length) {
        await removePhotos(uploadedPaths).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : '评估失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '聊天',
          headerLargeTitle: false,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={open ? '关闭历史' : '打开历史'}
              onPress={() => setOpen((value) => !value)}
              hitSlop={8}
              style={{
                width: 36,
                height: 36,
                marginLeft: 4,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 99,
                backgroundColor: colors.surfaceMuted,
              }}>
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
          ),
        }}
      />
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        drawerPosition="left"
        drawerType="front"
        drawerStyle={{ width: '80%', backgroundColor: colors.surface }}
        overlayStyle={{ backgroundColor: 'rgba(11, 11, 13, 0.35)' }}
        renderDrawerContent={() => (
          <ChatHistoryDrawer
            items={history.data ?? []}
            loading={history.isLoading}
            errorMessage={history.error?.message}
            onSelect={(id) => {
              setOpen(false);
              router.push({
                pathname: '/(tabs)/(evaluation)/[id]',
                params: { id },
              });
            }}
            onNewChat={() => {
              setPrompt('');
              setPhotos([]);
              setError('');
              setChatReply('');
              setOpen(false);
            }}
          />
        )}>
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 22 }}>
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

            {chatReply ? (
              <View
                style={{
                  maxWidth: '88%',
                  alignSelf: 'flex-start',
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderRadius: 16,
                  backgroundColor: colors.greenSoft,
                }}>
                <Text
                  selectable
                  style={{ color: colors.text, lineHeight: 22, fontSize: 15 }}>
                  {chatReply}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Drawer>
    </>
  );
}
