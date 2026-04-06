export const DEFAULT_BACKGROUND_COLOR = "#07111f";
export const DEFAULT_TEXT_COLOR = "#e9fcff";
export const DEFAULT_HIGHLIGHT_COLOR = "#44f9cf";
export const DEFAULT_FONT_STYLE = "default";

export const ALLOWED_FONT_STYLES = [
  "default",
  "cosmic",
  "retro",
  "elegant",
  "poster",
  "editorial",
  "luxe",
  "orbit",
  "gallery",
  "groove",
  "typewriter",
  "signal",
] as const;

export type FontStyle = (typeof ALLOWED_FONT_STYLES)[number];

export type ProfileAppearance = {
  background_color?: string | null;
  text_color?: string | null;
  highlight_color?: string | null;
  font_style?: FontStyle | null;
  youtube_urls?: string[] | null;
  music_player_urls?: string[] | null;
};

export type ProfilePalette = {
  name: string;
  background_color: string;
  text_color: string;
  highlight_color: string;
};

export const PROFILE_COLOR_PALETTES: ReadonlyArray<ProfilePalette> = [
  { name: "Teal Aurora", background_color: "#061621", text_color: "#DFFDFC", highlight_color: "#32E6C6" },
  { name: "Blue Nova", background_color: "#0B1533", text_color: "#EAF2FF", highlight_color: "#59A9FF" },
  { name: "Purple Pulse", background_color: "#170C2E", text_color: "#F4EAFF", highlight_color: "#B98CFF" },
  { name: "Solar Gold", background_color: "#1E1A0B", text_color: "#FFF7D6", highlight_color: "#F6C451" },
  { name: "Neon Tide", background_color: "#04171A", text_color: "#E6FEFF", highlight_color: "#3AE7FF" },
  { name: "Midnight Rose", background_color: "#1A0C18", text_color: "#FFEAF8", highlight_color: "#FF79CF" },
];

export const FONT_OPTIONS: ReadonlyArray<{ value: FontStyle; label: string }> = [
  { value: "default", label: "Default" },
  { value: "cosmic", label: "Cosmic" },
  { value: "retro", label: "Retro" },
  { value: "elegant", label: "Elegant" },
  { value: "poster", label: "Poster" },
  { value: "editorial", label: "Editorial" },
  { value: "luxe", label: "Luxe" },
  { value: "orbit", label: "Orbit" },
  { value: "gallery", label: "Gallery" },
  { value: "groove", label: "Groove" },
  { value: "typewriter", label: "Typewriter" },
  { value: "signal", label: "Signal" },
];

export function normalizeFontStyle(value: string | null | undefined): FontStyle {
  return ALLOWED_FONT_STYLES.includes(value as FontStyle) ? (value as FontStyle) : DEFAULT_FONT_STYLE;
}

export function fontClass(font: string | null | undefined) {
  if (font === "cosmic") return "font-[var(--font-space-grotesk)]";
  if (font === "retro") return "font-mono tracking-[0.02em]";
  if (font === "elegant") return "font-serif";
  if (font === "poster") return "font-[var(--font-bebas-neue)] tracking-[0.08em] uppercase";
  if (font === "editorial") return "font-[var(--font-cormorant-garamond)]";
  if (font === "luxe") return "font-[var(--font-dm-serif-display)]";
  if (font === "orbit") return "font-[var(--font-orbitron)] tracking-[0.06em]";
  if (font === "gallery") return "font-[var(--font-playfair-display)]";
  if (font === "groove") return "font-[var(--font-syne)]";
  if (font === "typewriter") return "font-[var(--font-jetbrains-mono)] text-[0.98em]";
  if (font === "signal") return "font-[var(--font-audiowide)] tracking-[0.04em]";
  return "font-[var(--font-inter)]";
}

export function resolveProfileAppearance(appearance?: ProfileAppearance | null) {
  return {
    background_color: appearance?.background_color || DEFAULT_BACKGROUND_COLOR,
    text_color: appearance?.text_color || DEFAULT_TEXT_COLOR,
    highlight_color: appearance?.highlight_color || DEFAULT_HIGHLIGHT_COLOR,
    font_style: normalizeFontStyle(appearance?.font_style),
  };
}