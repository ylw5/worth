import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { recordAssetSale } from '@/lib/assets';
import { parsePurchaseInput } from '@/lib/purchase-input';

function Field({
  label,
  ...props
}: ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        {label}
      </Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textTertiary}
        style={{
          minHeight: props.multiline ? 96 : 48,
          color: colors.textPrimary,
          ...typography.body,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.small,
          borderCurve: 'continuous',
          backgroundColor: colors.surface,
          textAlignVertical: props.multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export default function AssetSaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [soldAt, setSoldAt] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [platform, setPlatform] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const parsed = parsePurchaseInput(soldAt, salePrice);
    if (
      !id ||
      'error' in parsed ||
      !parsed.input.purchase_date ||
      !parsed.input.purchase_price
    ) {
      setError('请填写有效的成交日期和成交价');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await recordAssetSale({
        asset_id: id,
        sold_at: parsed.input.purchase_date,
        sale_price: parsed.input.purchase_price,
        platform: platform.trim(),
        notes: notes.trim(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '记录出售' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
          <Field
            label="成交日期"
            value={soldAt}
            onChangeText={setSoldAt}
            placeholder="YYYY-MM-DD"
          />
          <Field
            label="成交价"
            value={salePrice}
            onChangeText={setSalePrice}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Field
            label="平台（选填）"
            value={platform}
            onChangeText={setPlatform}
          />
          <Field
            label="备注（选填）"
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          {error ? (
            <Text style={{ color: colors.danger, ...typography.body }}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={save}
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.medium,
              backgroundColor: colors.textPrimary,
              opacity: pressed || saving ? 0.65 : 1,
            })}>
            <Text
              style={{
                color: colors.onDark,
                ...typography.body,
                fontWeight: '700',
              }}>
              保存成交记录
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
