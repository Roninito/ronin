#!/bin/bash
# Ronin bootstrap installer
#
#   curl -fsSL https://raw.githubusercontent.com/Roninito/ronin/main/install.sh | bash
#
# Scope is deliberately narrow: get Bun and the Ronin source onto this
# machine and make the `ronin` command available globally. It does NOT ask
# any setup questions — that's what `ronin init` (interactive wizard) and
# setup-env.sh (env var / Ollama / Cloudflare onboarding) already do. Run
# one of those yourself after this script finishes.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/Roninito/ronin.git"
INSTALL_DIR="${RONIN_INSTALL_DIR:-$HOME/ronin}"

echo ""
echo -e "${CYAN}🥷 Ronin bootstrap installer${NC}"
echo "================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Platform check — macOS and Linux only for now.
# ---------------------------------------------------------------------------
case "$OSTYPE" in
  darwin*|linux-gnu*)
    ;;
  *)
    echo -e "${RED}❌ Unsupported platform: $OSTYPE${NC}"
    echo "This installer supports macOS and Linux only."
    echo "See https://bun.sh/docs/installation for other platforms (e.g. Windows)."
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 2. Install Bun if it isn't already on PATH.
# ---------------------------------------------------------------------------
if command -v bun &> /dev/null; then
  echo -e "${GREEN}✓ Bun already installed${NC} ($(bun --version))"
else
  echo -e "${YELLOW}Bun not found — installing...${NC}"
  curl -fsSL https://bun.sh/install | bash
  # The installer writes PATH changes to shell rc files, which don't affect
  # this already-running script — make bun available for the rest of this
  # script explicitly.
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun installed but not found on PATH. Open a new shell and re-run this script.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Bun installed${NC} ($(bun --version))"
fi

# ---------------------------------------------------------------------------
# 3. Get the source — clone fresh, or update an existing checkout.
# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR/.git" ] && git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null | grep -q "Roninito/ronin"; then
    echo -e "${CYAN}Existing Ronin checkout found at $INSTALL_DIR — updating...${NC}"
    git -C "$INSTALL_DIR" pull
  else
    echo -e "${RED}❌ $INSTALL_DIR already exists and isn't a Ronin checkout.${NC}"
    echo "Set RONIN_INSTALL_DIR to a different path and re-run, or remove that directory first."
    exit 1
  fi
else
  echo -e "${CYAN}Cloning Ronin into $INSTALL_DIR...${NC}"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ---------------------------------------------------------------------------
# 4. Install dependencies.
# ---------------------------------------------------------------------------
echo -e "${CYAN}Installing dependencies...${NC}"
(cd "$INSTALL_DIR" && bun install)
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ---------------------------------------------------------------------------
# 5. Make the `ronin` command available globally.
# ---------------------------------------------------------------------------
echo -e "${CYAN}Linking the ronin command...${NC}"
(cd "$INSTALL_DIR" && bun link)
echo -e "${GREEN}✓ ronin command linked${NC}"

# ---------------------------------------------------------------------------
# 6. Done — hand off to the interactive setup wizard.
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}✅ Ronin is installed at $INSTALL_DIR${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  cd $INSTALL_DIR"
echo "  ronin init          # interactive setup wizard (recommended)"
echo ""
echo "If the 'ronin' command isn't found, open a new shell first (Bun's"
echo "installer updates your shell profile, which only takes effect in new sessions)."
echo ""
