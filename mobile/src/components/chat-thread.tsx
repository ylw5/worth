import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EvaluationComposer } from '@/components/evaluation-composer';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { PurchaseOutcomeControls } from '@/components/purchase-outcome-controls';
import { colors, radius, spacing } from '@/constants/colors';
import {
  createAgentMessage,
  createAgentThread,
  listAgentMessages,
  updateAgentThreadTitle,
  type AgentMessage,
} from '@/lib/agent-chat';
import {
  analyzeProductPhotos,
  chatFreely,
  evaluatePurchase,
  normalizeProductText,
  parseProduct,
  streamPurchaseEvaluation,
} from '@/lib/api';
import { removePhotos, uploadPhotos } from '@/lib/assets';
import {
  extractProductPrice,
  normalizeProductDescription,
  normalizeProductUrl,
} from '@/lib/evaluation-input';
import {
  createPurchaseEvaluation,
  listEvaluationAssets,
  listEvaluationsForThread,
  productFromEvaluation,
  stripDecisionMark,
  type EvaluationChatMessage,
  type ParsedProduct,
  type PurchaseEvaluation,
} from '@/lib/evaluations';
import type { AssetPhoto } from '@/lib/photos';
import {
  confirmSpendingResolution,
  listSpendingResolutionsForThread,
  saveEvaluationReply,
  type SpendingResolution,
} from '@/lib/spending-resolutions';
import { useSession } from '@/providers/session-provider';

const formatResolutionAmount = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

function evaluationIdFromMessage(message: AgentMessage): string | null {
  const value = message.route_result?.evaluation_id;
  return typeof value === 'string' ? value : null;
}

function latestActiveEvaluationId(messages: AgentMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const evaluationId = evaluationIdFromMessage(messages[index]!);
    if (evaluationId) return evaluationId;
  }
  return null;
}

/** Last assistant message per evaluation — inline outcome controls mount here. */
function outcomeControlMessageIds(
  messages: AgentMessage[],
  evaluationsById: Map<string, PurchaseEvaluation>,
): Set<string> {
  const ids = new Set<string>();
  const seenEvaluations = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== 'assistant') continue;
    const evaluationId = evaluationIdFromMessage(message);
    if (!evaluationId || seenEvaluations.has(evaluationId)) continue;
    seenEvaluations.add(evaluationId);
    const evaluation = evaluationsById.get(evaluationId);
    if (!evaluation) continue;
    if (
      evaluation.decision === 'buy' ||
      evaluation.decision === 'skip' ||
      evaluation.user_choice === 'pending'
    ) {
      ids.add(message.id);
    }
  }
  return ids;
}

export function ChatThread(props: {
  threadId: string | null;
  onThreadIdChange: (threadId: string) => void;
  onTitleChange?: (title: string) => void;
}): ReactElement {
  const { threadId, onThreadIdChange, onTitleChange } = props;
  const { session } = useSession();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [confirmingResolutionId, setConfirmingResolutionId] = useState<
    string | null
  >(null);
  const [resolutionError, setResolutionError] = useState('');

  const messagesQuery = useQuery({
    queryKey: ['agent-messages', threadId],
    queryFn: () => listAgentMessages(threadId!),
    enabled: Boolean(threadId),
  });
  const evaluationsQuery = useQuery({
    queryKey: ['thread-evaluations', threadId],
    queryFn: () => listEvaluationsForThread(threadId!),
    enabled: Boolean(threadId),
  });
  const resolutionsQuery = useQuery({
    queryKey: ['thread-resolutions', threadId],
    queryFn: () => listSpendingResolutionsForThread(threadId!),
    enabled: Boolean(threadId),
  });

  const messages = messagesQuery.data ?? [];
  const evaluations = evaluationsQuery.data ?? [];
  const resolutions = resolutionsQuery.data ?? [];

  const evaluationsById = new Map(
    evaluations.map((evaluation) => [evaluation.id, evaluation]),
  );
  const resolutionsByMessageId = new Map(
    resolutions.map((resolution) => [resolution.message_id, resolution]),
  );
  const outcomeMessageIds = outcomeControlMessageIds(messages, evaluationsById);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft('');
      setPhotos([]);
      setSendError('');
      setStreamingReply('');
      setResolutionError('');
      setConfirmingResolutionId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [threadId]);

  useEffect(() => {
    const latest = evaluations[evaluations.length - 1];
    if (latest?.product_title) onTitleChange?.(latest.product_title);
  }, [evaluations, onTitleChange]);

  useEffect(() => {
    if (!messages.length && !sending) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages.length, sending, streamingReply, threadId]);

  useEffect(() => {
    const showEvent =
      process.env.EXPO_OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      process.env.EXPO_OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const invalidateThread = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['agent-messages', id] }),
      queryClient.invalidateQueries({ queryKey: ['thread-evaluations', id] }),
      queryClient.invalidateQueries({ queryKey: ['thread-resolutions', id] }),
      queryClient.invalidateQueries({ queryKey: ['agent-threads'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-evaluations'] }),
    ]);
  };

  const confirmResolution = async (resolution: SpendingResolution) => {
    if (resolution.confirmed_at || confirmingResolutionId) return;
    setConfirmingResolutionId(resolution.id);
    setResolutionError('');
    try {
      await confirmSpendingResolution(resolution.id);
      if (threadId) {
        await queryClient.invalidateQueries({
          queryKey: ['thread-resolutions', threadId],
        });
      }
    } catch {
      setResolutionError('确认失败，请重试');
    } finally {
      setConfirmingResolutionId(null);
    }
  };

  const freeChat = async (
    id: string,
    userId: string,
    history: EvaluationChatMessage[],
    fallbackReply?: string,
  ) => {
    const response = await chatFreely(history.slice(-100));
    await createAgentMessage(
      id,
      userId,
      'assistant',
      response.message || fallbackReply || '我在，慢慢说。',
    );
    await invalidateThread(id);
  };

  const createNewEvaluation = async (
    id: string,
    userId: string,
    product: ParsedProduct,
    imagePaths: string[],
  ) => {
    const assets = await listEvaluationAssets();
    const result = await evaluatePurchase(product, assets);
    const evaluation = await createPurchaseEvaluation(userId, id, result, {
      imagePaths,
    });
    const title = evaluation.product_title.trim().slice(0, 40) || '聊天';
    await updateAgentThreadTitle(id, title);
    onTitleChange?.(title);
    await invalidateThread(id);
    return evaluation;
  };

  const streamFollowUp = async (
    id: string,
    userId: string,
    evaluation: PurchaseEvaluation,
    history: EvaluationChatMessage[],
  ) => {
    const message = await streamPurchaseEvaluation(
      evaluation.id,
      productFromEvaluation(evaluation),
      evaluation.matched_assets,
      evaluation.facts,
      history.slice(-100),
      setStreamingReply,
    );
    await saveEvaluationReply(evaluation.id, message);
    await Promise.all([
      invalidateThread(id),
      queryClient.invalidateQueries({
        queryKey: ['purchase-evaluation', evaluation.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['spending-resolution', evaluation.id],
      }),
    ]);
  };

  const send = async () => {
    if (!session || sending) return;
    const text = draft.trim();
    if (!text && !photos.length) {
      setSendError('请描述商品、粘贴链接，或添加一张图片');
      return;
    }
    if (text.length > 8000) {
      setSendError('单条消息不能超过 8000 字');
      return;
    }

    const pendingPhotos = photos;
    setSending(true);
    setSendError('');
    setDraft('');
    setPhotos([]);
    setStreamingReply('');

    let uploadedPaths: string[] = [];
    let createdEvaluation = false;
    try {
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const thread = await createAgentThread(
          session.user.id,
          text.slice(0, 40) || '聊天',
        );
        currentThreadId = thread.id;
        onThreadIdChange(thread.id);
        await queryClient.invalidateQueries({ queryKey: ['agent-threads'] });
      }

      const userContent = text || '看看这件商品';
      await createAgentMessage(
        currentThreadId,
        session.user.id,
        'user',
        userContent,
      );
      await queryClient.invalidateQueries({
        queryKey: ['agent-messages', currentThreadId],
      });

      const threadMessages = await listAgentMessages(currentThreadId);
      const threadEvaluations =
        evaluationsQuery.data ??
        (await listEvaluationsForThread(currentThreadId));
      const history: EvaluationChatMessage[] = threadMessages.map(
        ({ role, content }) => ({ role, content }),
      );
      const activeEvaluationId = latestActiveEvaluationId(threadMessages);
      const activeEvaluation =
        threadEvaluations.find((item) => item.id === activeEvaluationId) ??
        null;

      if (pendingPhotos.length) {
        const uploaded = await uploadPhotos(
          pendingPhotos.map((photo) => photo.base64 ?? ''),
          session.user.id,
        );
        uploadedPaths = uploaded.map((photo) => photo.path);
        const recognized = await analyzeProductPhotos(
          uploaded.map((photo) => photo.signedUrl),
        );
        const product: ParsedProduct = {
          ...recognized,
          price: recognized.price ?? extractProductPrice(text),
          source_text: text,
        };
        await createNewEvaluation(
          currentThreadId,
          session.user.id,
          product,
          uploadedPaths,
        );
        createdEvaluation = true;
        return;
      }

      const normalizedUrl = normalizeProductUrl(text);
      if ('url' in normalizedUrl) {
        const product = await parseProduct(normalizedUrl.url);
        await createNewEvaluation(
          currentThreadId,
          session.user.id,
          product,
          [],
        );
        createdEvaluation = true;
        return;
      }

      const description = normalizeProductDescription(text);
      if (!('error' in description)) {
        const interpreted = await normalizeProductText(
          description.text,
          extractProductPrice(description.text),
        );
        if (interpreted.intent === 'product' && interpreted.product) {
          await createNewEvaluation(
            currentThreadId,
            session.user.id,
            interpreted.product,
            [],
          );
          createdEvaluation = true;
          return;
        }
        if (interpreted.intent === 'chat') {
          await freeChat(
            currentThreadId,
            session.user.id,
            history,
            interpreted.reply,
          );
          return;
        }

        // Product follow-up: active eval + non-chat turn only.
        if (activeEvaluation) {
          await streamFollowUp(
            currentThreadId,
            session.user.id,
            activeEvaluation,
            history,
          );
          return;
        }
      }

      // Short/invalid text (or no active eval): free chat — avoid orphan bubbles.
      await freeChat(currentThreadId, session.user.id, history);
    } catch (caught) {
      if (!createdEvaluation && uploadedPaths.length) {
        await removePhotos(uploadedPaths).catch(() => undefined);
      }
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

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.md,
          paddingBottom: spacing.lg,
          gap: spacing.lg,
        }}>
        {threadId && messagesQuery.isLoading && !sending ? (
          <LoadingState />
        ) : null}
        {threadId && messagesQuery.error ? (
          <ErrorState message={messagesQuery.error.message} />
        ) : null}

        {messages.map((message) => {
          const resolution = resolutionsByMessageId.get(message.id);
          const showOutcome =
            message.role === 'assistant' && outcomeMessageIds.has(message.id);
          const evaluation = showOutcome
            ? evaluationsById.get(evaluationIdFromMessage(message) ?? '')
            : undefined;

          return (
            <View key={message.id} style={{ gap: spacing.sm }}>
              <MessageBubble
                role={message.role}
                content={stripDecisionMark(message.content)}
              />
              {message.role === 'assistant' && resolution ? (
                <SpendingResolutionCard
                  resolution={resolution}
                  confirming={confirmingResolutionId === resolution.id}
                  error={
                    confirmingResolutionId === resolution.id
                      ? resolutionError
                      : ''
                  }
                  onConfirm={() => confirmResolution(resolution)}
                />
              ) : null}
              {evaluation ? (
                <PurchaseOutcomeControls evaluation={evaluation} />
              ) : null}
            </View>
          );
        })}

        {sending ? (
          streamingReply ? (
            <MessageBubble
              role="assistant"
              content={stripDecisionMark(streamingReply)}
            />
          ) : (
            <ThinkingShimmer />
          )
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: keyboardVisible ? spacing.sm : spacing.xl,
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
        <EvaluationComposer
          value={draft}
          photos={photos}
          loading={sending}
          accessibilityLabel="描述商品、粘贴链接或继续对话"
          onChangeText={setDraft}
          onChangePhotos={setPhotos}
          onError={setSendError}
          onSubmit={send}
        />
      </View>
    </View>
  );
}

const THINKING_LABEL = '正在思考';

function ThinkingShimmer() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: 1600,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
  }, [progress]);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={THINKING_LABEL}
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-start',
        paddingVertical: spacing.sm,
      }}>
      {THINKING_LABEL.split('').map((char, index) => (
        <ThinkingShimmerChar
          key={`${char}-${index}`}
          char={char}
          index={index}
          progress={progress}
        />
      ))}
    </View>
  );
}

function ThinkingShimmerChar({
  char,
  index,
  progress,
}: {
  char: string;
  index: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const peak = progress.value * (THINKING_LABEL.length + 1) - 0.5;
    const distance = Math.abs(index - peak);
    const highlight = Math.max(0, 1 - distance);
    return {
      color: interpolateColor(
        highlight,
        [0, 1],
        [colors.textTertiary, colors.textPrimary],
      ),
    };
  });

  return (
    <Animated.Text
      style={[
        {
          fontSize: 16,
          lineHeight: 24,
        },
        style,
      ]}>
      {char}
    </Animated.Text>
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

function SpendingResolutionCard({
  resolution,
  confirming,
  error,
  onConfirm,
}: {
  resolution: SpendingResolution;
  confirming: boolean;
  error: string;
  onConfirm: () => void;
}) {
  const amount = formatResolutionAmount(resolution.amount);
  const confirmedAt = resolution.confirmed_at;
  const confirmed = confirmedAt !== null;

  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            lineHeight: 20,
            fontVariant: ['tabular-nums'],
          }}>
          {confirmed ? `已忍住 ${amount}` : '这次先不买'}
        </Text>
        {confirmed ? (
          <Text
            selectable
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontVariant: ['tabular-nums'],
            }}>
            {new Date(confirmedAt).toLocaleString('zh-CN')}
          </Text>
        ) : (
          <Text
            selectable
            style={{
              color: colors.textPrimary,
              fontSize: 24,
              fontWeight: '700',
              lineHeight: 32,
              fontVariant: ['tabular-nums'],
            }}>
            留下 {amount}
          </Text>
        )}
      </View>

      {!confirmed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`确认不买，留下${amount}`}
          accessibilityState={{ disabled: confirming }}
          disabled={confirming}
          onPress={onConfirm}
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.medium,
            borderCurve: 'continuous',
            backgroundColor: colors.textPrimary,
            opacity: pressed || confirming ? 0.7 : 1,
          })}>
          {confirming ? (
            <ActivityIndicator color={colors.onDark} size="small" />
          ) : (
            <Text
              style={{
                color: colors.onDark,
                fontSize: 16,
                fontWeight: '600',
              }}>
              确认不买
            </Text>
          )}
        </Pressable>
      ) : null}

      {error ? (
        <Text selectable style={{ color: colors.danger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
