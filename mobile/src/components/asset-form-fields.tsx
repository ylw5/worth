import { Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/colors';
import { categories, type AssetInput } from '@/types/domain';

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
      <View style={{ gap: 8 }}>
        <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
          分类
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => onChange({ ...form, category })}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 99,
                backgroundColor:
                  form.category === category ? colors.green : colors.greenSoft,
              }}>
              <Text
                style={{
                  color: form.category === category ? 'white' : colors.green,
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
      <Field
        label="估价搜索词"
        value={form.search_query}
        onChangeText={(search_query) => onChange({ ...form, search_query })}
      />
    </>
  );
}
