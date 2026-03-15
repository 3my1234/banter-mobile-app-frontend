import React, { useCallback, useEffect, useMemo, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColorScheme } from "@/components/useColorScheme";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { apiFetch } from "@/lib/api";
import {
  decrementNotificationUnreadCount,
  getNotificationUnreadCount,
  incrementNotificationUnreadCount,
  setNotificationUnreadCount,
  subscribeNotificationUnreadCount,
} from "@/lib/notificationBadge";
import { getSocket } from "@/lib/socket";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={24} {...props} />;
}

function HorizontalTabBar({
  state,
  descriptors,
  navigation,
  notificationUnread,
  messageUnread,
}: BottomTabBarProps & { notificationUnread: number; messageUnread: number }) {
  const insets = useSafeAreaInsets();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const visibleRoutes = useMemo(
    () => state.routes.filter((route) => route.name !== "compose"),
    [state.routes]
  );

  return (
    <View style={[styles.tabBarWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarScroll}
      >
        {visibleRoutes.map((route) => {
          const routeIndex = state.routes.findIndex((r) => r.key === route.key);
          const isFocused = state.index === routeIndex;
          const descriptor = descriptors[route.key];
          const options = descriptor.options;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              (navigation as any).navigate(route.name, route.params);
            }
          };

          const icon =
            typeof options.tabBarIcon === "function"
              ? options.tabBarIcon({
                  focused: isFocused,
                  color: themeColors.text,
                  size: 24,
                })
              : null;
          const badgeCount =
            route.name === "notifications"
              ? notificationUnread
              : route.name === "messages"
                ? messageUnread
                : 0;

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.tabItem}>
              <View style={styles.iconWrap}>
                {icon}
                {badgeCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badgeCount > 99 ? "99+" : String(badgeCount)}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function TabLayout() {
  useColorScheme();
  const [notificationUnread, setNotificationUnread] = useState(getNotificationUnreadCount());
  const [messageUnread] = useState(0);

  const loadNotificationUnread = useCallback(async () => {
    try {
      const response = await apiFetch("/notifications?unreadOnly=1&limit=100");
      const items = Array.isArray(response?.notifications) ? response.notifications : [];
      setNotificationUnreadCount(items.length);
    } catch {
      // keep last value
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeNotificationUnreadCount(setNotificationUnread);
    return unsubscribe;
  }, []);

  useEffect(() => {
    loadNotificationUnread();
    const retry = setTimeout(loadNotificationUnread, 1500);
    let socket: any;
    let disposed = false;
    const setup = async () => {
      try {
        socket = await getSocket();
        if (disposed || !socket) return;
        socket.emit("notifications.subscribe");
        socket.on("notifications.new", () => {
          incrementNotificationUnreadCount(1);
        });
        socket.on("notifications.read", () => {
          decrementNotificationUnreadCount(1);
        });
        socket.on("notifications.read_all", () => {
          setNotificationUnreadCount(0);
        });
      } catch {
        // ignore
      }
    };

    setup();
    return () => {
      clearTimeout(retry);
      disposed = true;
      if (socket) {
        socket.off("notifications.new");
        socket.off("notifications.read");
        socket.off("notifications.read_all");
      }
    };
  }, [loadNotificationUnread]);

  useEffect(() => {
    const onAppStateChange = (nextState: string) => {
      if (nextState === "active") {
        loadNotificationUnread();
      }
    };
    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => {
      sub.remove();
    };
  }, [loadNotificationUnread]);

  return (
    <Tabs
      tabBar={(props) => (
        <HorizontalTabBar
          {...props}
          notificationUnread={notificationUnread}
          messageUnread={messageUnread}
        />
      )}
      screenOptions={{
        tabBarShowLabel: false,
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="votes"
        options={{
          title: "Votes",
          tabBarIcon: ({ color }) => <TabBarIcon name="ticket" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="pca"
        options={{
          title: "PCA",
          tabBarIcon: ({ color }) => <TabBarIcon name="trophy" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <TabBarIcon name="envelope" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarIcon: ({ color }) => <TabBarIcon name="bell" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="bot"
        options={{
          title: "Bot",
          tabBarIcon: ({ color }) => <TabBarIcon name="android" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
  tabBarWrap: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tabBarScroll: {
    paddingHorizontal: 12,
    gap: 18,
  },
  tabItem: {
    paddingVertical: 6,
    minWidth: 52,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 3,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#ff3b30",
    borderWidth: 1,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    includeFontPadding: false,
  },
});
