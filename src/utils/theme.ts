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

export type ThemeVariant = "ronin" | "dram";

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
    primary: "'Adobe Clean', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Courier New', monospace",
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
    sans: "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
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

export function getThemeVariant(variant: ThemeVariant = "ronin"): RoninTheme {
  return variant === "dram" ? dramTheme : roninTheme;
}

/**
 * Generate CSS for Adobe Clean font face declarations
 */
export function getAdobeCleanFontFaceCSS(): string {
  return `
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
`;
}

/**
 * Generate base CSS styles using the theme
 */
export function getThemeCSS(theme: RoninTheme = roninTheme): string {
  return `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: ${theme.fonts.primary};
  background: ${theme.colors.background};
  color: ${theme.colors.textPrimary};
  line-height: 1.6;
  font-size: 0.875rem; /* 14px base - smaller than default */
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 300;
  letter-spacing: -0.02em;
  color: ${theme.colors.textPrimary};
}

h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); }
h2 { font-size: clamp(1.5rem, 3vw, 2rem); }
h3 { font-size: clamp(1.25rem, 2.5vw, 1.5rem); }

code, pre {
  font-family: ${theme.fonts.mono};
  font-size: 0.8125rem; /* 13px */
}

a {
  color: ${theme.colors.link};
  text-decoration: none;
  transition: color 0.2s;
}

a:hover {
  color: ${theme.colors.linkHover};
}

button {
  font-family: ${theme.fonts.primary};
  font-size: 0.875rem;
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  background: ${theme.colors.backgroundSecondary};
  border: 1px solid ${theme.colors.border};
  color: ${theme.colors.textSecondary};
  border-radius: ${theme.borderRadius.md};
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

button:hover:not(:disabled) {
  background: ${theme.colors.backgroundTertiary};
  border-color: ${theme.colors.borderHover};
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
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover {
  border-color: ${theme.colors.borderHover};
  background: ${theme.colors.backgroundTertiary};
  transform: translateY(-2px);
}
`;
}

/** Lime green used for the header routes icon */
export const HEADER_HOME_ICON_COLOR = "#84cc16";

/**
 * SVG markup for the routes icon (lime green). Use inside .header-home anchor.
 */
export function getHeaderHomeIconSVG(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 6h10" stroke="${HEADER_HOME_ICON_COLOR}" stroke-width="2" stroke-linecap="round"/><path d="M4 12h8" stroke="${HEADER_HOME_ICON_COLOR}" stroke-width="2" stroke-linecap="round"/><path d="M4 18h6" stroke="${HEADER_HOME_ICON_COLOR}" stroke-width="2" stroke-linecap="round"/><path d="M14 6h6v6" stroke="${HEADER_HOME_ICON_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m20 6-6 6" stroke="${HEADER_HOME_ICON_COLOR}" stroke-width="2" stroke-linecap="round"/></svg>`;
}

/**
 * Full routes link HTML for the standard header. Place as first child of .header.
 */
export function getHeaderHomeIconHTML(): string {
  return `<script>(function(){if(location.pathname==='/'||window.__roninHeaderTitlePatched)return;window.__roninHeaderTitlePatched=true;var clean=function(){document.querySelectorAll('.header h1').forEach(function(el){var t=(el.textContent||'').replace(/\\bRonin\\b/gi,'').replace(/\\s{2,}/g,' ').trim();if(t)el.textContent=t;});};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',clean,{once:true});}else{clean();}})();</script>`;
}

/**
 * Standard header bar CSS (analytics-style).
 * Use with: <div class="header">${getHeaderHomeIconHTML()}<h1>Title</h1><div class="header-meta">...</div></div>
 * or <div class="header">${getHeaderHomeIconHTML()}<h1>Title</h1><div class="header-actions">...</div></div>
 */
export function getHeaderBarCSS(theme: RoninTheme = roninTheme): string {
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
}

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
}
.header-home:hover {
  opacity: 0.85;
}

.header h1 {
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
  theme: RoninTheme = roninTheme,
  options: SharedUIPrimitivesOptions = {},
): string {
  const variant = options.variant ?? (theme === dramTheme ? "dram" : "ronin");
  const dram = variant === "dram";
  const accent = dram ? dramVisualTokens.colors.accent : theme.colors.link;
  const accentGlow = dram ? dramVisualTokens.colors.accentGlow : theme.colors.accentHover;
  const panelBg = dram ? dramVisualTokens.colors.bgSurface : theme.colors.backgroundSecondary;
  const panelHoverBg = dram ? dramVisualTokens.colors.bgElevated : theme.colors.backgroundTertiary;
  const panelBorder = dram ? dramVisualTokens.colors.border : theme.colors.border;
  const panelBorderHover = dram ? dramVisualTokens.colors.bgHover : theme.colors.borderHover;
  const badgeBg = dram ? dramVisualTokens.colors.bgElevated : theme.colors.backgroundTertiary;
  const badgeText = dram ? dramVisualTokens.colors.textSecondary : theme.colors.textSecondary;

  return `
.ui-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${theme.spacing.sm};
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  border: 1px solid ${panelBorder};
  border-radius: ${theme.borderRadius.md};
  background: ${panelBg};
  color: ${theme.colors.textSecondary};
  font-family: ${theme.fonts.primary};
  font-size: 0.8125rem;
  line-height: 1.2;
  cursor: pointer;
  transition: all 0.2s ease;
}
.ui-btn:hover:not(:disabled) {
  background: ${panelHoverBg};
  border-color: ${panelBorderHover};
  color: ${theme.colors.textPrimary};
}
.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ui-btn--primary {
  background: ${dram ? `${accent}22` : theme.colors.accent};
  border-color: ${accent};
  color: ${theme.colors.textPrimary};
}
.ui-btn--primary:hover:not(:disabled) {
  background: ${accentGlow};
  border-color: ${accent};
}
.ui-btn--ghost {
  background: transparent;
}

.ui-panel, .ui-card {
  background: ${panelBg};
  border: 1px solid ${panelBorder};
  border-radius: ${theme.borderRadius.md};
  padding: ${theme.spacing.md};
}
.ui-panel--interactive:hover, .ui-card--interactive:hover {
  background: ${panelHoverBg};
  border-color: ${panelBorderHover};
}

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
  font-family: ${theme.fonts.primary};
  font-size: 0.8125rem;
  padding: ${theme.spacing.sm} ${theme.spacing.md};
  border-radius: ${theme.borderRadius.md};
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
  box-shadow: 0 0 0 1px ${accentGlow};
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
