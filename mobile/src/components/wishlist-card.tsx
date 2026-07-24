import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import {
  Alert,
  Pressable,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import { getWishlistProgress } from '@/lib/wishlist-progress';
import type { WishlistItem } from '@/lib/wishlist';

export function WishlistCard({
  item,
  fundedAmount,
  deleting,
  onDelete,
  style,
}: {
  item: WishlistItem;
  fundedAmount: number;
  deleting: boolean;
  onDelete: (id: string, name: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = getWishlistProgress(fundedAmount, item.target_price);

  const openCardMenu = () => {
    Alert.alert(item.name, undefined, [
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onDelete(item.id, item.name),
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <View
      style={[
        {
          padding: spacing.lg,
          gap: spacing.md,
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.large,
          borderCurve: 'continuous',
        },
        style,
      ]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: spacing.md,
        }}>
        <Text
          selectable
          style={{
            flex: 1,
            color: colors.textSecondary,
            ...typography.cardTitle,
          }}>
          {item.name}
        </Text>
        <Pressable
          accessibilityLabel={`${item.name}更多操作`}
          accessibilityRole="button"
          disabled={deleting}
          hitSlop={8}
          onPress={openCardMenu}
          style={{
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <SymbolView
            name={{
              ios: 'ellipsis',
              android: 'more_horiz',
              web: 'more_horiz',
            }}
            size={18}
            tintColor={colors.textSecondary}
          />
        </Pressable>
      </View>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          fontSize: 34,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(fundedAmount)} /{' '}
        {item.target_price.toLocaleString('zh-CN', {
          maximumFractionDigits: 0,
        })}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}>
        <View
          accessibilityLabel={`${item.name}心愿进度`}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: progress.barPercentage,
            text: `${progress.percentage}%`,
          }}
          style={{
            flex: 1,
            height: 12,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
          }}>
          <View
            style={{
              width: `${progress.barPercentage}%`,
              height: '100%',
              backgroundColor: colors.accent,
              borderRadius: radius.pill,
            }}
          />
        </View>
        <Text
          selectable
          style={{
            minWidth: 44,
            color: colors.textPrimary,
            fontSize: 18,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}>
          {progress.percentage}%
        </Text>
      </View>
      {item.notes ? (
        <Text
          selectable
          numberOfLines={3}
          style={{
            color: colors.textSecondary,
            ...typography.body,
          }}>
          {item.notes}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看${item.name}今日卖出方案`}
        onPress={() =>
          router.push({
            pathname: '/(tabs)/(wishlist)/[id]',
            params: { id: item.id },
          })
        }
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          paddingVertical: 5,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Text style={{ color: colors.green, fontWeight: '700' }}>
          查看今日卖出方案
        </Text>
      </Pressable>
    </View>
  );
}
