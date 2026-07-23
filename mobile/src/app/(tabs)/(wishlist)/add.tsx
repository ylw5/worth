import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState, type ComponentProps } from 'react';
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
import { createWishlistItem } from '@/lib/wishlist';
import { parseWishlistInput } from '@/lib/wishlist-input';
import { useSession } from '@/providers/session-provider';

function Field({
  label,
  value,
  onChangeText,
  ...props
}: ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
        {label}
      </Text>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        style={{
          minHeight: props.multiline ? 96 : undefined,
          color: colors.text,
          fontSize: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          textAlignVertical: props.multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export default function AddWishlistScreen() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const parsed = parseWishlistInput(name, targetPrice, notes);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      await createWishlistItem(session.user.id, parsed.input);
      await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '添加心愿' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 18 }}>
          <Field
            label="名称"
            value={name}
            onChangeText={setName}
            placeholder="例如：旅行相机"
          />
          <Field
            label="目标价格"
            value={targetPrice}
            onChangeText={setTargetPrice}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Field
            label="备注（可选）"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="为什么想要它"
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
                保存
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
