export const colors = {
  background: '#FAFAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F1F4',
  textPrimary: '#0B0B0D',
  textSecondary: '#727278',
  textTertiary: '#B5B5BB',
  border: '#E6E6EA',
  accent: '#78B4FF',
  accentSoft: '#EDF6FF',
  onDark: '#FFFFFF',
  danger: '#C9362B',
  card: '#FFFFFF',
  text: '#0B0B0D',
  muted: '#727278',
  green: '#78B4FF',
  greenSoft: '#EDF6FF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const;

export const radius = {
  small: 12,
  medium: 16,
  large: 22,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '700' as const },
  pageTitle: { fontSize: 30, fontWeight: '700' as const },
  sectionTitle: { fontSize: 22, fontWeight: '700' as const },
  cardTitle: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;
