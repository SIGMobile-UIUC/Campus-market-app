import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import type { StyleProp } from "react-native";

import { forgetSignedUrl, signedUrl, type Bucket } from "@/lib/photoUrls";

// A private photo by object path: blurhash while loading, cached by path (the URL changes, the path
// never does), and one retry with a fresh URL when a cached one has expired.
export function Photo({
  path,
  bucket = "listing-photos",
  blurhash,
  style,
  accessibilityLabel,
}: {
  path: string;
  bucket?: Bucket;
  blurhash?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const [url, setUrl] = useState<{ path: string; url: string | null } | null>(null);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    void signedUrl(path, bucket).then((next) => setUrl({ path, url: next }));
  }, [path, bucket, retried]);

  const current = url?.path === path ? url.url : null;
  return (
    <Image
      source={current ? { uri: current, cacheKey: path } : null}
      placeholder={blurhash ? { blurhash } : null}
      style={style}
      contentFit="cover"
      transition={150}
      accessibilityLabel={accessibilityLabel}
      onError={() => {
        if (retried) return;
        forgetSignedUrl(path, bucket);
        setRetried(true);
      }}
    />
  );
}
