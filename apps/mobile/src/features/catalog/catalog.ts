import { Gift, GraduationCap, Megaphone, Tag, Truck, type LucideIcon } from "lucide-react-native";

// Shopping modes say how to buy; categories say what a thing is (spec 1.7.5, DSC-11).
// Item categories come from app_config (categories.ts); modes are fixed.

export type Mode = { id: string; label: string; Icon: LucideIcon; tint: string; ink: string };

export const MODES: Mode[] = [
  { id: "free", label: "Free", Icon: Gift, tint: "#E6F4EA", ink: "#155E33" },
  { id: "move_out", label: "Move-out", Icon: Truck, tint: "#FAEEDA", ink: "#633806" },
  { id: "wanted", label: "Wanted", Icon: Megaphone, tint: "#EEEDFE", ink: "#3C3489" },
  { id: "under_10", label: "Under $10", Icon: Tag, tint: "#E6F1FB", ink: "#0C447C" },
  { id: "course", label: "By course", Icon: GraduationCap, tint: "#FAECE7", ink: "#712B13" },
];
