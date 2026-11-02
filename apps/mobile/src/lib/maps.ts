import { Linking, Platform } from "react-native";

// Opens a place in the phone's maps app (Apple Maps on iOS, the default app on Android), or Google Maps in
// the browser when no app takes the link. A meetup spot's coordinates pin it; a typed place is a search.
export function openInMaps(place: string, at?: { lat: number; lng: number }) {
  const q = encodeURIComponent(place);
  const app =
    Platform.OS === "ios"
      ? `maps://?q=${q}${at ? `&ll=${at.lat},${at.lng}` : ""}`
      : at
        ? `geo:${at.lat},${at.lng}?q=${at.lat},${at.lng}(${q})`
        : `geo:0,0?q=${q}`;
  const web = `https://www.google.com/maps/search/?api=1&query=${at ? `${at.lat},${at.lng}` : q}`;
  Linking.openURL(app).catch(() => Linking.openURL(web));
}
