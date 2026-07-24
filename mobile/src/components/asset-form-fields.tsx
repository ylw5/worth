import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { PurchaseDateField } from '@/components/purchase-date-field';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { categories, type AssetInput } from '@/types/domain';

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
        {label}
      </Text>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        value={value}
        style={{
          minHeight: multiline ? 72 : 48,
          color: colors.textPrimary,
          ...typography.body,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.small,
          borderCurve: 'continuous',
          backgroundColor: colors.surface,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export function AssetFormFields({
  form,
  specsText,
  onChange,
  onChangeSpecsText,
}: {
  form: AssetInput;
  specsText: string;
  onChange: (form: AssetInput) => void;
  onChangeSpecsText: (value: string) => void;
}) {
  return (
    <>
      <Field
        label="名称"
        value={form.name}
        onChangeText={(name) => onChange({ ...form, name })}
      />
      <Field
        label="品牌"
        value={form.brand}
        onChangeText={(brand) => onChange({ ...form, brand })}
      />
      <Field
        label="型号"
        value={form.model}
        onChangeText={(model) => onChange({ ...form, model })}
      />
      <Field
        label="规格（每行“名称: 内容”）"
        multiline
        value={specsText}
        onChangeText={onChangeSpecsText}
      />
      <View style={{ gap: spacing.sm }}>
        <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
          分类
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => onChange({ ...form, category })}
              style={{
                height: 38,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  form.category === category
                    ? colors.textPrimary
                    : colors.surfaceMuted,
              }}>
              <Text
                style={{
                  color:
                    form.category === category
                      ? colors.onDark
                      : colors.textSecondary,
                  ...typography.label,
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
        onChangeText={(condition) => onChange({ ...form, condition })}
      />
      <PurchaseDateField
        value={form.purchase_date}
        onChange={(purchase_date) => onChange({ ...form, purchase_date })}
      />
      <Field
        label="实际买入价格（元，可选）"
        keyboardType="decimal-pad"
        value={form.purchase_price}
        onChangeText={(purchase_price) =>
          onChange({ ...form, purchase_price })
        }
      />
      <Field
        label="估价搜索词"
        value={form.search_query}
        onChangeText={(search_query) => onChange({ ...form, search_query })}
      />
    </>
  );
}
