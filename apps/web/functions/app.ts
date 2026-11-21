// /app installs the latest build for the visitor's phone: the preview APK from the newest GitHub release
// (INF-5, made by the Android preview workflow), or the iOS link once the Apple account exists.
const ANDROID =
  "https://github.com/SIGMobile-UIUC/Campus-market-app/releases/latest/download/campus-market.apk";
const IOS = "";

export function onRequest({ request }: { request: Request }) {
  const ios = /iphone|ipad|ipod/i.test(request.headers.get("user-agent") ?? "");
  return Response.redirect(ios && IOS ? IOS : ANDROID, 302);
}
