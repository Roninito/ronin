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

/** Lime green used for the header home icon */
export const HEADER_HOME_ICON_COLOR = "#84cc16";

/**
 * SVG markup for the flat house icon (lime green). Use inside .header-home anchor.
 */
export function getHeaderHomeIconSVG(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="${HEADER_HOME_ICON_COLOR}" d="M12 2L2 10h2v10h6v-6h4v6h6V10h2L12 2z"/></svg>`;
}

/**
 * Full home link HTML for the standard header. Place as first child of .header.
 */
export function getHeaderHomeIconHTML(): string {
  return `<a href="/" class="header-home" aria-label="Home">${getHeaderHomeIconSVG()}</a>`;
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
  border-bottom: 1px solid ${theme.colors.border};
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${theme.spacing.md};
  position: sticky;
  top: 0;
  z-index: 100;
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
}
.header-home:hover {
  opacity: 0.85;
}

.header h1 {
  font-size: 1.375rem;
  font-weight: 300;
  margin: 0;
  margin-right: auto;
  color: ${theme.colors.link};
  letter-spacing: -0.02em;
}

.header-meta {
  font-size: 0.6875rem;
  color: ${theme.colors.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.header-meta span {
  margin-left: ${theme.spacing.md};
}

.header-actions {
  display: flex;
  gap: ${theme.spacing.sm};
  align-items: center;
}
`;
}
