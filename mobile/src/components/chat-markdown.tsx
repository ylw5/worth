import { Fragment, useMemo } from 'react';
import { View } from 'react-native';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';

import { colors, spacing } from '@/constants/colors';

const markdownTheme = {
  colors: {
    text: colors.textPrimary,
    link: colors.accent,
    code: colors.surfaceMuted,
    border: colors.border,
  },
  spacing: {
    xs: 2,
    s: 4,
    m: 6,
    l: spacing.md,
  },
} as const;

const markdownStyles: MarkedStyles = {
  text: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  paragraph: {
    paddingVertical: 2,
  },
  link: {
    color: colors.accent,
    fontStyle: 'normal',
    textDecorationLine: 'underline',
  },
  strong: {
    fontWeight: '600',
  },
  em: {
    fontStyle: 'italic',
  },
  codespan: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
  },
  code: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginVertical: spacing.xs,
  },
  blockquote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    opacity: 1,
  },
  h1: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    marginVertical: spacing.sm,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginVertical: spacing.sm,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    marginVertical: spacing.xs,
  },
  h4: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    marginVertical: spacing.xs,
  },
  h5: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    marginVertical: spacing.xs,
  },
  h6: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    marginVertical: spacing.xs,
  },
  li: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  list: {
    marginVertical: spacing.xs,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.md,
  },
  table: {
    borderColor: colors.border,
  },
  tableRow: {
    borderColor: colors.border,
  },
  tableCell: {
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
};

type ChatMarkdownProps = {
  content: string;
};

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const options = useMemo(
    () => ({
      colorScheme: 'light' as const,
      theme: markdownTheme,
      styles: markdownStyles,
    }),
    [],
  );

  const elements = useMarkdown(content, options);

  if (!content.trim()) {
    return null;
  }

  return (
    <View style={{ gap: 0 }}>
      {elements.map((element, index) => (
        <Fragment key={`md-${index}`}>{element}</Fragment>
      ))}
    </View>
  );
}
