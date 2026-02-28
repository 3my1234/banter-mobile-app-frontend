import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Text } from "@/components/Themed";

type CenteredHeartbeatLoaderProps = {
  visible: boolean;
  text?: string;
  overlay?: boolean;
};

export default function CenteredHeartbeatLoader({
  visible,
  text,
  overlay = true,
}: CenteredHeartbeatLoaderProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 360,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.94,
          duration: 280,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, visible]);

  const containerStyle = useMemo(
    () => [styles.wrap, overlay ? styles.overlay : null],
    [overlay]
  );

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={containerStyle}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <ExpoImage
          source={require("../assets/images/logo.jpg")}
          style={styles.logo}
          contentFit="cover"
          transition={0}
        />
      </Animated.View>
      {text ? <Text style={styles.text}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: "rgba(13,13,13,0.88)",
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 12,
  },
  text: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "600",
  },
});
