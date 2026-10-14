import type { ReactNode } from "react";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Rect } from "react-native-svg";

// Equipped items by slot, as asset keys (get_my_account().avatar, avatar_loadout).
export type Loadout = Partial<Record<"background" | "top" | "face" | "head", string>>;

const INK = "#2B2B2B";
const BODY = "#FFF6EA";

// Bundled SVG layers by asset_key (spec 4.14). A mascot rather than a person, so no skin tone or gender
// is implied. ponytail: placeholder art drawn in code; a designer's layers replace these keys one to one.
const BACKGROUNDS: Record<string, string> = {
  bg_sky: "#CDE8FF",
  bg_mint: "#C9F2DD",
  bg_peach: "#FFDCC8",
  bg_lilac: "#E4D9FF",
  bg_sun: "#FFF1A8",
  bg_rose: "#FFD6E0",
};

const TOPS: Record<string, { style: "hoodie" | "tee" | "sweater"; color: string }> = {
  top_hoodie_navy: { style: "hoodie", color: "#2F4B7C" },
  top_tee_orange: { style: "tee", color: "#F28C38" },
  top_hoodie_green: { style: "hoodie", color: "#3F8F5A" },
  top_tee_purple: { style: "tee", color: "#7B5CC4" },
  top_sweater_red: { style: "sweater", color: "#C8443B" },
  top_tee_teal: { style: "tee", color: "#2C9C9A" },
};

const FACES: Record<string, ReactNode> = {
  face_smile: (
    <G>
      <Ellipse cx={43} cy={45} rx={2.2} ry={3} fill={INK} />
      <Ellipse cx={57} cy={45} rx={2.2} ry={3} fill={INK} />
      <Path d="M44 53 Q50 58 56 53" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
    </G>
  ),
  face_grin: (
    <G>
      <Ellipse cx={43} cy={45} rx={2.2} ry={3} fill={INK} />
      <Ellipse cx={57} cy={45} rx={2.2} ry={3} fill={INK} />
      <Path d="M43 52 Q50 61 57 52 Z" fill={INK} />
    </G>
  ),
  face_wink: (
    <G>
      <Path d="M40 46 Q43 43 46 46" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
      <Ellipse cx={57} cy={45} rx={2.2} ry={3} fill={INK} />
      <Path d="M44 53 Q50 58 56 53" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
    </G>
  ),
};

const HEADS: Record<string, ReactNode> = {
  head_beanie: (
    <G>
      <Path d="M28 40 C28 20 72 20 72 40 Z" fill="#3B5BA5" stroke={INK} strokeWidth={2} />
      <Rect x={26} y={35} width={48} height={8} rx={4} fill="#5F7FC9" stroke={INK} strokeWidth={2} />
      <Circle cx={50} cy={20} r={4.5} fill="#F2F2F2" stroke={INK} strokeWidth={2} />
    </G>
  ),
  head_cap: (
    <G>
      <Path d="M29 35 C29 19 71 19 71 35 Z" fill="#E5533D" stroke={INK} strokeWidth={2} />
      <Path d="M52 35 L80 35 Q83 39 77 39 L52 39 Z" fill="#E5533D" stroke={INK} strokeWidth={2} />
    </G>
  ),
  head_sprout: (
    <G>
      <Line x1={50} y1={25} x2={50} y2={14} stroke="#3E8E4A" strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M50 17 C44 9 36 11 37 16 C41 20 47 19 50 17 Z" fill="#5BBF6A" stroke={INK} strokeWidth={1.5} />
      <Path d="M50 15 C56 7 64 9 63 14 C59 18 53 17 50 15 Z" fill="#5BBF6A" stroke={INK} strokeWidth={1.5} />
    </G>
  ),
  head_headphones: (
    <G>
      <Path d="M27 46 C27 17 73 17 73 46" stroke={INK} strokeWidth={4} fill="none" />
      <Rect x={22} y={40} width={9} height={15} rx={4} fill="#4A4A4A" stroke={INK} strokeWidth={2} />
      <Rect x={69} y={40} width={9} height={15} rx={4} fill="#4A4A4A" stroke={INK} strokeWidth={2} />
    </G>
  ),
  head_bow: (
    <G>
      <Path d="M64 27 L55 21 L55 33 Z" fill="#FF6F91" stroke={INK} strokeWidth={1.5} />
      <Path d="M64 27 L73 21 L73 33 Z" fill="#FF6F91" stroke={INK} strokeWidth={1.5} />
      <Circle cx={64} cy={27} r={2.8} fill="#E04D75" stroke={INK} strokeWidth={1.5} />
    </G>
  ),
  head_gradcap: (
    <G>
      <Rect x={37} y={27} width={26} height={8} fill={INK} />
      <Path d="M50 17 L77 26 L50 35 L23 26 Z" fill={INK} />
      <Path d="M50 26 L70 29 L70 40" stroke="#FFC83D" strokeWidth={2} fill="none" strokeLinecap="round" />
    </G>
  ),
};

function Top({ assetKey }: { assetKey?: string }) {
  const top = assetKey ? TOPS[assetKey] : undefined;
  const color = top?.color ?? "#9AA0A6";
  return (
    <G>
      <Path d="M14 104 C14 82 30 72 50 72 C70 72 86 82 86 104 Z" fill={color} stroke={INK} strokeWidth={2} />
      {top?.style === "hoodie" ? (
        <G stroke={INK} strokeWidth={1.5} strokeLinecap="round">
          <Line x1={45} y1={76} x2={44} y2={88} />
          <Line x1={55} y1={76} x2={56} y2={88} />
        </G>
      ) : top?.style === "sweater" ? (
        <G stroke={INK} strokeWidth={1.5} fill="none">
          <Path d="M40 74 Q50 80 60 74" />
          <Line x1={20} y1={92} x2={80} y2={92} />
        </G>
      ) : (
        <Path d="M42 73 Q50 81 58 73" stroke={INK} strokeWidth={1.5} fill="none" />
      )}
    </G>
  );
}

export function Avatar({ loadout, size = 64 }: { loadout: Loadout; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityLabel="Avatar"
      accessibilityRole="image"
    >
      <Defs>
        <ClipPath id="avatar-circle">
          <Circle cx={50} cy={50} r={50} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#avatar-circle)">
        <Rect width={100} height={100} fill={BACKGROUNDS[loadout.background ?? ""] ?? "#E7E8EB"} />
        <Top assetKey={loadout.top} />
        <Circle cx={50} cy={46} r={22} fill={BODY} stroke={INK} strokeWidth={2} />
        <Circle cx={39} cy={51} r={3} fill="#FFB3B3" opacity={0.7} />
        <Circle cx={61} cy={51} r={3} fill="#FFB3B3" opacity={0.7} />
        {FACES[loadout.face ?? ""] ?? FACES.face_smile}
        {loadout.head ? HEADS[loadout.head] : null}
      </G>
    </Svg>
  );
}
