import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Legacy detail route: conversations now open in-place on the chat tab.
 */
export default function EvaluationDetailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/(tabs)/(evaluation)" />;
  return (
    <Redirect
      href={{
        pathname: '/(tabs)/(evaluation)',
        params: { id },
      }}
    />
  );
}
