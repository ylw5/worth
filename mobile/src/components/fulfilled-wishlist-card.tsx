import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { TarotTransformation } from '@/components/tarot-transformation';
import { colors, radius, spacing, typography } from '@/constants/colors';
import type { AssetSaleWithName } from '@/lib/assets';
import { formatCurrency, formatDate } from '@/lib/format';
import type { ConfirmedSpendingResolution } from '@/lib/spending-resolutions';
import {
  saveWishAchievementImage,
  wishAchievementSaveErrorMessage,
} from '@/lib/wish-achievement-save';
import type { WishlistFundingAllocation } from '@/lib/wishlist-fulfillment';
import type { WishlistItem } from '@/lib/wishlist';
import { sumAmounts } from '@/lib/wishlist-progress';

type FulfilledWishlistCardProps = {
  item: WishlistItem & {
    actual_price: number;
    fulfilled_at: string;
  };
  allocations: WishlistFundingAllocation[];
  resolutions: ConfirmedSpendingResolution[];
  sales: AssetSaleWithName[];
  disabled: boolean;
  undoing: boolean;
  onUndo: (id: string, name: string) => void;
};

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}>
      <Text
        selectable
        style={{ color: colors.textSecondary, ...typography.label }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          ...typography.label,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

export function FulfilledWishlistCard({
  item,
  allocations,
  resolutions,
  sales,
  disabled,
  undoing,
  onUndo,
}: FulfilledWishlistCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareRevealed, setShareRevealed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const insets = useSafeAreaInsets();
  const shareRef = useRef<View>(null);
  const itemAllocations = allocations.filter(
    (allocation) => allocation.wishlist_item_id === item.id,
  );
  const resolutionNames = new Map(
    resolutions.map((resolution) => [
      resolution.id,
      resolution.product_snapshot.title,
    ]),
  );
  const saleNames = new Map(sales.map((sale) => [sale.id, sale.asset.name]));
  const spendingTotal = sumAmounts(
    itemAllocations
      .filter((allocation) => allocation.spending_resolution_id)
      .map((allocation) => allocation.amount),
  );
  const salesTotal = sumAmounts(
    itemAllocations
      .filter((allocation) => allocation.asset_sale_id)
      .map((allocation) => allocation.amount),
  );
  const selfPaid = Math.max(
    item.actual_price - spendingTotal - salesTotal,
    0,
  );

  const confirmUndo = () => {
    Alert.alert(
      '撤销实现？',
      `“${item.name}”会回到未实现，已使用资金将恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '撤销实现',
          style: 'destructive',
          onPress: () => onUndo(item.id, item.name),
        },
      ],
    );
  };

  const saveAchievement = async () => {
    try {
      setCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const uri = await captureRef(shareRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      const result = await saveWishAchievementImage(uri);
      if (result === 'shared') {
        Alert.alert('已打开分享', '当前环境无法直接写入相册，请通过分享保存图片');
        return;
      }
      Alert.alert('已保存', '已保存到相册，可去微信等应用分享');
    } catch (error) {
      Alert.alert('保存失败', wishAchievementSaveErrorMessage(error));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
      }}>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{ color: colors.textPrimary, ...typography.cardTitle }}>
          {item.name}
        </Text>
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.caption }}>
          {formatDate(item.fulfilled_at)}
        </Text>
      </View>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          ...typography.sectionTitle,
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(item.actual_price)}
      </Text>
      <View style={{ gap: spacing.sm }}>
        <TotalRow label="忍住消费抵扣" value={spendingTotal} />
        <TotalRow label="已卖闲置抵扣" value={salesTotal} />
        <TotalRow label="自付金额" value={selfPaid} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}>
        <Text style={{ color: colors.accent, fontWeight: '700' }}>
          {expanded ? '收起资金明细' : '查看资金明细'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: spacing.md }}>
          {itemAllocations.length ? (
            itemAllocations.map((allocation) => {
              const resolutionId = allocation.spending_resolution_id;
              const saleId = allocation.asset_sale_id;
              const name = resolutionId
                ? resolutionNames.get(resolutionId) ?? '忍住消费记录'
                : saleNames.get(saleId ?? '') ?? '闲置成交记录';
              return (
                <View
                  key={allocation.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: spacing.md,
                  }}>
                  <Text
                    selectable
                    style={{
                      flex: 1,
                      color: colors.textSecondary,
                      ...typography.label,
                    }}>
                    {name}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textPrimary,
                      ...typography.label,
                      fontWeight: '600',
                      fontVariant: ['tabular-nums'],
                    }}>
                    {formatCurrency(allocation.amount)}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.body }}>
              全部自付
            </Text>
          )}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`分享成就${item.name}`}
        onPress={() => {
          setShareRevealed(false);
          setShareOpen(true);
        }}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}>
        <Text style={{ color: colors.accent, fontWeight: '700' }}>
          分享成就
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={`撤销实现${item.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={confirmUndo}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          opacity: pressed || disabled ? 0.6 : 1,
        })}>
        {undoing ? (
          <ActivityIndicator color={colors.danger} size="small" />
        ) : null}
        <Text style={{ color: colors.danger, fontWeight: '700' }}>
          {undoing ? '撤销中…' : '撤销实现'}
        </Text>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setShareOpen(false)}
        presentationStyle="fullScreen"
        visible={shareOpen}>
        <View
          style={{
            flex: 1,
            backgroundColor: '#FFFCF5',
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}>
          <LinearGradient
            colors={['#FFFDF8', '#F7F1E6', '#FFFCF5']}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingVertical: spacing.md,
            }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭分享卡片"
              hitSlop={8}
              onPress={() => setShareOpen(false)}
              style={{
                width: 44,
                height: 44,
                alignItems: 'flex-start',
                justifyContent: 'center',
              }}>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 28,
                  fontWeight: '400',
                  lineHeight: 32,
                }}>
                ×
              </Text>
            </Pressable>
          </View>
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            <View
              ref={shareRef}
              collapsable={false}
              style={{ flex: 1, overflow: 'hidden' }}>
              <TarotTransformation
                data={{
                  wish: item.name,
                  valueConversion: formatCurrency(item.actual_price),
                  wealthFlow: '逆位 → 正位',
                }}
                onRevealed={() => setShareRevealed(true)}
              />
            </View>
            <View
              style={{
                height: 88,
                alignItems: 'center',
                justifyContent: 'center',
                paddingBottom: spacing.lg,
              }}>
              {shareRevealed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="保存图片"
                  disabled={capturing}
                  onPress={() => void saveAchievement()}
                  style={({ pressed }) => ({
                    minWidth: 200,
                    minHeight: 52,
                    paddingHorizontal: spacing.xxxl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: 'rgba(168, 131, 80, 0.36)',
                    backgroundColor: '#EADDBF',
                    shadowColor: '#8B6E43',
                    shadowOpacity: 0.14,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 8 },
                    opacity: pressed || capturing ? 0.65 : 1,
                  })}>
                  {capturing ? (
                    <ActivityIndicator color="#765D38" />
                  ) : (
                    <Text
                      style={{
                        color: '#765D38',
                        ...typography.cardTitle,
                        fontFamily: Platform.select({
                          ios: 'Kaiti SC',
                          macos: 'Kaiti SC',
                          web: '"Kaiti SC", "STKaiti", "KaiTi", serif',
                          default: 'serif',
                        }),
                        fontWeight: '600',
                        letterSpacing: 0,
                      }}>
                      保存图片
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
