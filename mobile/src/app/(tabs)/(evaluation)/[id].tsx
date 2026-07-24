import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
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

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { streamPurchaseEvaluation } from '@/lib/api';
import {
  createEvaluationMessage,
  getPurchaseEvaluation,
  listEvaluationMessages,
  productFromEvaluation,
  type EvaluationChatMessage,
  type StoredEvaluationMessage,
} from '@/lib/evaluations';
import { formatCurrency, formatDate } from '@/lib/format';
import { useSession } from '@/providers/session-provider';
import { assetStatusLabels } from '@/types/domain';

export default function EvaluationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const query = useQuery({
    queryKey: ['purchase-evaluation', id],
    queryFn: () => getPurchaseEvaluation(id),
    enabled: Boolean(id),
  });
  const messagesQuery = useQuery({
    queryKey: ['evaluation-messages', id],
    queryFn: () => listEvaluationMessages(id),
    enabled: Boolean(id),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error.message} />;
  if (!query.data) return <ErrorState message="评估记录不存在" />;

  const item = query.data;
  const storedMessages = messagesQuery.data ?? [];
  const displayMessages: StoredEvaluationMessage[] = storedMessages.length
    ? storedMessages
    : [
        {
          id: 'initial',
          evaluation_id: item.id,
          user_id: item.user_id,
          role: 'assistant',
          content: item.narrative,
          created_at: item.created_at,
        },
      ];

  const send = async () => {
    const content = draft.trim();
    if (!content || !session || sending) return;
    if (content.length > 8000) {
      setSendError('单条消息不能超过 8000 字');
      return;
    }
    setSending(true);
    setSendError('');
    setDraft('');
    setStreamingReply('');
    const history: EvaluationChatMessage[] = displayMessages.map(
      ({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }),
    );
    history.push({ role: 'user', content });
    try {
      await createEvaluationMessage(item.id, session.user.id, 'user', content);
      await queryClient.invalidateQueries({
        queryKey: ['evaluation-messages', id],
      });
      const message = await streamPurchaseEvaluation(
        productFromEvaluation(item),
        item.matched_assets,
        item.facts,
        history.slice(-100),
        setStreamingReply,
      );
      await createEvaluationMessage(
        item.id,
        session.user.id,
        'assistant',
        message,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['evaluation-messages', id],
        }),
        queryClient.invalidateQueries({ queryKey: ['purchase-evaluations'] }),
      ]);
    } catch (caught) {
      setSendError(
        caught instanceof Error
          ? caught.message
          : '消息已保存，但回复失败，请稍后继续交流',
      );
    } finally {
      setSending(false);
      setStreamingReply('');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '评估对话' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 18 }}>
          <View
            style={{
              padding: 18,
              gap: 8,
              backgroundColor: colors.card,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
              {item.source_type === 'image'
                ? '图片 / 拍照识别'
                : item.source_type === 'text'
                  ? '文字输入'
                  : '商品链接'}{' '}
              · {item.subcategory || item.category} · {formatDate(item.created_at)}
            </Text>
            <Text
              selectable
              style={{ color: colors.text, fontSize: 21, fontWeight: '800' }}>
              {item.product_title}
            </Text>
            <Text
              selectable
              style={{ color: colors.green, fontSize: 28, fontWeight: '800' }}>
              {formatCurrency(item.product_price)}
            </Text>
            {item.source_text ? (
              <Text selectable style={{ color: colors.muted, lineHeight: 20 }}>
                {item.source_text}
              </Text>
            ) : null}
            {item.image_urls?.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}>
                {item.image_urls.map((url, index) => (
                  <Image
                    key={item.image_paths[index] ?? url}
                    source={url}
                    contentFit="cover"
                    style={{ width: 104, height: 104, borderRadius: 12 }}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>

          <View style={{ gap: 10 }}>
            <Text selectable style={{ color: colors.text, fontWeight: '800' }}>
              持续交流
            </Text>
            <Text selectable style={{ color: colors.muted, lineHeight: 20 }}>
              可以继续补充使用场景、频率、预算或顾虑，评估助手会沿着这条记录持续沟通。
            </Text>
            {messagesQuery.isLoading ? <LoadingState /> : null}
            {messagesQuery.error ? (
              <ErrorState message={messagesQuery.error.message} />
            ) : null}
            {displayMessages.map((message) => {
              const fromUser = message.role === 'user';
              return (
                <View
                  key={message.id}
                  style={{
                    maxWidth: '88%',
                    alignSelf: fromUser ? 'flex-end' : 'flex-start',
                    paddingHorizontal: 14,
                    paddingVertical: 11,
                    borderRadius: 16,
                    backgroundColor: fromUser ? colors.green : colors.greenSoft,
                  }}>
                  <Text
                    selectable
                    style={{
                      color: fromUser ? 'white' : colors.text,
                      lineHeight: 22,
                      fontSize: 15,
                    }}>
                    {message.content}
                  </Text>
                </View>
              );
            })}
            {sending ? (
              <View
                style={{
                  maxWidth: '88%',
                  alignSelf: 'flex-start',
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderRadius: 16,
                  backgroundColor: colors.greenSoft,
                }}>
                {streamingReply ? (
                  <Text
                    selectable
                    style={{
                      color: colors.text,
                      lineHeight: 22,
                      fontSize: 15,
                    }}>
                    {streamingReply}
                  </Text>
                ) : (
                  <ActivityIndicator color={colors.green} />
                )}
              </View>
            ) : null}
          </View>

          <View style={{ gap: 10 }}>
            <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
              匹配到的资产
            </Text>
            {item.matched_assets.map((asset) => (
              <View
                key={asset.id}
                style={{
                  padding: 15,
                  gap: 5,
                  backgroundColor: colors.card,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                }}>
                <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
                  {asset.name}
                </Text>
                <Text selectable style={{ color: colors.muted }}>
                  {[asset.brand, asset.model].filter(Boolean).join(' ') || '—'} ·{' '}
                  {assetStatusLabels[asset.status]}
                </Text>
              </View>
            ))}
            {!item.matched_assets.length ? (
              <Text selectable style={{ color: colors.muted }}>
                暂无可明确匹配的同类资产
              </Text>
            ) : null}
          </View>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: process.env.EXPO_OS === 'ios' ? 20 : 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}>
          {sendError ? (
            <Text selectable style={{ color: colors.danger, marginBottom: 8 }}>
              {sendError}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
            <TextInput
              accessibilityLabel="继续评估对话"
              multiline
              onChangeText={setDraft}
              placeholder="继续说说你的使用场景或顾虑…"
              value={draft}
              style={{
                flex: 1,
                maxHeight: 120,
                minHeight: 44,
                paddingHorizontal: 13,
                paddingVertical: 10,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                textAlignVertical: 'top',
              }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={sending || !draft.trim()}
              onPress={send}
              style={({ pressed }) => ({
                minWidth: 62,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: colors.green,
                opacity: pressed || sending || !draft.trim() ? 0.55 : 1,
              })}>
              <Text style={{ color: 'white', fontWeight: '800' }}>发送</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
