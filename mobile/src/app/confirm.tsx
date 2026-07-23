import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/constants/colors';
import { estimateAsset } from '@/lib/api';
import { createAsset, recordValuation } from '@/lib/assets';
import { specsToText, textToSpecs } from '@/lib/format';
import { useDraft } from '@/providers/draft-provider';
import { useSession } from '@/providers/session-provider';
import { categories, type AssetInput, type Category } from '@/types/domain';

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
        {label}
      </Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        value={value}
        style={{
          minHeight: multiline ? 72 : undefined,
          color: colors.text,
          fontSize: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export default function ConfirmScreen() {
  const { draft, setDraft } = useDraft();
  const { session } = useSession();
  const [form, setForm] = useState<AssetInput | null>(
    draft?.recognition ?? null,
  );
  const [specsText, setSpecsText] = useState(
    draft ? specsToText(draft.recognition.specs) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const set = (key: keyof AssetInput, value: string | Category) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const save = async () => {
    if (!form.name.trim() || !form.search_query.trim()) {
      setError('请填写名称和估价搜索词');
      return;
    }
    setLoading(true);
    setError('');
    const input = { ...form, specs: textToSpecs(specsText) };
    try {
      const asset = await createAsset(
        session.user.id,
        draft.photoPath,
        input,
      );
      try {
        const valuation = await estimateAsset(input);
        await recordValuation(asset.id, valuation);
      } catch {
        // The asset is valid even when its first valuation is temporarily unavailable.
      }
      setDraft(null);
      router.replace({ pathname: '/asset/[id]', params: { id: asset.id } });
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
        <Image
          source={draft.localUri}
          contentFit="cover"
          style={{
            width: '100%',
            aspectRatio: 1.25,
            borderRadius: 20,
          }}
        />
        <Text selectable style={{ color: colors.muted }}>
          AI 已填写信息，请确认后保存
        </Text>
        <Field label="名称" value={form.name} onChangeText={(v) => set('name', v)} />
        <Field label="品牌" value={form.brand} onChangeText={(v) => set('brand', v)} />
        <Field label="型号" value={form.model} onChangeText={(v) => set('model', v)} />
        <Field
          label="规格（每行“名称: 内容”）"
          multiline
          value={specsText}
          onChangeText={setSpecsText}
        />
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
            分类
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((category) => (
              <Pressable
                key={category}
                onPress={() => set('category', category)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 99,
                  backgroundColor:
                    form.category === category
                      ? colors.green
                      : colors.greenSoft,
                }}>
                <Text
                  style={{
                    color:
                      form.category === category ? 'white' : colors.green,
                  }}>
                  {category}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Field
          label="成色"
          value={form.condition}
          onChangeText={(v) => set('condition', v)}
        />
        <Field
          label="估价搜索词"
          value={form.search_query}
          onChangeText={(v) => set('search_query', v)}
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
