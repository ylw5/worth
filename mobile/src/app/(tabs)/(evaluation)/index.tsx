import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { EvaluationComposer } from '@/components/evaluation-composer';
import { ErrorState, LoadingState } from '@/components/screen-state';
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
  evaluationDecisionLabels,
  listEvaluationAssets,
  listPurchaseEvaluations,
  type ParsedProduct,
} from '@/lib/evaluations';
import { formatCurrency, formatDate } from '@/lib/format';
import type { AssetPhoto } from '@/lib/photos';
import { useSession } from '@/providers/session-provider';

export default function EvaluationScreen() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ['purchase-evaluations'],
    queryFn: listPurchaseEvaluations,
  });
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
      <Stack.Screen options={{ title: '购物前评估', headerLargeTitle: true }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 22 }}>
          <View style={{ gap: 8 }}>
            <Text
              selectable
              style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>
              买之前，先和自己的使用历史聊一聊
            </Text>
            <Text selectable style={{ color: colors.muted, lineHeight: 21 }}>
              描述想买的商品、粘贴链接，或者添加图片。系统会自动识别输入方式，并从你的资产记录中寻找相关事实。
            </Text>
          </View>

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

          <View style={{ gap: 12 }}>
            <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
              最近评估
            </Text>
            {history.isLoading ? <LoadingState /> : null}
            {history.error ? <ErrorState message={history.error.message} /> : null}
            {(history.data ?? []).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/(evaluation)/[id]',
                    params: { id: item.id },
                  })
                }
                style={({ pressed }) => ({
                  padding: 16,
                  gap: 7,
                  backgroundColor: colors.card,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Text
                  selectable
                  numberOfLines={2}
                  style={{ color: colors.text, fontWeight: '700' }}>
                  {item.product_title}
                </Text>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 3,
                      borderRadius: 999,
                      backgroundColor:
                        item.decision === 'buy'
                          ? colors.green
                          : item.decision === 'skip'
                            ? colors.danger
                            : colors.greenSoft,
                    }}>
                    <Text
                      style={{
                        color:
                          !item.decision || item.decision === 'pending'
                            ? colors.green
                            : 'white',
                        fontWeight: '700',
                        fontSize: 12,
                      }}>
                      {evaluationDecisionLabels[item.decision ?? 'pending']}
                    </Text>
                  </View>
                  {item.product_price !== null ? (
                    <Text selectable style={{ color: colors.green }}>
                      {formatCurrency(item.product_price)}
                    </Text>
                  ) : null}
                </View>
                <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
                  {item.source_type === 'image'
                    ? '图片识别'
                    : item.source_type === 'text'
                      ? '文字输入'
                      : '商品链接'}{' '}
                  · {item.subcategory || item.category} ·{' '}
                  {formatDate(item.updated_at ?? item.created_at)}
                </Text>
              </Pressable>
            ))}
            {!history.isLoading && !history.data?.length ? (
              <Text selectable style={{ color: colors.muted }}>
                还没有评估记录
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}