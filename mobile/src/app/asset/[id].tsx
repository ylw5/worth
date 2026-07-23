import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AssetPhotoGallery } from '@/components/asset-photo-gallery';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { estimateAsset } from '@/lib/api';
import { getAsset, getValuations, recordValuation } from '@/lib/assets';
import { formatCurrency, formatDate, specsToText } from '@/lib/format';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAsset(id),
    enabled: Boolean(id),
  });
  const historyQuery = useQuery({
    queryKey: ['valuations', id],
    queryFn: () => getValuations(id),
    enabled: Boolean(id),
  });
  const refresh = useMutation({
    mutationFn: async () => {
      if (!assetQuery.data) return;
      const valuation = await estimateAsset(assetQuery.data);
      await recordValuation(assetQuery.data.id, valuation);
      return valuation;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['valuations', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    },
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  const asset = assetQuery.data;
  if (!asset) return <ErrorState message="资产不存在" />;

  const latest = historyQuery.data?.[0];
  return (
    <>
      <Stack.Screen
        options={{
          title: asset.name,
          headerRight: () => (
            <Link
              href={{
                pathname: '/asset/[id]/edit',
                params: { id: asset.id },
              }}
              asChild>
              <Pressable accessibilityRole="button">
                <Text style={{ color: colors.green, fontWeight: '700' }}>
                  编辑
                </Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 18 }}>
        <AssetPhotoGallery urls={asset.photo_urls ?? []} />
        <View
          style={{
            padding: 18,
            gap: 10,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
          <Text selectable style={{ color: colors.muted }}>
            当前参考市价
          </Text>
          <Text
            selectable
            style={{
              color: colors.green,
              fontSize: 34,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}>
            {formatCurrency(asset.latest_market_price)}
          </Text>
          {latest ? (
            <Text selectable style={{ color: colors.muted }}>
              {formatCurrency(latest.price_low)}–
              {formatCurrency(latest.price_high)} · {latest.sample_count}{' '}
              个相似样本
            </Text>
          ) : (
            <Text selectable style={{ color: colors.muted }}>
              暂无可靠估价
            </Text>
          )}
          {refresh.error ? (
            <Text selectable style={{ color: colors.danger }}>
              {refresh.error.message}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={refresh.isPending}
            onPress={() => refresh.mutate()}
            style={({ pressed }) => ({
              alignItems: 'center',
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.green,
              opacity: pressed || refresh.isPending ? 0.65 : 1,
            })}>
            {refresh.isPending ? (
              <ActivityIndicator color={colors.green} />
            ) : (
              <Text style={{ color: colors.green, fontWeight: '700' }}>
                刷新价格
              </Text>
            )}
          </Pressable>
        </View>

        <View
          style={{
            padding: 18,
            gap: 14,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
          }}>
          {[
            ['分类', asset.category],
            ['品牌型号', [asset.brand, asset.model].filter(Boolean).join(' ')],
            ['规格', specsToText(asset.specs) || '—'],
            ['成色', asset.condition || '—'],
            ['买入日期', asset.purchase_date || '—'],
            [
              '买入价格',
              asset.purchase_price === null
                ? '—'
                : formatCurrency(asset.purchase_price),
            ],
            ['添加时间', formatDate(asset.created_at)],
          ].map(([label, value]) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 20,
              }}>
              <Text selectable style={{ color: colors.muted }}>
                {label}
              </Text>
              <Text
                selectable
                style={{
                  flex: 1,
                  color: colors.text,
                  textAlign: 'right',
                }}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 10 }}>
          <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
            价格历史
          </Text>
          {historyQuery.data?.map((valuation) => (
            <View
              key={valuation.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                padding: 14,
                borderRadius: 14,
                borderCurve: 'continuous',
                backgroundColor: colors.card,
              }}>
              <Text selectable style={{ color: colors.muted }}>
                {formatDate(valuation.created_at)}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.green,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}>
                {formatCurrency(valuation.estimated_price)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}
