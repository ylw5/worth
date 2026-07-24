import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import { Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  type ColorValue,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { colors } from '@/constants/colors';

const ICON_SIZE = 22;
const TAB_BAR_CONTENT_HEIGHT = 52;

function TabIcon({
  ios,
  android,
  color,
  size = ICON_SIZE,
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
  color: ColorValue;
  size?: number;
}) {
  return (
    <SymbolView
      name={{ ios, android, web: android }}
      size={size}
      tintColor={color}
    />
  );
}

function TabBarButton({
  style,
  children,
  onPress,
  onLongPress,
  accessibilityState,
  accessibilityLabel,
  testID,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  onPress?:
    | ((event: GestureResponderEvent) => void)
    | null;
  onLongPress?:
    | ((event: GestureResponderEvent) => void)
    | null;
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | 'mixed';
    busy?: boolean;
    expanded?: boolean;
  };
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress ?? undefined}
      onLongPress={onLongPress ?? undefined}
      android_ripple={null}
      style={[style, styles.tabButton]}>
      {children}
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarStyle: {
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingTop: 0,
          paddingBottom: insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          height: TAB_BAR_CONTENT_HEIGHT,
          paddingTop: 0,
          paddingBottom: 0,
        },
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarButton: (props) => (
          <TabBarButton
            accessibilityState={props.accessibilityState}
            accessibilityLabel={props['aria-label']}
            testID={props.testID}
            onPress={props.onPress}
            onLongPress={props.onLongPress}
            style={props.style as StyleProp<ViewStyle>}>
            {props.children}
          </TabBarButton>
        ),
      }}>
      <Tabs.Screen
        name="(assets)"
        options={{
          title: '资产',
          tabBarIcon: ({ color }) => (
            <TabIcon ios="archivebox.fill" android="inventory_2" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(wishlist)"
        options={{
          title: '心愿单',
          tabBarIcon: ({ color }) => (
            <TabIcon ios="heart.fill" android="favorite" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(evaluation)"
        options={{
          title: '评估',
          tabBarIcon: ({ color }) => (
            <TabIcon ios="magnifyingglass" android="search" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(chat)"
        options={{
          title: '聊天',
          tabBarIcon: ({ color }) => (
            <TabIcon ios="bubble.left.fill" android="chat_bubble" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(account)"
        options={{
          title: '账号',
          tabBarIcon: ({ color }) => (
            <TabIcon
              ios="person.fill"
              android="person"
              color={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen name="(capture)" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
