import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Host, Icon } from '@expo/ui';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { PurchaseOutcomeControls } from '@/components/purchase-outcome-controls';
import { colors, radius, spacing } from '@/constants/colors';
import { streamPurchaseEvaluation } from '@/lib/api';
import {
  createEvaluationMessage,
  extractDecision,
  getPurchaseEvaluation,
  listEvaluationMessages,
  productFromEvaluation,
  stripDecisionMark,
  updateEvaluationDecision,
  type EvaluationChatMessage,
  type StoredEvaluationMessage,
} from '@/lib/evaluations';
import { useSession } from '@/providers/session-provider';

const sendIcon = Icon.select({
  ios: 'arrow.up',
  android: import('@expo/material-symbols/arrow_upward.xml'),
});

export function ChatConversation({
  evaluationId,
  onTitleChange,
}: {
  evaluationId: string;
  onTitleChange?: (title: string) => void;
}) {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [streamingReply, setStreamingReply] = useState('');

  const query = useQuery({
    queryKey: ['purchase-evaluation', evaluationId],
    queryFn: () => getPurchaseEvaluation(evaluationId),
    enabled: Boolean(evaluationId),
  });
  const messagesQuery = useQuery({
    queryKey: ['evaluation-messages', evaluationId],
    queryFn: () => listEvaluationMessages(evaluationId),
    enabled: Boolean(evaluationId),
  });

  const item = query.data;
  const storedMessages = messagesQuery.data ?? [];
  const displayMessages: StoredEvaluationMessage[] =
    item == null
      ? []
      : storedMessages.length
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

  const hasUserMessage = displayMessages.some(
    (message) => message.role === 'user',
  );
  const openingUserContent = item?.source_text?.trim() ?? '';
  const showOpeningUser =
    Boolean(item) &&
    !hasUserMessage &&
    (Boolean(openingUserContent) || Boolean(item?.image_urls?.length));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft('');
      setSendError('');
      setStreamingReply('');
    }, 0);
    return () => clearTimeout(timer);
  }, [evaluationId]);

  useEffect(() => {
    if (item?.product_title) onTitleChange?.(item.product_title);
  }, [item?.product_title, onTitleChange]);

  useEffect(() => {
    if (!displayMessages.length && !sending) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [displayMessages.length, sending, streamingReply, evaluationId]);

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error.message} />;
  if (!item) return <ErrorState message="对话不存在" />;

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
    const history: EvaluationChatMessage[] = [];
    if (showOpeningUser && openingUserContent) {
      history.push({ role: 'user', content: openingUserContent });
    }
    for (const message of displayMessages) {
      history.push({ role: message.role, content: message.content });
    }
    history.push({ role: 'user', content });
    try {
      await createEvaluationMessage(item.id, session.user.id, 'user', content);
      await queryClient.invalidateQueries({
        queryKey: ['evaluation-messages', evaluationId],
      });
      const message = await streamPurchaseEvaluation(
        item.id,
        productFromEvaluation(item),
        item.matched_assets,
        item.facts,
        history.slice(-100),
        setStreamingReply,
      );
      const { decision: nextDecision, cleaned } = extractDecision(message);
      await createEvaluationMessage(
        item.id,
        session.user.id,
        'assistant',
        cleaned || message,
      );
      if (nextDecision) {
        await updateEvaluationDecision(item.id, nextDecision).catch(
          () => undefined,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['evaluation-messages', evaluationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['purchase-evaluation', evaluationId],
        }),
        queryClient.invalidateQueries({ queryKey: ['purchase-evaluations'] }),
      ]);
    } catch (caught) {
      setSendError(
        caught instanceof Error
          ? caught.message
          : '消息已保存，但回复失败，请稍后重试',
      );
    } finally {
      setSending(false);
      setStreamingReply('');
    }
  };

  const canSend = !sending && Boolean(draft.trim());

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.md,
          paddingBottom: spacing.lg,
          gap: spacing.lg,
        }}>
        {messagesQuery.isLoading ? <LoadingState /> : null}
        {messagesQuery.error ? (
          <ErrorState message={messagesQuery.error.message} />
        ) : null}

        <PurchaseOutcomeControls evaluation={item} />

        {showOpeningUser ? (
          <View style={{ gap: spacing.sm, alignItems: 'flex-end' }}>
            {item.image_urls?.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm }}>
                {item.image_urls.map((url, index) => (
                  <Image
                    key={item.image_paths[index] ?? url}
                    source={url}
                    contentFit="cover"
                    style={{ width: 96, height: 96, borderRadius: 14 }}
                  />
                ))}
              </ScrollView>
            ) : null}
            {openingUserContent ? (
              <MessageBubble role="user" content={openingUserContent} />
            ) : null}
          </View>
        ) : null}

        {displayMessages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={stripDecisionMark(message.content)}
          />
        ))}

        {sending ? (
          streamingReply ? (
            <MessageBubble
              role="assistant"
              content={stripDecisionMark(streamingReply)}
            />
          ) : (
            <View style={{ paddingVertical: spacing.sm }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.md),
          backgroundColor: colors.background,
        }}>
        {sendError ? (
          <Text
            selectable
            style={{
              color: colors.danger,
              marginBottom: spacing.sm,
              paddingHorizontal: spacing.xs,
            }}>
            {sendError}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: spacing.sm,
            backgroundColor: colors.surface,
            borderRadius: 26,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
          }}>
          <TextInput
            accessibilityLabel="回复"
            multiline
            onChangeText={setDraft}
            placeholder="回复…"
            placeholderTextColor={colors.textTertiary}
            value={draft}
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 40,
              paddingHorizontal: spacing.xs,
              paddingTop: 10,
              paddingBottom: 10,
              color: colors.textPrimary,
              fontSize: 16,
              lineHeight: 22,
              textAlignVertical: 'top',
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              marginBottom: 2,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: canSend ? colors.accent : colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            })}>
            {sending ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Host matchContents>
                <Icon
                  name={sendIcon}
                  size={18}
                  color={canSend ? colors.onDark : colors.textTertiary}
                />
              </Host>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MessageBubble({
  role,
  content,
}: {
  role: 'user' | 'assistant';
  content: string;
}) {
  const fromUser = role === 'user';
  return (
    <View
      style={{
        maxWidth: fromUser ? '82%' : '100%',
        alignSelf: fromUser ? 'flex-end' : 'stretch',
        paddingHorizontal: fromUser ? 14 : 0,
        paddingVertical: fromUser ? 11 : 2,
        borderRadius: fromUser ? 18 : 0,
        backgroundColor: fromUser ? colors.accentSoft : 'transparent',
      }}>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          lineHeight: 24,
          fontSize: 16,
        }}>
        {content}
      </Text>
    </View>
  );
}
