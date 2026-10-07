import {
  BedDouble,
  BookOpen,
  Bike,
  Dumbbell,
  Ellipsis,
  Gamepad2,
  Gift,
  GraduationCap,
  Laptop,
  Megaphone,
  Refrigerator,
  Shirt,
  Sofa,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react-native";

// Shopping modes say how to buy; categories say what a thing is (spec 1.7.5, DSC-11).
// ponytail: static until app_config.categories ships in M1 (DB-5).

export type Mode = { id: string; label: string; Icon: LucideIcon; tint: string; ink: string };

export const MODES: Mode[] = [
  { id: "free", label: "Free", Icon: Gift, tint: "#E6F4EA", ink: "#155E33" },
  { id: "move_out", label: "Move-out", Icon: Truck, tint: "#FAEEDA", ink: "#633806" },
  { id: "wanted", label: "Wanted", Icon: Megaphone, tint: "#EEEDFE", ink: "#3C3489" },
  { id: "under_10", label: "Under $10", Icon: Tag, tint: "#E6F1FB", ink: "#0C447C" },
  { id: "course", label: "By course", Icon: GraduationCap, tint: "#FAECE7", ink: "#712B13" },
];

export type Category = { id: string; label: string; short: string; Icon: LucideIcon };

export const CATEGORIES: Category[] = [
  { id: "furniture", label: "Furniture", short: "Furniture", Icon: Sofa },
  { id: "appliances", label: "Appliances", short: "Appliances", Icon: Refrigerator },
  { id: "electronics", label: "Electronics", short: "Electronics", Icon: Laptop },
  { id: "books", label: "Books and study", short: "Books", Icon: BookOpen },
  { id: "dorm", label: "Dorm and home", short: "Dorm & home", Icon: BedDouble },
  { id: "clothing", label: "Clothing and shoes", short: "Clothing", Icon: Shirt },
  { id: "bikes", label: "Bikes and scooters", short: "Bikes", Icon: Bike },
  { id: "sports", label: "Sports and outdoors", short: "Sports", Icon: Dumbbell },
  { id: "hobbies", label: "Hobbies and games", short: "Hobbies", Icon: Gamepad2 },
  { id: "other", label: "Other", short: "More", Icon: Ellipsis },
];
