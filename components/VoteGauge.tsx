import React, { useMemo } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { StyleSheet, View } from "react-native";

type Props = {
  stayVotes: number;
  dropVotes: number;
};

const VoteGauge: React.FC<Props> = ({ stayVotes, dropVotes }) => {
  const total = stayVotes + dropVotes || 1;
  const stayPercent = stayVotes / total;
  const stayWidth = useSharedValue(stayPercent * 100);
  const dropWidth = useSharedValue((1 - stayPercent) * 100);
  const collisionLeft = useSharedValue(stayPercent * 100);

  useMemo(() => {
    const target = stayPercent * 100;
    stayWidth.value = withSpring(target, { stiffness: 140, damping: 18 });
    dropWidth.value = withSpring(100 - target, { stiffness: 140, damping: 18 });
    collisionLeft.value = withSpring(target, { stiffness: 220, damping: 24 });
  }, [stayPercent]);

  const stayStyle = useAnimatedStyle(() => ({
    width: `${stayWidth.value}%`,
  }));

  const dropStyle = useAnimatedStyle(() => ({
    width: `${dropWidth.value}%`,
  }));

  const collisionStyle = useAnimatedStyle(() => ({
    left: `${collisionLeft.value}%`,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.stay, stayStyle]} />
      <Animated.View style={[styles.drop, dropStyle]} />
      <Animated.View style={[styles.collision, collisionStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
    height: 12,
    width: "100%",
    backgroundColor: "#111",
    borderRadius: 999,
    overflow: "hidden",
  },
  stay: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#ff6b35",
    opacity: 0.9,
  },
  drop: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#00c6ff",
    opacity: 0.9,
  },
  collision: {
    position: "absolute",
    top: -6,
    width: 4,
    height: 24,
    backgroundColor: "#fff",
    shadowColor: "#fff",
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});

export default VoteGauge;
