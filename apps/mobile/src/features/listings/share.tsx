import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRef } from "react";
import { Modal, Pressable, Share, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { track } from "@/lib/analytics";
import { Button } from "@/ui/Button";

// Share links (LST-11): campusmarket.trade/l/<share_code> opens the listing in the app, or on the web.
export const shareUrl = (code: string) => `https://campusmarket.trade/l/${code}`;

type Shared = { id: string; share_code: string; title: string };

export function shareLink(listing: Shared) {
  track("share", { listing_id: listing.id, method: "link" });
  void Share.share({ message: shareUrl(listing.share_code) });
}

// The same link as a QR code, black on white with the app icon in the middle, to scan from the screen
// or share as an image. High error correction keeps it readable under the icon and in print.
export function QrSheet({
  listing,
  subtitle,
  onClose,
}: {
  listing: Shared | null;
  subtitle: string;
  onClose: () => void;
}) {
  const qr = useRef<{ toDataURL: (done: (base64: string) => void) => void } | null>(null);
  const shareImage = () =>
    qr.current?.toDataURL((base64) => {
      if (!listing) return;
      const file = new File(Paths.cache, `campus-market-${listing.share_code}.png`);
      file.write(base64, { encoding: "base64" });
      track("share", { listing_id: listing.id, method: "qr_image" });
      void Sharing.shareAsync(file.uri, { mimeType: "image/png" });
    });

  return (
    <Modal visible={!!listing} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-8">
        <Pressable accessibilityLabel="Close QR code" className="absolute inset-0" onPress={onClose} />
        {listing ? (
          <View className="w-full items-center gap-4 rounded-3xl bg-bg p-6">
            <View className="overflow-hidden rounded-2xl">
              <QRCode
                value={shareUrl(listing.share_code)}
                size={240}
                ecl="H"
                quietZone={16}
                logo={require("../../../assets/icon-round.png")}
                logoSize={60}
                getRef={(ref) => (qr.current = ref)}
              />
            </View>
            <View className="items-center gap-1">
              <Text className="text-center text-lg font-extrabold text-ink" numberOfLines={2}>
                {listing.title}
              </Text>
              <Text className="text-[15px] text-muted">{subtitle}</Text>
            </View>
            <View className="w-full gap-2">
              <Button label="Share image" onPress={shareImage} />
              <Button variant="secondary" label="Done" onPress={onClose} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
