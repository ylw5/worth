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
import { colors, radius, spacing } from '@/constants/colors';
import {
  createAgentMessage,
  createAgentThread,
  listAgentMessages,
  updateAgentThreadTitle,
} from '@/lib/agent-chat';
import { streamAgentChat } from '@/lib/api';
import { removePhotos, uploadPhotos } from '@/lib/assets';
import {
  listEvaluationsForThread,
  stripDecisionMark,
  type EvaluationChatMessage,
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

type ProcessStep =
  | { kind: 'status'; status: 'thinking' | 'replying' }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      phase: 'started' | 'completed';
    };

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
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
  const [streamingText, setStreamingText] = useState('');
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

  const resolutionsByMessageId = new Map(
    resolutions.map((resolution) => [resolution.message_id, resolution]),
  );

  const previousThreadIdRef = useRef(threadId);
  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    previousThreadIdRef.current = threadId;
    // null → id is usually mid-send thread creation; don't wipe errors.
    if (previousThreadId === null && threadId !== null) return;
    const timer = setTimeout(() => {
      setDraft('');
      setPhotos([]);
      setSendError('');
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
    if (!messages.length && !sending && !streamingText) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages.length, sending, streamingText, processSteps.length, threadId]);

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

    let uploadedPaths: string[] = [];
    let currentThreadId = threadId;
    try {
      if (!currentThreadId) {
        const title = text.slice(0, 40) || '聊天';
        const thread = await createAgentThread(session.user.id, title);
        currentThreadId = thread.id;
        onTitleChange?.(thread.title || title);
        onThreadIdChange(thread.id);
        await queryClient.invalidateQueries({ queryKey: ['agent-threads'] });
      }

      let imageUrls: string[] = [];
      if (pendingPhotos.length) {
        const uploaded = await uploadPhotos(
          pendingPhotos.map((photo) => photo.base64 ?? ''),
          session.user.id,
        );
        uploadedPaths = uploaded.map((photo) => photo.path);
        imageUrls = uploaded.map((photo) => photo.signedUrl);
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
      const history: EvaluationChatMessage[] = threadMessages.map(
        ({ role, content }) => ({
          role,
          content,
        }),
      );

      setProcessSteps([]);
      setStreamingText('');
      const response = await streamAgentChat(
        currentThreadId,
        history.slice(-100),
        imageUrls,
        {
          onStatus: (status) => {
            setProcessSteps((prev) => [...prev, { kind: 'status', status }]);
          },
          onTool: (tool) => {
            setProcessSteps((prev) => {
              if (tool.phase === 'completed') {
                return prev.map((step) =>
                  step.kind === 'tool' &&
                  step.name === tool.name &&
                  step.phase === 'started'
                    ? { ...step, phase: 'completed' }
                    : step,
                );
              }
              return [
                ...prev,
                {
                  kind: 'tool',
                  id: `${tool.name}-${prev.length}`,
                  name: tool.name,
                  label: tool.label,
                  phase: 'started',
                },
              ];
            });
          },
          onDelta: (full) => setStreamingText(full),
        },
      );

      if (response.evaluationId) {
        await saveEvaluationReply(response.evaluationId, response.message);
        const threadEvaluations =
          await listEvaluationsForThread(currentThreadId);
        const evaluation = threadEvaluations.find(
          (item) => item.id === response.evaluationId,
        );
        if (evaluation?.product_title) {
          const title =
            evaluation.product_title.trim().slice(0, 40) || '聊天';
          await updateAgentThreadTitle(currentThreadId, title);
          onTitleChange?.(title);
        }
      } else {
        await createAgentMessage(
          currentThreadId,
          session.user.id,
          'assistant',
          response.message || '我在，慢慢说。',
        );
      }

      await invalidateThread(currentThreadId);
    } catch (caught) {
      if (uploadedPaths.length) {
        await removePhotos(uploadedPaths).catch(() => undefined);
      }
      setProcessSteps([]);
      setStreamingText('');
      setSendError(
        caught instanceof Error
          ? caught.message
          : '消息已保存，但回复失败，请稍后重试',
      );
    } finally {
      setSending(false);
      setProcessSteps([]);
      setStreamingText('');
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
            </View>
          );
        })}

        {sending || processSteps.length ? (
          <AgentProcessPanel steps={processSteps} />
        ) : null}
        {streamingText ? (
          <MessageBubble
            role="assistant"
            content={stripDecisionMark(streamingText)}
          />
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

function AgentProcessPanel({ steps }: { steps: ProcessStep[] }) {
  if (!steps.length) {
    return <ThinkingShimmer />;
  }

  let lastStatusIndex = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]!.kind === 'status') {
      lastStatusIndex = index;
      break;
    }
  }

  return (
    <View style={{ gap: spacing.xs }}>
      {steps.map((step, index) => {
        if (step.kind === 'status') {
          const label =
            step.status === 'thinking' ? '正在思考' : '正在回复';
          if (index === lastStatusIndex) {
            return <ThinkingShimmer key={`status-${index}`} label={label} />;
          }
          return (
            <Text
              key={`status-${index}`}
              style={{
                color: colors.textTertiary,
                fontSize: 16,
                lineHeight: 24,
              }}>
              {label}
            </Text>
          );
        }
        const suffix =
          step.phase === 'started' ? '（进行中…）' : '（完成）';
        return (
          <Text
            key={step.id}
            style={{
              color: colors.textTertiary,
              fontSize: 16,
              lineHeight: 24,
            }}>
            {step.label}
            {suffix}
          </Text>
        );
      })}
    </View>
  );
}

function ThinkingShimmer({ label = THINKING_LABEL }: { label?: string }) {
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
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-start',
        paddingVertical: spacing.sm,
      }}>
      {label.split('').map((char, index) => (
        <ThinkingShimmerChar
          key={`${char}-${index}`}
          char={char}
          index={index}
          progress={progress}
          labelLength={label.length}
        />
      ))}
    </View>
  );
}

function ThinkingShimmerChar({
  char,
  index,
  progress,
  labelLength,
}: {
  char: string;
  index: number;
  progress: SharedValue<number>;
  labelLength: number;
}) {
  const style = useAnimatedStyle(() => {
    const peak = progress.value * (labelLength + 1) - 0.5;
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
