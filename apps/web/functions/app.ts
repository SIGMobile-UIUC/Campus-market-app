// /app installs the latest build for the visitor's phone: the preview APK (INF-5), or the iOS link once
// the Apple account exists. Point these at each new build.
const ANDROID = "https://expo.dev/artifacts/eas/Ig97_p6TEmo62kx3uMjQ53ruc5jw0L0i0R0jB0OTEBo.apk";
const IOS = "";

export function onRequest({ request }: { request: Request }) {
  const ios = /iphone|ipad|ipod/i.test(request.headers.get("user-agent") ?? "");
  return Response.redirect(ios && IOS ? IOS : ANDROID, 302);
}
