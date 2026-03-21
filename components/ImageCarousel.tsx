import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";

import { AppThemeColors, useAppThemeColors } from "@/components/theme";

export type CarouselImageItem = {
  uri: string;
};

type Props = {
  items: CarouselImageItem[];
  height?: number;
  aspectRatio?: number;
  borderRadius?: number;
  onDownload?: (uri: string) => void;
  downloadingUri?: string | null;
  onPressItem?: (uri: string, index: number) => void;
};

export default function ImageCarousel({
  items,
  height,
  aspectRatio,
  borderRadius = 12,
  onDownload,
  downloadingUri,
  onPressItem,
}: Props) {
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors, borderRadius), [themeColors, borderRadius]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [width, setWidth] = useState(0);

  if (!items.length) return null;

  const activeItem = items[Math.min(activeIndex, items.length - 1)];
  const showDownload = typeof onDownload === "function" && !!activeItem?.uri;
  const isDownloading = !!activeItem?.uri && downloadingUri === activeItem.uri;

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== width) {
      setWidth(nextWidth);
    }
  };

  return (
    <View
      style={[
        styles.container,
        height ? { height } : aspectRatio ? { aspectRatio } : null,
      ]}
      onLayout={onLayout}
    >
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.uri}-${index}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        onMomentumScrollEnd={(event) => {
          const nextWidth = width || event.nativeEvent.layoutMeasurement.width || 1;
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / nextWidth);
          setActiveIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
        }}
        renderItem={({ item, index }) => (
          <Pressable
            style={[styles.slide, width ? { width } : styles.slideFill]}
            onPress={() => onPressItem?.(item.uri, index)}
          >
            <ExpoImage
              source={{ uri: item.uri }}
              style={styles.image}
              contentFit="cover"
              transition={180}
              cachePolicy="memory-disk"
            />
          </Pressable>
        )}
      />

      {showDownload ? (
        <Pressable
          style={[styles.downloadButton, isDownloading && styles.downloadButtonBusy]}
          onPress={() => activeItem?.uri && onDownload?.(activeItem.uri)}
          disabled={isDownloading}
          hitSlop={12}
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <FontAwesome name="download" size={20} color="#fff" />
          )}
        </Pressable>
      ) : null}

      {items.length > 1 ? (
        <View style={styles.dots}>
          {items.map((item, index) => (
            <View
              key={`${item.uri}-dot-${index}`}
              style={[styles.dot, index === activeIndex && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: AppThemeColors, borderRadius: number) =>
  StyleSheet.create({
    container: {
      width: "100%",
      overflow: "hidden",
      borderRadius,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      position: "relative",
    },
    slide: {
      height: "100%",
    },
    slideFill: {
      flex: 1,
    },
    image: {
      width: "100%",
      height: "100%",
    },
    dots: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 10,
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: "rgba(255,255,255,0.45)",
    },
    dotActive: {
      backgroundColor: "#fff",
      width: 18,
    },
    downloadButton: {
      position: "absolute",
      right: 8,
      top: 8,
      backgroundColor: "rgba(0,0,0,0.6)",
      minWidth: 40,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      padding: 8,
      borderRadius: 999,
    },
    downloadButtonBusy: {
      backgroundColor: "rgba(0,0,0,0.78)",
    },
  });
