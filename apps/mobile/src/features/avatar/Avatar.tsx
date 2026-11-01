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
  // Seen from the front like the face: the crown, its seams and button, and the brim curving out.
  head_cap: (
    <G>
      <Path d="M27 37 C27 13 73 13 73 37 Z" fill="#E5533D" stroke={INK} strokeWidth={2} />
      <Path d="M50 20 Q42 27 40 36 M50 20 Q58 27 60 36" stroke="#B83A28" strokeWidth={1.2} fill="none" />
      <Circle cx={50} cy={19.5} r={2} fill="#B83A28" stroke={INK} strokeWidth={1} />
      <Path
        d="M23 37 Q50 31 77 37 Q79 43 72 43 Q50 38 28 43 Q21 43 23 37 Z"
        fill="#C43F2C"
        stroke={INK}
        strokeWidth={2}
      />
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

  // Hairstyles share the head slot, so a hat and hair never fight over the same pixels.
  head_hair_short: (
    <Path
      d="M27 47 C24 27 37 18 51 18 C66 18 77 28 73 47 C71 41 68 37 63 34 C57 38 47 38 39 33 C35 37 30 41 27 47 Z"
      fill="#5B3A29"
      stroke={INK}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),
  head_hair_bob: (
    <Path
      d="M24 62 C19 30 31 16 50 16 C69 16 81 30 76 62 L67 62 C69 52 70 45 69 38 Q50 42 31 38 C30 45 31 52 33 62 Z"
      fill="#2F2A2E"
      stroke={INK}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),
  head_hair_long: (
    <G>
      <Path
        d="M21 88 C13 52 22 15 50 15 C78 15 87 52 79 88 L68 88 C71 72 72 56 70 42 C65 32 57 28 50 27 C43 28 35 32 30 42 C28 56 29 72 32 88 Z"
        fill="#E2B44D"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Line x1={50} y1={16} x2={50} y2={27} stroke={INK} strokeWidth={1.2} />
    </G>
  ),
  head_hair_curly: <Curls fill="#4A2E1F" />,
  head_hair_bun: (
    <G>
      <Circle cx={50} cy={13} r={7.5} fill="#2F2A2E" stroke={INK} strokeWidth={2} />
      <Path
        d="M27 45 C25 25 38 20 50 20 C62 20 75 25 73 45 C68 33 59 28 50 28 C41 28 32 33 27 45 Z"
        fill="#2F2A2E"
        stroke={INK}
        strokeWidth={2}
      />
      <Rect x={44} y={18} width={12} height={4} rx={2} fill="#FF6F91" stroke={INK} strokeWidth={1.2} />
    </G>
  ),
  head_hair_pigtails: (
    <G>
      <G fill="#B5552B" stroke={INK} strokeWidth={2}>
        <Ellipse cx={21} cy={52} rx={7} ry={12} />
        <Ellipse cx={79} cy={52} rx={7} ry={12} />
        <Path d="M27 46 C25 25 38 19 50 19 C62 19 75 25 73 46 C69 36 61 29 50 28 C39 29 31 36 27 46 Z" />
      </G>
      <Line x1={50} y1={19} x2={50} y2={28} stroke={INK} strokeWidth={1.2} />
      <Circle cx={26} cy={41} r={3} fill="#4FC3F7" stroke={INK} strokeWidth={1.2} />
      <Circle cx={74} cy={41} r={3} fill="#4FC3F7" stroke={INK} strokeWidth={1.2} />
    </G>
  ),
  head_hair_spiky: (
    <Path
      d="M27 45 L22 33 L31 33 L29 21 L39 26 L43 13 L51 23 L58 12 L61 25 L71 20 L69 32 L78 32 L73 45 C68 36 59 32 50 33 C41 32 32 36 27 45 Z"
      fill="#3A3550"
      stroke={INK}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),

  head_halo: (
    <G fill="none">
      <Ellipse cx={50} cy={11} rx={16} ry={4.5} stroke="#FFE27A" strokeWidth={5} opacity={0.5} />
      <Ellipse cx={50} cy={11} rx={16} ry={4.5} stroke="url(#avatar-gold)" strokeWidth={2.5} />
    </G>
  ),
  head_bunny: (
    <G>
      <G fill="#F4F4F4" stroke={INK} strokeWidth={2}>
        <Ellipse cx={38} cy={15} rx={6} ry={14} transform="rotate(-12 38 15)" />
        <Ellipse cx={62} cy={15} rx={6} ry={14} transform="rotate(12 62 15)" />
      </G>
      <G fill="#FFB3C7">
        <Ellipse cx={38} cy={16} rx={2.8} ry={9} transform="rotate(-12 38 16)" />
        <Ellipse cx={62} cy={16} rx={2.8} ry={9} transform="rotate(12 62 16)" />
      </G>
      <Path
        d="M28 40 C28 19 72 19 72 40"
        stroke="#FF6F91"
        strokeWidth={3.5}
        fill="none"
        strokeLinecap="round"
      />
    </G>
  ),
  head_devil: (
    <G fill="#D93A3A" stroke={INK} strokeWidth={2} strokeLinejoin="round">
      <Path d="M33 31 C28 24 28 17 32 11 C34 18 38 23 43 26 Z" />
      <Path d="M67 31 C72 24 72 17 68 11 C66 18 62 23 57 26 Z" />
    </G>
  ),
  head_beret: (
    <G>
      <Ellipse
        cx={47}
        cy={26}
        rx={24}
        ry={8}
        fill="#8E2B3A"
        stroke={INK}
        strokeWidth={2}
        transform="rotate(-8 47 26)"
      />
      <Line x1={48} y1={18} x2={49} y2={14} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </G>
  ),
  head_bucket: (
    <G>
      <Path
        d="M32 33 L35 17 Q50 12 65 17 L68 33 Z"
        fill="#CBB994"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect x={33} y={27} width={34} height={5} fill="#8C7A55" />
      <Path
        d="M20 37 Q50 27 80 37 Q83 42 76 43 Q50 35 24 43 Q17 42 20 37 Z"
        fill="#CBB994"
        stroke={INK}
        strokeWidth={2}
      />
    </G>
  ),
  head_headband: (
    <G>
      <Path
        d="M27 36 C38 30 62 30 73 36 L73 42 C62 36 38 36 27 42 Z"
        fill="#F4F4F4"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="M28 39 C39 33 61 33 72 39" stroke="#E5533D" strokeWidth={2} fill="none" />
    </G>
  ),
  head_chef: (
    <G fill="#FFFFFF" stroke={INK} strokeWidth={2}>
      <Circle cx={38} cy={16} r={8} />
      <Circle cx={62} cy={16} r={8} />
      <Circle cx={50} cy={11} r={10} />
      <Rect x={33} y={18} width={34} height={14} rx={2} />
    </G>
  ),
  head_cowboy: (
    <G>
      <Path
        d="M35 29 C34 15 40 10 45 11 Q50 15 55 11 C60 10 66 15 65 29 Z"
        fill="#9A6233"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect x={35} y={23} width={30} height={5} fill="#5A3825" />
      <Path
        d="M14 28 Q20 36 50 34 Q80 36 86 28 Q84 40 50 40 Q16 40 14 28 Z"
        fill="#9A6233"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </G>
  ),
  head_tiara: (
    <G>
      <Path
        d="M32 32 L35 23 L41 28 L50 16 L59 28 L65 23 L68 32 Q50 26 32 32 Z"
        fill="url(#avatar-silver)"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={25} r={2.6} fill="#FF6F91" stroke={INK} strokeWidth={1} />
      <Circle cx={35} cy={23} r={1.6} fill="#4FC3F7" />
      <Circle cx={65} cy={23} r={1.6} fill="#4FC3F7" />
    </G>
  ),
  head_antenna: (
    <G stroke={INK} strokeWidth={2} strokeLinecap="round">
      <Path d="M42 25 Q38 16 34 10 M58 25 Q62 16 66 10" fill="none" />
      <Circle cx={34} cy={9} r={4} fill="#9BE15D" />
      <Circle cx={66} cy={9} r={4} fill="#9BE15D" />
    </G>
  ),
  head_goggles: (
    <G>
      <Path d="M27 36 Q50 26 73 36" stroke="#5A3825" strokeWidth={4} fill="none" />
      <Circle cx={41} cy={31} r={7} fill="#A9D6E5" stroke="#8C5A2E" strokeWidth={3} />
      <Circle cx={59} cy={31} r={7} fill="#A9D6E5" stroke="#8C5A2E" strokeWidth={3} />
      <Path
        d="M38 28 Q40 26 43 27 M56 28 Q58 26 61 27"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
    </G>
  ),
};

// Curly hair as overlapping puffs: outlined first, then filled again slightly smaller so only the outer
// edge and the hairline keep their outline.
const CURLS: [number, number, number][] = [
  [29, 43, 6.5],
  [71, 43, 6.5],
  [30, 33, 8],
  [70, 33, 8],
  [36, 24, 8],
  [64, 24, 8],
  [45, 19, 8],
  [55, 19, 8],
  [50, 22, 8],
  [40, 31, 7],
  [60, 31, 7],
  [50, 28, 7],
];

function Curls({ fill }: { fill: string }) {
  return (
    <G fill={fill}>
      {CURLS.map(([cx, cy, r], i) => (
        <Circle key={`edge-${i}`} cx={cx} cy={cy} r={r} stroke={INK} strokeWidth={2} />
      ))}
      {CURLS.map(([cx, cy, r], i) => (
        <Circle key={`fill-${i}`} cx={cx} cy={cy} r={r - 1} />
      ))}
    </G>
  );
}

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
        <Gradient id="avatar-silver" fill={["#FFFFFF", "#AEB4C2"]} />
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
