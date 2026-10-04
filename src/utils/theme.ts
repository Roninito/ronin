/**
 * Ronin System Theme
 * Shared theme definitions for consistent styling across all agent UIs
 */

export interface RoninTheme {
  colors: {
    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    borderHover: string;
    accent: string;
    accentHover: string;
    /** Neon lime for links and header title */
    link: string;
    linkHover: string;
    success: string;
    error: string;
    warning: string;
  };
  fonts: {
    primary: string;
    mono: string;
    /** Prose/body serif — only set on themes that distinguish reading text from UI chrome. */
    serif?: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

export type ThemeVariant = "ronin" | "dram" | "hanko" | "kiosa";

/**
 * Default Ronin theme matching the dark aesthetic used across agents
 */
export const roninTheme: RoninTheme = {
  colors: {
    background: "#0a0a0a",
    backgroundSecondary: "rgba(255, 255, 255, 0.02)",
    backgroundTertiary: "rgba(255, 255, 255, 0.04)",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.6)",
    textTertiary: "rgba(255, 255, 255, 0.4)",
    border: "rgba(255, 255, 255, 0.08)",
    borderHover: "rgba(255, 255, 255, 0.2)",
    accent: "rgba(255, 255, 255, 0.1)",
    accentHover: "rgba(255, 255, 255, 0.15)",
    link: "#84cc16",
    linkHover: "#a3e635",
    success: "#28a745",
    error: "#dc3545",
    warning: "#f59e0b",
  },
  fonts: {
    primary: "'AudioLink Console Demi', 'Adobe Clean UI', 'Adobe Clean', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'Agave', 'SFMono-Regular', Menlo, monospace",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  borderRadius: {
    sm: "2px",
    md: "4px",
    lg: "8px",
  },
  shadows: {
    sm: "0 2px 4px rgba(0, 0, 0, 0.1)",
    md: "0 4px 8px rgba(0, 0, 0, 0.2)",
    lg: "0 10px 40px rgba(0, 0, 0, 0.2)",
  },
};

/**
 * DRAM visual tokens extracted from DRAM-main renderer CSS variables/base styles.
 */
/**
 * Kiosa UI visual tokens — extracted from kiosa-ui style spec.
 * Near-black canvas, hairline panels, one neon accent per view.
 */
export const kiosaVisualTokens = {
  colors: {
    bg: "#05070a",
    panel: "rgba(12,18,22,.72)",
    hairline: "rgba(255,255,255,.09)",
    text: "#e8f4f6",
    dim: "#7d8f94",
    faint: "#46565b",
    accents: {
      cyan: "#00e5ff",
      lime: "#b8e62e",
      amber: "#ff9f1c",
      magenta: "#ff3ea5",
      teal: "#2ee6c8",
      violet: "#9d6bff",
    },
  },
  fonts: {
    display: `"Oswald", "Arial Narrow", sans-serif`,
    mono: `"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`,
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
  },
  radius: {
    sm: "2px",
    md: "3px",
  },
} as const;

export type KiosaAccentName = keyof typeof kiosaVisualTokens.colors.accents;

/**
 * Map each known route to its kiosa accent. One accent per view.
 * Unknown routes fall back to cyan.
 */
export function getKiosaAccentForPath(path: string): KiosaAccentName {
  const normalized = path.replace(/\/$/, "");
  const map: Record<string, KiosaAccentName> = {
    "/": "cyan",
    "/routes": "cyan",
    "/status": "cyan",
    "/chat": "cyan",
    "/todo": "lime",
    "/schedule": "amber",
    "/skills": "amber",
    "/analytics": "magenta",
    "/models": "magenta",
    "/models/manage": "violet",
    "/config": "teal",
    "/dashboard/dependencies": "teal",
    "/portfolio": "violet",
    "/portfolio/agents": "violet",
    "/portfolio/trades": "violet",
    "/portfolio/tasks": "violet",
    "/portfolio/assets": "violet",
    "/portfolio/settings": "violet",
  };
  return map[normalized] ?? "cyan";
}

/**
 * Kiosa-compatible theme mapped to RoninTheme for drop-in usage.
 */
export const kiosaTheme: RoninTheme = {
  colors: {
    background: kiosaVisualTokens.colors.bg,
    backgroundSecondary: kiosaVisualTokens.colors.panel,
    backgroundTertiary: "rgba(255,255,255,0.04)",
    textPrimary: kiosaVisualTokens.colors.text,
    textSecondary: kiosaVisualTokens.colors.dim,
    textTertiary: kiosaVisualTokens.colors.faint,
    border: kiosaVisualTokens.colors.hairline,
    borderHover: "rgba(255,255,255,0.18)",
    accent: kiosaVisualTokens.colors.accents.cyan,
    accentHover: "rgba(0,229,255,0.25)",
    link: kiosaVisualTokens.colors.accents.cyan,
    linkHover: kiosaVisualTokens.colors.accents.cyan,
    success: kiosaVisualTokens.colors.accents.teal,
    error: kiosaVisualTokens.colors.accents.magenta,
    warning: kiosaVisualTokens.colors.accents.amber,
  },
  fonts: {
    primary: kiosaVisualTokens.fonts.display,
    mono: kiosaVisualTokens.fonts.mono,
  },
  spacing: {
    xs: kiosaVisualTokens.spacing.xs,
    sm: kiosaVisualTokens.spacing.sm,
    md: kiosaVisualTokens.spacing.md,
    lg: kiosaVisualTokens.spacing.lg,
    xl: kiosaVisualTokens.spacing.xl,
  },
  borderRadius: {
    sm: kiosaVisualTokens.radius.sm,
    md: kiosaVisualTokens.radius.md,
    lg: kiosaVisualTokens.radius.md,
  },
  shadows: {
    sm: "none",
    md: "none",
    lg: "none",
  },
};

export const dramVisualTokens = {
  colors: {
    bgDeep: "#030304",
    bgBase: "#060607",
    bgSurface: "#0a0a0c",
    bgElevated: "#111114",
    bgHover: "#18181c",
    accent: "#7c3aed",
    accentSubtle: "rgba(124, 58, 237, 0.1)",
    accentGlow: "rgba(124, 58, 237, 0.2)",
    textPrimary: "#e2e2e7",
    textSecondary: "#8e8e93",
    textTertiary: "#48484a",
    border: "#1c1c1e",
    borderSubtle: "#141416",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
  },
  fonts: {
    sans: "'AudioLink Console Demi', 'Adobe Clean UI', 'Adobe Clean', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'Agave', 'SFMono-Regular', Menlo, monospace",
  },
  spacing: {
    space1: "4px",
    space2: "8px",
    space4: "16px",
    space5: "24px",
    space6: "32px",
  },
  radius: "2px",
  shadows: {
    tactile: "0 4px 12px rgba(0, 0, 0, 0.6)",
  },
} as const;

/**
 * DRAM-compatible theme variant mapped to RoninTheme for drop-in usage.
 */
export const dramTheme: RoninTheme = {
  colors: {
    background: dramVisualTokens.colors.bgBase,
    backgroundSecondary: dramVisualTokens.colors.bgSurface,
    backgroundTertiary: dramVisualTokens.colors.bgElevated,
    textPrimary: dramVisualTokens.colors.textPrimary,
    textSecondary: dramVisualTokens.colors.textSecondary,
    textTertiary: dramVisualTokens.colors.textTertiary,
    border: dramVisualTokens.colors.border,
    borderHover: dramVisualTokens.colors.bgHover,
    accent: dramVisualTokens.colors.accentSubtle,
    accentHover: dramVisualTokens.colors.accentGlow,
    link: dramVisualTokens.colors.accent,
    linkHover: dramVisualTokens.colors.accent,
    success: dramVisualTokens.colors.success,
    error: dramVisualTokens.colors.error,
    warning: dramVisualTokens.colors.warning,
  },
  fonts: {
    primary: dramVisualTokens.fonts.sans,
    mono: dramVisualTokens.fonts.mono,
  },
  spacing: {
    xs: dramVisualTokens.spacing.space1,
    sm: dramVisualTokens.spacing.space2,
    md: dramVisualTokens.spacing.space4,
    lg: dramVisualTokens.spacing.space5,
    xl: dramVisualTokens.spacing.space6,
  },
  borderRadius: {
    sm: "1px",
    md: dramVisualTokens.radius,
    lg: "4px",
  },
  shadows: {
    sm: dramVisualTokens.shadows.tactile,
    md: dramVisualTokens.shadows.tactile,
    lg: dramVisualTokens.shadows.tactile,
  },
};

/**
 * Hanko theme — ink/paper/seal system ported from the ronin-theme.html design spec.
 * Warm near-black ground, washi-paper text, a single red "hanko" seal accent.
 * The new default theme across the app; roninTheme/dramTheme remain selectable.
 */
export const hankoTheme: RoninTheme = {
  colors: {
    background: "#16130f",
    backgroundSecondary: "#1e1a14",
    backgroundTertiary: "#241f18",
    textPrimary: "#ECE6D6",
    textSecondary: "#9C9384",
    textTertiary: "#6b6355",
    border: "#332C22",
    borderHover: "#B7381F",
    accent: "#B7381F",
    accentHover: "#D14A2E",
    link: "#D14A2E",
    linkHover: "#D14A2E",
    // Status semantics kept distinct from seal (per product decision — the spec's literal
    // "one hue, ever" rule is not applied to success/warning/error), muted to fit the warm
    // ink/paper palette rather than reusing saturated neon tones.
    success: "#6E8F5C",
    error: "#C0392B",
    warning: "#C99A3B",
  },
  fonts: {
    primary: `Futura, "Avenir Next Condensed", "Century Gothic", "Trebuchet MS", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    mono: `ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace`,
    serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  borderRadius: {
    sm: "1px",
    md: "1px",
    lg: "2px",
  },
  shadows: {
    sm: "none",
    md: "none",
    lg: "none",
  },
};

export function getThemeVariant(variant: ThemeVariant = "hanko"): RoninTheme {
  if (variant === "dram") return dramTheme;
  if (variant === "ronin") return roninTheme;
  if (variant === "kiosa") return kiosaTheme;
  return hankoTheme;
}

/**
 * Generate CSS for Adobe Clean font face declarations
 */
export function getAdobeCleanFontFaceCSS(): string {
  return `
@font-face {
  font-family: 'Adobe Clean UI';
  src: url('/fonts/AdobeCleanRegular.otf') format('opentype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean UI';
  src: url('/fonts/AdobeCleanIt.otf') format('opentype');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean UI';
  src: url('/fonts/AdobeCleanBold.otf') format('opentype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean UI';
  src: url('/fonts/AdobeCleanBoldIt.otf') format('opentype');
  font-weight: 700;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean';
  src: url('/fonts/AdobeCleanRegular.otf') format('opentype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean';
  src: url('/fonts/AdobeCleanIt.otf') format('opentype');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean';
  src: url('/fonts/AdobeCleanLight.otf') format('opentype');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean';
  src: url('/fonts/AdobeCleanBold.otf') format('opentype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Adobe Clean';
  src: url('/fonts/AdobeCleanBoldIt.otf') format('opentype');
  font-weight: 700;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Agave';
  src: url('/fonts/Agave-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Agave';
  src: url('/fonts/Agave-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
`;
}

/**
 * Generate base CSS styles using the theme
 */
export function getKiosaFontLinkCSS(): string {
  return `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Oswald:wght@500;700&display=swap" rel="stylesheet" />
`.trim();
}


export function getThemeCSS(theme: RoninTheme = hankoTheme): string {
  const isHanko = theme === hankoTheme;
  const isKiosa = theme === kiosaTheme;
  const legacyHeadingFont = `'Adobe Clean UI', 'Adobe Clean', 'Agave', sans-serif`;
  return `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

${isKiosa ? `
:root {
  --kiosa-accent: ${kiosaVisualTokens.colors.accents.cyan};
  font-variant-numeric: tabular-nums;
  -moz-font-feature-settings: "tnum";
  -webkit-font-feature-settings: "tnum";
  font-feature-settings: "tnum";
}
` : ""}

body {
  font-family: ${theme.fonts.primary};
  background: ${theme.colors.background};
  color: ${theme.colors.textPrimary};
  line-height: 1.6;
  font-size: ${isKiosa ? "13px" : "0.875rem /* 14px */"};
  ${isHanko ? "animation: hankoEnter 320ms ease-out;" : ""}
  ${isKiosa ? `
  background-image:
    radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 3px);
  min-height: 100vh;
  ` : ""}
}

${isHanko ? `@keyframes hankoEnter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }` : ""}

${isKiosa ? `
/* Kiosa scanline + vignette overlay */
.kiosa-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  background:
    radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 3px);
}
` : ""}

h1, h2, h3, h4, h5, h6 {
  font-family: ${isHanko || isKiosa ? theme.fonts.primary : legacyHeadingFont};
  font-weight: ${isHanko ? 700 : isKiosa ? 700 : 300};
  letter-spacing: ${isHanko ? "0.04em" : isKiosa ? "0.04em" : "-0.02em"};
  text-transform: ${isHanko || isKiosa ? "uppercase" : "none"};
  color: ${theme.colors.textPrimary};
}

.title,
.section-title,
.panel-title,
.route-title,
.category-title {
  font-family: ${isHanko || isKiosa ? theme.fonts.primary : legacyHeadingFont};
}

${isHanko ? `.prose, .measure { font-family: ${theme.fonts.serif}; line-height: 1.65; max-width: 62ch; }` : ""}

b, strong {
  font-family: ${theme.fonts.mono};
  font-weight: ${isKiosa ? 600 : 700};
}

h1 { font-size: ${isKiosa ? "clamp(2rem, 5vw, 3.25rem)" : "clamp(1.75rem, 4vw, 2.5rem)"}; }
h2 { font-size: ${isKiosa ? "clamp(1.5rem, 3.5vw, 2.25rem)" : "clamp(1.5rem, 3vw, 2rem)"}; }
h3 { font-size: ${isKiosa ? "clamp(1.1rem, 2.5vw, 1.5rem)" : "clamp(1.25rem, 2.5vw, 1.5rem)"}; }

code, pre {
  font-family: ${theme.fonts.mono};
  font-size: ${isKiosa ? "12px" : "0.8125rem /* 13px */"};
}

a {
  color: ${theme.colors.link};
  text-decoration: none;
  ${isHanko ? `border-bottom: 1px solid ${theme.colors.accent}88;` : ""}
  transition: ${isHanko || isKiosa ? "border-color 150ms ease, color 150ms ease" : "color 0.2s"};
}

a:hover {
  ${isHanko || isKiosa ? `border-bottom-color: ${theme.colors.link}; color: ${theme.colors.linkHover};` : `color: ${theme.colors.linkHover};`}
}

${isHanko ? `::selection { background: #7A2A1A; color: ${theme.colors.textPrimary}; }` : ""}
${isKiosa ? `::selection { background: rgba(0,229,255,.25); color: ${theme.colors.textPrimary}; }` : ""}

${isHanko ? `:focus-visible { outline: 1.5px solid ${theme.colors.accentHover}; outline-offset: 2px; }` : ""}
${isKiosa ? `:focus-visible { outline: 1.5px solid ${theme.colors.accent}; outline-offset: 2px; }` : ""}

button {
  font-family: ${theme.fonts.primary};
  font-size: ${isKiosa ? "11px" : "0.875rem"};
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  background: ${theme.colors.backgroundSecondary};
  border: 1px solid ${theme.colors.border};
  color: ${theme.colors.textSecondary};
  border-radius: ${theme.borderRadius.md};
  cursor: pointer;
  transition: ${isHanko || isKiosa ? "background 150ms ease, color 150ms ease, border-color 150ms ease" : "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"};
  ${isKiosa ? "letter-spacing: 0.1em; text-transform: uppercase;" : ""}
}

button:hover:not(:disabled) {
  background: ${isHanko || isKiosa ? theme.colors.accent : theme.colors.backgroundTertiary};
  border-color: ${theme.colors.borderHover};
  color: ${isHanko || isKiosa ? theme.colors.background : theme.colors.textPrimary};
}

.ronin-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${theme.spacing.xs};
  min-height: 30px;
  padding: 0.35rem 0.8rem;
  border-radius: ${theme.borderRadius.md};
  border: 1px solid ${theme.colors.border};
  background: linear-gradient(180deg, #171717 0%, #101010 100%);
  color: ${theme.colors.textPrimary};
  font-family: ${theme.fonts.primary};
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  text-decoration: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.ronin-btn:hover:not(:disabled) {
  border-color: ${theme.colors.borderHover};
  background: linear-gradient(180deg, #1f1f1f 0%, #141414 100%);
  color: ${theme.colors.textPrimary};
}

.ronin-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.ronin-btn--accent {
  border-color: #7c3aed;
  background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%);
  color: #f7f3ff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.ronin-btn--accent:hover:not(:disabled) {
  border-color: #9f67ff;
  background: linear-gradient(180deg, #9d6dff 0%, #8950ff 100%);
}

.ronin-btn--success {
  border-color: #84cc16;
  background: linear-gradient(180deg, #a3e635 0%, #84cc16 100%);
  color: #061100;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 12px rgba(132, 204, 22, 0.28);
}

.ronin-btn--success:hover:not(:disabled) {
  border-color: #bef264;
  background: linear-gradient(180deg, #bef264 0%, #9bd92a 100%);
  color: #051000;
}

.ronin-btn--ghost {
  background: linear-gradient(180deg, #141414 0%, #0f0f0f 100%);
  color: ${theme.colors.textSecondary};
}

.ronin-btn--ghost:hover:not(:disabled) {
  color: ${theme.colors.textPrimary};
}

input, textarea {
  font-family: ${theme.fonts.primary};
  font-size: 0.875rem;
  background: ${theme.colors.backgroundSecondary};
  border: 1px solid ${theme.colors.border};
  color: ${theme.colors.textPrimary};
  border-radius: ${theme.borderRadius.md};
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  transition: all 0.3s;
}

input:focus, textarea:focus {
  outline: none;
  border-color: ${theme.colors.borderHover};
  background: ${theme.colors.backgroundTertiary};
}

input::placeholder, textarea::placeholder {
  color: ${theme.colors.textTertiary};
}

.card {
  background: ${theme.colors.backgroundSecondary};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.borderRadius.md};
  padding: ${theme.spacing.lg};
  transition: ${isHanko || isKiosa ? "border-color 150ms ease, background 150ms ease" : "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"};
  ${isHanko ? "animation: hankoEnter 260ms ease-out backwards;" : ""}
  ${isKiosa ? "font-family: " + theme.fonts.mono + ";" : ""}
}

.card:hover {
  border-color: ${theme.colors.borderHover};
  background: ${theme.colors.backgroundTertiary};
  ${isHanko || isKiosa ? "" : "transform: translateY(-2px);"}
}

${isKiosa ? `
.kiosa-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ${theme.fonts.mono};
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 8px;
  border: 1px solid ${theme.colors.border};
  border-radius: 2px;
  color: ${theme.colors.textSecondary};
  background: ${theme.colors.backgroundSecondary};
}
.kiosa-chip b, .kiosa-chip strong {
  color: ${theme.colors.textPrimary};
  font-weight: 600;
}
.kiosa-chip--accent {
  border-color: color-mix(in srgb, var(--kiosa-accent, ${theme.colors.accent}) 40%, transparent);
  color: var(--kiosa-accent, ${theme.colors.accent});
  background: color-mix(in srgb, var(--kiosa-accent, ${theme.colors.accent}) 7%, transparent);
}

.kiosa-panel {
  background: ${theme.colors.backgroundSecondary};
  border: 1px solid ${theme.colors.border};
  border-radius: 3px;
  padding: 8px 10px;
  font-family: ${theme.fonts.mono};
}
.kiosa-panel__label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${theme.colors.textSecondary};
  margin-bottom: 6px;
}
.kiosa-panel__label::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--kiosa-accent, ${theme.colors.accent});
  flex-shrink: 0;
}
` : ""}
`;
}

/** Seal-bright red used for the header home icon (hanko theme). */
export const HEADER_HOME_ICON_COLOR = "#D14A2E";

/**
 * SVG markup for the header home icon — a rotated square ("diamond"), matching the
 * hanko theme's .glyph/.stamp motif next to the Ronin wordmark. Use inside .header-home anchor.
 */
export function getHeaderHomeIconSVG(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" fill="${HEADER_HOME_ICON_COLOR}" transform="rotate(45 12 12)"/></svg>`;
}

/**
 * Full home-link HTML for the standard header. Place as first child of .header.
 * Also strips the word "Ronin" from .header h1 text on non-root pages (the icon
 * already establishes brand/home, so the title doesn't need to repeat it).
 */
export function getHeaderHomeIconHTML(): string {
  return `<a href="/" class="header-home" aria-label="Home">${getHeaderHomeIconSVG()}</a><script>(function(){if(location.pathname==='/'||window.__roninHeaderTitlePatched)return;window.__roninHeaderTitlePatched=true;var clean=function(){document.querySelectorAll('.header h1').forEach(function(el){var t=(el.textContent||'').replace(/\\bRonin\\b/gi,'').replace(/\\s{2,}/g,' ').trim();if(t)el.textContent=t;});};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',clean,{once:true});}else{clean();}})();(function(){if(window.__roninHeaderScrollPatched)return;window.__roninHeaderScrollPatched=true;var onScroll=function(){document.querySelectorAll('.header').forEach(function(el){el.classList.toggle('is-scrolled',window.scrollY>4);});};window.addEventListener('scroll',onScroll,{passive:true});onScroll();})();</script>`;
}

/**
 * Standard header bar CSS (analytics-style).
 * Use with: <div class="header">${getHeaderHomeIconHTML()}<h1>Title</h1><div class="header-meta">...</div></div>
 * or <div class="header">${getHeaderHomeIconHTML()}<h1>Title</h1><div class="header-actions">...</div></div>
 */
export function getHeaderBarCSS(theme: RoninTheme = hankoTheme): string {
  const isHanko = theme === hankoTheme;
  return `
.header {
  background: ${theme.colors.backgroundSecondary};
  backdrop-filter: blur(10px);
  padding: ${theme.spacing.md} ${theme.spacing.lg};
  border-top: 3px solid rgba(0, 0, 0, 0.85);
  border-bottom: 1px solid ${theme.colors.border};
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${theme.spacing.md};
  position: sticky;
  top: 0;
  z-index: 100;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;
  ${isHanko ? "transition: box-shadow 200ms ease, border-bottom-color 200ms ease;" : ""}
}

${isHanko ? `.header.is-scrolled { box-shadow: 0 1px 0 ${theme.colors.border}; border-bottom-color: ${theme.colors.accent}; }` : ""}

${isHanko ? "" : `
.header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 5% 30%, ${theme.colors.link}15 0%, transparent 2px),
    radial-gradient(circle at 15% 70%, ${theme.colors.link}10 0%, transparent 3px),
    radial-gradient(circle at 25% 20%, ${theme.colors.link}20 0%, transparent 2px),
    radial-gradient(circle at 40% 60%, ${theme.colors.link}08 0%, transparent 4px),
    radial-gradient(circle at 55% 40%, ${theme.colors.link}12 0%, transparent 2px),
    radial-gradient(circle at 70% 80%, ${theme.colors.link}15 0%, transparent 3px),
    radial-gradient(circle at 85% 25%, ${theme.colors.link}10 0%, transparent 2px),
    radial-gradient(circle at 95% 55%, ${theme.colors.link}18 0%, transparent 3px);
  animation: pixelGlitch 6s steps(8) infinite;
  opacity: 0;
}

.header::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  pointer-events: none;
  background: linear-gradient(90deg,
    transparent 0%,
    ${theme.colors.link}08 2%,
    transparent 4%,
    transparent 20%,
    ${theme.colors.link}05 22%,
    transparent 24%,
    transparent 45%,
    ${theme.colors.link}10 47%,
    transparent 49%,
    transparent 70%,
    ${theme.colors.link}08 72%,
    transparent 74%,
    transparent 90%,
    ${theme.colors.link}12 92%,
    transparent 94%
  );
  animation: scanGlitch 4s linear infinite;
  opacity: 0.6;
}

@keyframes pixelGlitch {
  0%, 100% { opacity: 0; transform: translateX(0); }
  5% { opacity: 0.8; transform: translateX(-1px); }
  10% { opacity: 0.3; transform: translateX(2px); }
  15% { opacity: 0.9; transform: translateX(-2px); }
  20% { opacity: 0.2; transform: translateX(1px); }
  25% { opacity: 0; transform: translateX(0); }
  50% { opacity: 0; transform: translateX(0); }
  55% { opacity: 0.7; transform: translateX(3px); }
  60% { opacity: 0.4; transform: translateX(-1px); }
  65% { opacity: 0.85; transform: translateX(1px); }
  70% { opacity: 0.1; transform: translateX(-2px); }
  75% { opacity: 0; transform: translateX(0); }
}

@keyframes scanGlitch {
  0% { background-position: 0 0; }
  100% { background-position: 100px 0; }
}
`}

.header-home {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: ${theme.spacing.xs};
  color: ${HEADER_HOME_ICON_COLOR};
  text-decoration: none;
  line-height: 0;
  position: relative;
  z-index: 1;
  transition: opacity 150ms ease, transform 150ms ease;
}
.header-home:hover {
  opacity: 0.85;
  ${isHanko ? "transform: scale(1.08);" : ""}
}

.header h1 {
  font-family: ${theme.fonts.primary};
  font-size: 1rem;
  font-weight: 300;
  margin: 0;
  margin-right: auto;
  color: ${theme.colors.link};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}

.header-meta {
  font-size: 0.6875rem;
  color: ${theme.colors.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  position: relative;
  z-index: 1;
}

.header-meta span {
  margin-left: ${theme.spacing.md};
}

.header-actions {
  display: flex;
  gap: ${theme.spacing.sm};
  align-items: center;
  position: relative;
  z-index: 1;
}

.header a,
.header button,
.header input,
.header select,
.header textarea,
.header-actions,
.header-meta {
  -webkit-app-region: no-drag;
}
`;
}

export interface SharedUIPrimitivesOptions {
  variant?: ThemeVariant;
}

/**
 * Reusable DRAM-style primitives for route UIs and Electron shell pages.
 */
export function getSharedUIPrimitivesCSS(
  theme: RoninTheme = hankoTheme,
  options: SharedUIPrimitivesOptions = {},
): string {
  const variant = options.variant ?? (theme === dramTheme ? "dram" : theme === kiosaTheme ? "kiosa" : theme === roninTheme ? "ronin" : "hanko");
  const dram = variant === "dram";
  const kiosa = variant === "kiosa";
  const hanko = variant === "hanko";
  const accent = dram ? dramVisualTokens.colors.accent : kiosa ? "var(--kiosa-accent, " + theme.colors.accent + ")" : theme.colors.link;
  const accentGlow = dram ? dramVisualTokens.colors.accentGlow : theme.colors.accentHover;
  const panelBg = dram ? dramVisualTokens.colors.bgSurface : theme.colors.backgroundSecondary;
  const panelHoverBg = dram ? dramVisualTokens.colors.bgElevated : theme.colors.backgroundTertiary;
  const panelBorder = dram ? dramVisualTokens.colors.border : theme.colors.border;
  const panelBorderHover = dram ? dramVisualTokens.colors.bgHover : theme.colors.borderHover;
  const badgeBg = dram ? dramVisualTokens.colors.bgElevated : theme.colors.backgroundTertiary;
  const badgeText = dram ? dramVisualTokens.colors.textSecondary : theme.colors.textSecondary;
  const monoFont = kiosa ? theme.fonts.mono : theme.fonts.primary;

  return `
.ui-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${kiosa ? "6px" : theme.spacing.sm};
  padding: ${kiosa ? "3px 8px" : `${theme.spacing.sm} ${theme.spacing.md}`};
  border: 1px solid ${kiosa ? theme.colors.border : panelBorder};
  border-radius: ${kiosa ? "2px" : theme.borderRadius.md};
  background: ${kiosa ? theme.colors.backgroundSecondary : panelBg};
  color: ${theme.colors.textSecondary};
  font-family: ${monoFont};
  font-size: ${kiosa ? "10px" : "0.8125rem"};
  letter-spacing: ${kiosa ? "0.1em" : "normal"};
  text-transform: ${kiosa ? "uppercase" : "none"};
  line-height: 1.2;
  cursor: pointer;
  transition: ${hanko || kiosa ? "background 150ms ease, color 150ms ease, border-color 150ms ease" : "all 0.2s ease"};
}
.ui-btn:hover:not(:disabled) {
  background: ${hanko || kiosa ? theme.colors.accent : panelHoverBg};
  border-color: ${panelBorderHover};
  color: ${hanko || kiosa ? theme.colors.background : theme.colors.textPrimary};
}
.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ui-btn--primary {
  background: ${dram ? `${accent}22` : kiosa ? `color-mix(in srgb, ${accent} 15%, transparent)` : theme.colors.accent};
  border-color: ${accent};
  color: ${kiosa ? accent : theme.colors.textPrimary};
}
.ui-btn--primary:hover:not(:disabled) {
  background: ${accentGlow};
  border-color: ${accent};
  color: ${kiosa ? accent : theme.colors.background};
}
.ui-btn--ghost {
  background: transparent;
}

.ui-panel, .ui-card {
  background: ${panelBg};
  border: 1px solid ${panelBorder};
  border-radius: ${kiosa ? "3px" : theme.borderRadius.md};
  padding: ${theme.spacing.md};
  ${hanko ? "animation: hankoEnter 260ms ease-out backwards;" : ""}
  ${kiosa ? "font-family: " + theme.fonts.mono + ";" : ""}
}
.ui-panel--interactive:hover, .ui-card--interactive:hover {
  background: ${panelHoverBg};
  border-color: ${panelBorderHover};
}

${hanko ? `
/* Rotated-square "stamp" mark — the hanko motif reused as a status/loading glyph. */
.hanko-stamp {
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 1.5px solid ${theme.colors.accentHover};
  transform: rotate(45deg);
  flex-shrink: 0;
}
.hanko-stamp--pop {
  animation: hankoStampImpact 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes hankoStampImpact {
  0% { transform: rotate(45deg) scale(1.4); opacity: 0; }
  60% { transform: rotate(45deg) scale(0.9); opacity: 1; }
  100% { transform: rotate(45deg) scale(1); opacity: 1; }
}

.hanko-spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  background: ${theme.colors.accent};
  transform: rotate(45deg);
  animation: hankoSpin 1.1s ease-in-out infinite;
}
@keyframes hankoSpin {
  0%, 100% { transform: rotate(45deg) scale(1); opacity: 1; }
  50% { transform: rotate(45deg) scale(0.82); opacity: 0.6; }
}
` : ""}

.ui-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${theme.spacing.md};
  width: 100%;
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  border-radius: ${theme.borderRadius.md};
  border: 1px solid transparent;
  color: ${theme.colors.textSecondary};
  text-decoration: none;
}
.ui-nav-row:hover,
.ui-nav-row--active {
  background: ${panelHoverBg};
  border-color: ${panelBorder};
  color: ${theme.colors.textPrimary};
}

.ui-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${theme.spacing.sm};
  margin-bottom: ${theme.spacing.sm};
}
.ui-section-header h2,
.ui-section-header h3 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${theme.colors.textSecondary};
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: ${theme.spacing.xs};
  padding: ${theme.spacing.xs} ${theme.spacing.sm};
  border-radius: ${theme.borderRadius.sm};
  border: 1px solid ${panelBorder};
  background: ${badgeBg};
  color: ${badgeText};
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ui-badge--success { color: ${theme.colors.success}; }
.ui-badge--warning { color: ${theme.colors.warning}; }
.ui-badge--error { color: ${theme.colors.error}; }

.ui-input,
input.ui-input,
textarea.ui-input,
select.ui-input {
  width: 100%;
  font-family: ${monoFont};
  font-size: ${kiosa ? "12px" : "0.8125rem"};
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  border-radius: ${kiosa ? "2px" : theme.borderRadius.md};
  border: 1px solid ${panelBorder};
  background: ${panelBg};
  color: ${theme.colors.textPrimary};
  transition: all 0.2s ease;
}
.ui-input:focus,
input.ui-input:focus,
textarea.ui-input:focus,
select.ui-input:focus {
  outline: none;
  border-color: ${accent};
  box-shadow: ${kiosa ? "0 0 8px" : "0 0 0 1px"} ${accentGlow};
}

input.ui-switch {
  appearance: none;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid ${panelBorder};
  background: ${panelBg};
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}
input.ui-switch::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: ${theme.colors.textSecondary};
  transition: transform 0.2s ease;
}
input.ui-switch:checked {
  border-color: ${accent};
  background: ${accentGlow};
}
input.ui-switch:checked::after {
  transform: translateX(14px);
  background: ${theme.colors.textPrimary};
}

input[type="range"].ui-range {
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: ${panelBorder};
}
input[type="range"].ui-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid ${accent};
  background: ${panelBg};
}
input[type="range"].ui-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid ${accent};
  background: ${panelBg};
}
`;
}
