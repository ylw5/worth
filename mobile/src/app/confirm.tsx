import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AssetFormFields } from '@/components/asset-form-fields';
import { colors } from '@/constants/colors';
import { estimateAsset } from '@/lib/api';
import { createAsset, recordValuation, removePhotos } from '@/lib/assets';
import { specsToText, textToSpecs } from '@/lib/format';
import { parsePurchaseInput } from '@/lib/purchase-input';
import { useDraft } from '@/providers/draft-provider';
import { useSession } from '@/providers/session-provider';
import type { AssetInput } from '@/types/domain';

export default function ConfirmScreen() {
  const { draft, setDraft } = useDraft();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AssetInput | null>(
    draft?.recognition ?? null,
  );
  const [specsText, setSpecsText] = useState(
    draft ? specsToText(draft.recognition.specs) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const saved = useRef(false);

  useEffect(
    () => () => {
      if (!saved.current && draft) {
        removePhotos(draft.photoPaths).catch(() => undefined);
      }
    },
    [draft],
  );

  if (!draft || !form || !session) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
        <Text selectable style={{ color: colors.muted }}>
          当前没有待确认的照片
        </Text>
      </View>
    );
  }

  const save = async () => {
    if (!form.name.trim() || !form.search_query.trim()) {
      setError('请填写名称和估价搜索词');
      return;
    }
    const purchase = parsePurchaseInput(
      form.purchase_date,
      form.purchase_price,
    );
    if ('error' in purchase) {
      setError(purchase.error);
      return;
    }
    setLoading(true);
    setError('');
    const input = {
      ...form,
      ...purchase.input,
      specs: textToSpecs(specsText),
    };
    try {
      const asset = await createAsset(session.user.id, draft.photoPaths, input);
      try {
        const valuation = await estimateAsset(input);
        await recordValuation(asset.id, valuation);
      } catch {
        // The asset is valid even when its first valuation is temporarily unavailable.
      }
      saved.current = true;
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      router.dismissTo('/(tabs)/(assets)');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {draft.localUris.map((uri) => (
            <Image
              key={uri}
              source={uri}
              contentFit="cover"
              style={{
                width: '48%',
                aspectRatio: 1,
                borderRadius: 16,
              }}
            />
          ))}
        </View>
        <Text selectable style={{ color: colors.muted }}>
          AI 已填写信息，请确认后保存
        </Text>
        <AssetFormFields
          form={form}
          specsText={specsText}
          onChange={setForm}
          onChangeSpecsText={setSpecsText}
        />
        {error ? (
          <Text selectable style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={save}
          style={({ pressed }) => ({
            alignItems: 'center',
            padding: 16,
            borderRadius: 14,
            borderCurve: 'continuous',
            backgroundColor: colors.green,
            opacity: pressed || loading ? 0.65 : 1,
          })}>
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
              保存并估价
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
