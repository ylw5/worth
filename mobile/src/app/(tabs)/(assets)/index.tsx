import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { AssetCard } from '@/components/asset-card';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { listAssets } from '@/lib/assets';
import { formatCurrency } from '@/lib/format';

export default function AssetsScreen() {
  const query = useQuery({ queryKey: ['assets'], queryFn: listAssets });
  const assets = query.data ?? [];
  const total = assets.reduce(
    (sum, asset) => sum + (asset.latest_market_price ?? 0),
    0,
  );
  const pending = assets.filter(
    (asset) => asset.latest_market_price === null,
  ).length;
  const categories = Object.entries(
    assets.reduce<Record<string, number>>((counts, asset) => {
      counts[asset.category] = (counts[asset.category] ?? 0) + 1;
      return counts;
    }, {}),
  );

  return (
    <>
      <Stack.Screen options={{ title: '我的资产', headerLargeTitle: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.muted }}>
            总资产参考价值
          </Text>
          <Text
            selectable
            style={{
              color: colors.text,
              fontSize: 40,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}>
            {formatCurrency(total)}
          </Text>
          <Text selectable style={{ color: colors.muted }}>
            {assets.length} 件资产 · {pending} 件待估价
          </Text>
        </View>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}

        {categories.length ? (
          <View
            style={{
              gap: 12,
              padding: 16,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
              分类分布
            </Text>
            {categories.map(([category, count]) => (
              <View
                key={category}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}>
                <Text selectable style={{ width: 72, color: colors.muted }}>
                  {category}
                </Text>
                <View
                  style={{
                    height: 8,
                    flex: count,
                    maxWidth: `${Math.max(
                      15,
                      (count / assets.length) * 100,
                    )}%`,
                    backgroundColor: colors.green,
                    borderRadius: 99,
                  }}
                />
                <Text selectable style={{ color: colors.muted }}>
                  {count}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
            最近添加
          </Text>
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
          {!query.isLoading && !assets.length ? (
            <View
              style={{
                padding: 32,
                alignItems: 'center',
                gap: 12,
                backgroundColor: colors.card,
                borderRadius: 18,
                borderCurve: 'continuous',
              }}>
              <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
                还没有资产
              </Text>
              <Link href="/(tabs)/(capture)" style={{ color: colors.green }}>
                拍下第一件物品
              </Link>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
