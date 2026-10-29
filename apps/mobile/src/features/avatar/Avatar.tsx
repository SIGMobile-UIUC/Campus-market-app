import type { ReactNode } from "react";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
} from "react-native-svg";

// Equipped items by slot, as asset keys (get_my_account().avatar, avatar_loadout).
export type Loadout = Partial<Record<"body" | "background" | "top" | "face" | "head", string>>;

const INK = "#2B2B2B";

// A flat color, or a gradient from top to bottom for the showier items.
type Fill = string | string[];

// Bundled SVG layers by asset_key (spec 4.14). Without a body item the avatar is the classic cream
// mascot. Placeholder art drawn in code; a designer's layers replace these keys one to one.
const BACKGROUNDS: Record<string, Fill> = {
  bg_sky: "#CDE8FF",
  bg_mint: "#C9F2DD",
  bg_peach: "#FFDCC8",
  bg_lilac: "#E4D9FF",
  bg_sun: "#FFF1A8",
  bg_rose: "#FFD6E0",
  bg_sand: "#F1E2C4",
  bg_slate: "#C9D1DB",
  bg_forest: "#B7DDB0",
  bg_ocean: "#A9D6E5",
  bg_night: "#2E3A66",
  bg_sunset: ["#FFB88C", "#DE6262"],
  bg_gold: ["#FFE89A", "#C99A1E"],
  bg_galaxy: ["#3A1C71", "#B65DA0"],
};

const TOPS: Record<string, { style: "hoodie" | "tee" | "sweater"; fill: Fill }> = {
  top_hoodie_navy: { style: "hoodie", fill: "#2F4B7C" },
  top_tee_orange: { style: "tee", fill: "#F28C38" },
  top_hoodie_green: { style: "hoodie", fill: "#3F8F5A" },
  top_tee_purple: { style: "tee", fill: "#7B5CC4" },
  top_sweater_red: { style: "sweater", fill: "#C8443B" },
  top_tee_teal: { style: "tee", fill: "#2C9C9A" },
  top_hoodie_black: { style: "hoodie", fill: "#333438" },
  top_tee_yellow: { style: "tee", fill: "#F2C230" },
  top_tee_white: { style: "tee", fill: "#F4F4F4" },
  top_hoodie_pink: { style: "hoodie", fill: "#F28DB2" },
  top_sweater_navy: { style: "sweater", fill: "#2A3F6B" },
  top_sweater_cream: { style: "sweater", fill: "#EADBC8" },
  // Metallic, so gold never reads as a yellow hoodie.
  top_hoodie_gold: { style: "hoodie", fill: ["#FFF3B0", "#D4A017", "#7A5404", "#C9961A"] },
  top_hoodie_galaxy: { style: "hoodie", fill: ["#5B3BA8", "#1E1446"] },
};

// Skin tones, and two animals with their ears and muzzle.
type Body = { skin: string; animal?: "dog" | "cat"; ear?: string; muzzle?: string };
const BODIES: Record<string, Body> = {
  body_tone_1: { skin: "#FFE3CC" },
  body_tone_2: { skin: "#F1C6A0" },
  body_tone_3: { skin: "#D9A273" },
  body_tone_4: { skin: "#A66A42" },
  body_tone_5: { skin: "#6B4226" },
  body_dog: { skin: "#D9A066", animal: "dog", ear: "#8C5A2E", muzzle: "#F5DEC0" },
  body_cat: { skin: "#B8B8C4", animal: "cat", ear: "#8E8E9C", muzzle: "#EDEDF2" },
};
const CLASSIC: Body = { skin: "#FFF6EA" };

const EYES = (
  <G>
    <Ellipse cx={43} cy={45} rx={2.2} ry={3} fill={INK} />
    <Ellipse cx={57} cy={45} rx={2.2} ry={3} fill={INK} />
  </G>
);

const FACES: Record<string, ReactNode> = {
  face_smile: (
    <G>
      {EYES}
      <Path d="M44 53 Q50 58 56 53" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
    </G>
  ),
  face_grin: (
    <G>
      {EYES}
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
  face_surprised: (
    <G>
      <Circle cx={43} cy={44} r={3} fill={INK} />
      <Circle cx={57} cy={44} r={3} fill={INK} />
      <Ellipse cx={50} cy={55} rx={3} ry={3.5} fill={INK} />
    </G>
  ),
  face_sleepy: (
    <G stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none">
      <Path d="M40 45 Q43 48 46 45" />
      <Path d="M54 45 Q57 48 60 45" />
      <Path d="M47 54 L53 54" />
    </G>
  ),
  face_tongue: (
    <G>
      {EYES}
      <Path d="M44 52 Q50 57 56 52" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
      <Path d="M48 55 Q50 61 52 55 Z" fill="#E5533D" stroke={INK} strokeWidth={1.2} />
    </G>
  ),
  face_cool: (
    <G>
      <Rect x={36} y={40} width={12} height={8} rx={3} fill={INK} />
      <Rect x={52} y={40} width={12} height={8} rx={3} fill={INK} />
      <Line x1={48} y1={43} x2={52} y2={43} stroke={INK} strokeWidth={2} />
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
  head_party: (
    <G>
      <Polygon points="50,6 40,30 60,30" fill="#7B5CC4" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Circle cx={46} cy={22} r={1.8} fill="#FFC83D" />
      <Circle cx={53} cy={16} r={1.8} fill="#4FC3F7" />
      <Circle cx={50} cy={6} r={3} fill="#FF6F91" stroke={INK} strokeWidth={1.5} />
    </G>
  ),
  head_flower: (
    <G>
      {[0, 72, 144, 216, 288].map((angle) => (
        <Circle
          key={angle}
          cx={36 + 5 * Math.cos((angle * Math.PI) / 180)}
          cy={28 + 5 * Math.sin((angle * Math.PI) / 180)}
          r={3.6}
          fill="#FFB3C7"
          stroke={INK}
          strokeWidth={1}
        />
      ))}
      <Circle cx={36} cy={28} r={2.8} fill="#FFC83D" stroke={INK} strokeWidth={1} />
    </G>
  ),
  head_wizard: (
    <G>
      <Path d="M50 2 L36 32 L64 32 Z" fill="#2E3A66" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Ellipse cx={50} cy={32} rx={22} ry={4} fill="#2E3A66" stroke={INK} strokeWidth={2} />
      <Path
        d="M49 14 L50.5 17 L53.5 17.5 L51.2 19.5 L52 22.5 L49 21 L46 22.5 L46.8 19.5 L44.5 17.5 L47.5 17 Z"
        fill="#FFC83D"
      />
    </G>
  ),
  head_crown: (
    <G>
      <Path
        d="M32 33 L30 15 L40 24 L50 11 L60 24 L70 15 L68 33 Z"
        fill="url(#avatar-gold)"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={27} r={2.5} fill="#E5533D" />
      <Circle cx={39} cy={28} r={2} fill="#4FC3F7" />
      <Circle cx={61} cy={28} r={2} fill="#4FC3F7" />
    </G>
  ),
};

// A gradient fill needs its own id per layer; each Svg is its own document, so ids repeat safely.
function paint(fill: Fill, id: string) {
  return typeof fill === "string" ? fill : `url(#${id})`;
}

function Gradient({ id, fill }: { id: string; fill: Fill }) {
  if (typeof fill === "string") return null;
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      {fill.map((color, i) => (
        <Stop key={color} offset={i / (fill.length - 1)} stopColor={color} />
      ))}
    </LinearGradient>
  );
}

function Top({ fill, style }: { fill: Fill; style?: "hoodie" | "tee" | "sweater" }) {
  return (
    <G>
      <Path
        d="M14 104 C14 82 30 72 50 72 C70 72 86 82 86 104 Z"
        fill={paint(fill, "avatar-top")}
        stroke={INK}
        strokeWidth={2}
      />
      {style === "hoodie" ? (
        <G stroke={INK} strokeWidth={1.5} strokeLinecap="round">
          <Line x1={45} y1={76} x2={44} y2={88} />
          <Line x1={55} y1={76} x2={56} y2={88} />
        </G>
      ) : style === "sweater" ? (
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

// The head with its ears behind it and, for animals, a muzzle and nose under the face.
function Head({ assetKey }: { assetKey?: string }) {
  const { skin, animal, ear, muzzle } = (assetKey && BODIES[assetKey]) || CLASSIC;
  return (
    <G>
      {animal === "dog" ? (
        <G fill={ear} stroke={INK} strokeWidth={2}>
          <Path d="M31 34 C20 36 19 56 26 60 C31 58 33 46 35 38 Z" />
          <Path d="M69 34 C80 36 81 56 74 60 C69 58 67 46 65 38 Z" />
        </G>
      ) : animal === "cat" ? (
        <G fill={ear} stroke={INK} strokeWidth={2} strokeLinejoin="round">
          <Path d="M31 36 L30 18 L45 27 Z" />
          <Path d="M69 36 L70 18 L55 27 Z" />
        </G>
      ) : null}
      <Circle cx={50} cy={46} r={22} fill={skin} stroke={INK} strokeWidth={2} />
      {muzzle ? (
        <G>
          <Ellipse cx={50} cy={54} rx={8.5} ry={6} fill={muzzle} />
          <Ellipse cx={50} cy={50} rx={2.6} ry={1.8} fill={INK} />
        </G>
      ) : null}
      {animal === "cat" ? (
        <G stroke={INK} strokeWidth={1} strokeLinecap="round">
          <Line x1={36} y1={53} x2={27} y2={51} />
          <Line x1={36} y1={56} x2={27} y2={57} />
          <Line x1={64} y1={53} x2={73} y2={51} />
          <Line x1={64} y1={56} x2={73} y2={57} />
        </G>
      ) : null}
      <Circle cx={39} cy={51} r={3} fill="#FFB3B3" opacity={0.7} />
      <Circle cx={61} cy={51} r={3} fill="#FFB3B3" opacity={0.7} />
    </G>
  );
}

export function Avatar({ loadout, size = 64 }: { loadout: Loadout; size?: number }) {
  const background = BACKGROUNDS[loadout.background ?? ""] ?? "#E7E8EB";
  const top = TOPS[loadout.top ?? ""];
  const topFill = top?.fill ?? "#9AA0A6";
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
        <Gradient id="avatar-bg" fill={background} />
        <Gradient id="avatar-top" fill={topFill} />
        <Gradient id="avatar-gold" fill={["#FFE27A", "#B8860B"]} />
      </Defs>
      <G clipPath="url(#avatar-circle)">
        <Rect width={100} height={100} fill={paint(background, "avatar-bg")} />
        <Top fill={topFill} style={top?.style} />
        <Head assetKey={loadout.body} />
        {FACES[loadout.face ?? ""] ?? FACES.face_smile}
        {loadout.head ? HEADS[loadout.head] : null}
      </G>
    </Svg>
  );
}
