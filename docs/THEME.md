# Ronin Theme System

The Ronin theme system provides consistent styling across all agent UIs. It's defined in `src/utils/theme.ts` and can be imported and used in any agent.

## Usage

```typescript
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

// In your HTML template:
const html = `
<style>
  ${getAdobeCleanFontFaceCSS()}
  ${getThemeCSS()}
  
  .my-custom-class {
    background: ${roninTheme.colors.backgroundSecondary};
    color: ${roninTheme.colors.textPrimary};
    padding: ${roninTheme.spacing.md};
    border-radius: ${roninTheme.borderRadius.md};
  }
</style>
`;
```

## Theme Colors

- `background`: `#0a0a0a` - Main dark background
- `backgroundSecondary`: `rgba(255, 255, 255, 0.02)` - Card backgrounds
- `backgroundTertiary`: `rgba(255, 255, 255, 0.04)` - Hover states
- `textPrimary`: `#ffffff` - Primary text color
- `textSecondary`: `rgba(255, 255, 255, 0.6)` - Secondary text
- `textTertiary`: `rgba(255, 255, 255, 0.4)` - Tertiary text
- `border`: `rgba(255, 255, 255, 0.08)` - Default borders
- `borderHover`: `rgba(255, 255, 255, 0.2)` - Hover borders
- `accent`: `rgba(255, 255, 255, 0.1)` - Accent color
- `success`: `#28a745` - Success states
- `error`: `#dc3545` - Error states
- `warning`: `#f59e0b` - Warning states

## Typography

- **Primary Font**: Adobe Clean (with Inter fallback)
- **Monospace Font**: JetBrains Mono
- **Base Font Size**: `0.875rem` (14px) - smaller than default
- **Small Text**: `0.8125rem` (13px)
- **Tiny Text**: `0.75rem` (12px)

## Spacing

- `xs`: `0.25rem` (4px)
- `sm`: `0.5rem` (8px)
- `md`: `1rem` (16px)
- `lg`: `1.5rem` (24px)
- `xl`: `2rem` (32px)

## Border Radius

- `sm`: `2px`
- `md`: `4px`
- `lg`: `8px`

## Fonts

Adobe Clean font files are stored in `public/fonts/` and served via `/fonts/` route:
- AdobeCleanRegular.otf
- AdobeCleanBold.otf
- AdobeCleanLight.otf
- AdobeCleanIt.otf
- AdobeCleanBoldIt.otf

## Examples

See `agents/chatty.ts` for a complete example of using the theme system.
