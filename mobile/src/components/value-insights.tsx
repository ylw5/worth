import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { colors, radius, spacing, typography } from '@/constants/colors';
import type { Asset, MarketInsight } from '@/types/domain';

import { HoldingCostView } from './holding-cost-view';
import { MarketSnapshotCard } from './market-snapshot-card';
import { ValueViewToggle, type ValueView } from './value-view-toggle';

const KEY = 'worth:value-view';

export function ValueInsights({
  asset,
  insight,
}: {
  asset: Asset;
  insight: MarketInsight;
}) {
  const defaultView: ValueView =
    asset.purchase_date && asset.purchase_price ? 'holding' : 'market';
  const [view, setView] = useState<ValueView>(defaultView);

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((saved) => {
      if (saved === 'holding' || saved === 'market') setView(saved);
    });
  }, []);

  const select = (next: ValueView) => {
    setView(next);
    void SecureStore.setItemAsync(KEY, next);
  };

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.xl,
        borderRadius: radius.large,
        backgroundColor: colors.surface,
      }}>
      <Text style={{ ...typography.sectionTitle }}>价值参考</Text>
      <ValueViewToggle value={view} onChange={select} />
      {view === 'holding' ? (
        <HoldingCostView asset={asset} insight={insight} />
      ) : (
        <MarketSnapshotCard insight={insight} />
      )}
    </View>
  );
}
