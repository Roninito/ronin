#!/bin/bash
# Enhanced Ronin Onboarding Script
# Interactive setup with feature selection and educational guidance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Emojis
ROBOT="🥷"
CHECK="✅"
WARN="⚠️"
INFO="ℹ️"
LOCK="🔒"
CLOUD="☁️"
COMPUTER="🖥️"
SHIELD="🛡️"

# Detect shell
SHELL_RC=""
if [ -n "$ZSH_VERSION" ] || [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ] || [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
else
  SHELL_RC="$HOME/.profile"
fi

echo ""
echo -e "${CYAN}${ROBOT} Welcome to Ronin - Your Local-First AI Agent Framework${NC}"
echo "================================================================"
echo ""
echo "Ronin brings AI agents to your local machine with:"
echo "  ${CHECK} Complete privacy - runs on your hardware"
echo "  ${CHECK} No data leaves your machine (unless YOU decide)"
echo "  ${CHECK} Powerful automation with memory and scheduling"
echo "  ${CHECK} Desktop integration for seamless workflows"
echo ""
echo "Let's set up your Ronin environment..."
echo ""

# ---------------------------------------------------------------------------
# STEP 1: Core Configuration
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${INFO} STEP 1: Core Configuration${NC}"
echo "--------------------------------"
echo ""

# Grok API Key (optional)
if [ -z "$GROK_API_KEY" ]; then
  echo -e "${YELLOW}${CLOUD} Cloud AI: Grok (xAI)${NC}"
  echo "Grok provides powerful cloud AI when you need more than local models."
  echo "  - Get a key: https://x.ai/api"
  echo "  - Ronin will use local AI by default (privacy first)"
  echo "  - Cloud AI is only used when you explicitly request it"
  echo ""
  read -r -p "Enter Grok API Key (or press Enter to skip): " grok_key
  if [ -n "$grok_key" ]; then
    echo "" >> "$SHELL_RC"
    echo "# Ronin - Grok API Key" >> "$SHELL_RC"
    echo "export GROK_API_KEY=\"$grok_key\"" >> "$SHELL_RC"
    export GROK_API_KEY="$grok_key"
    echo -e "${GREEN}${CHECK} Grok API Key configured${NC}"
  else
    echo -e "${YELLOW}${INFO} Skipped - you can add later with: ronin config --grok-api-key <key>${NC}"
  fi
else
  echo -e "${GREEN}${CHECK} Grok API Key already configured${NC}"
fi

echo ""

# Gemini API Key (optional)
if [ -z "$GEMINI_API_KEY" ]; then
  echo -e "${YELLOW}${CLOUD} Cloud AI: Gemini (Google)${NC}"
  echo "Gemini offers another cloud AI option with different capabilities."
  echo "  - Get a key: https://aistudio.google.com/app/apikey"
  echo ""
  read -r -p "Enter Gemini API Key (or press Enter to skip): " gemini_key
  if [ -n "$gemini_key" ]; then
    echo "" >> "$SHELL_RC"
    echo "# Ronin - Gemini API Key" >> "$SHELL_RC"
    echo "export GEMINI_API_KEY=\"$gemini_key\"" >> "$SHELL_RC"
    export GEMINI_API_KEY="$gemini_key"
    echo -e "${GREEN}${CHECK} Gemini API Key configured${NC}"
  else
    echo -e "${YELLOW}${INFO} Skipped - you can add later with: ronin config --gemini-api-key <key>${NC}"
  fi
else
  echo -e "${GREEN}${CHECK} Gemini API Key already configured${NC}"
fi

echo ""

# ---------------------------------------------------------------------------
# STEP 2: Offline Mode Selection (Security & Privacy)
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${SHIELD} STEP 2: Privacy & Security Settings${NC}"
echo "-----------------------------------------------"
echo ""

echo -e "${CYAN}Offline Mode${NC}"
echo "This determines Ronin's default behavior for AI requests."
echo ""
echo -e "${GREEN}Option A: Offline Mode (RECOMMENDED - Most Private)${NC}"
echo "  ${CHECK} Ronin will ONLY use local AI (Ollama)"
echo "  ${CHECK} Zero data leaves your machine"
echo "  ${CHECK} Works without internet"
echo "  ${CHECK} You can still manually use cloud AI when needed"
echo ""
echo -e "${YELLOW}Option B: Hybrid Mode${NC}"
echo "  ${CHECK} Ronin uses local AI by default"
echo "  ${CHECK} Automatically falls back to cloud for complex tasks"
echo "  ${CHECK} Some data may be sent to cloud AI providers"
echo ""

# Default to offline mode (Y/n)
read -r -p "Enable Offline Mode by default? [Y/n] (Recommended): " offline_choice
offline_choice=${offline_choice:-Y}

if [[ $offline_choice =~ ^[Yy]$ ]]; then
  echo "" >> "$SHELL_RC"
  echo "# Ronin - Default to Offline Mode (most private)" >> "$SHELL_RC"
  echo "export RONIN_OFFLINE_MODE=true" >> "$SHELL_RC"
  export RONIN_OFFLINE_MODE=true
  echo -e "${GREEN}${CHECK} Offline Mode enabled - Ronin will use local AI only${NC}"
  echo -e "${YELLOW}${INFO} Tip: You can toggle this in the menubar (🥷) or with:${NC}"
  echo "     ronin config set desktop.offlineMode false"
else
  echo "" >> "$SHELL_RC"
  echo "# Ronin - Hybrid Mode (local + cloud AI)" >> "$SHELL_RC"
  echo "export RONIN_OFFLINE_MODE=false" >> "$SHELL_RC"
  export RONIN_OFFLINE_MODE=false
  echo -e "${YELLOW}${INFO} Hybrid Mode enabled - Ronin may use cloud AI for complex tasks${NC}"
fi

echo ""

# ---------------------------------------------------------------------------
# STEP 3: Desktop Mode (macOS Integration)
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${COMPUTER} STEP 3: Desktop Mode (macOS Only)${NC}"
echo "----------------------------------------"
echo ""

# Check if macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo -e "${CYAN}Desktop Mode${NC} integrates Ronin with macOS:"
  echo "  ${CHECK} Right-click files → 'Send to Ronin' in Finder"
  echo "  ${CHECK} Menubar icon (🥷) for quick controls"
  echo "  ${CHECK} Native macOS notifications from agents"
  echo "  ${CHECK} File watching on Desktop/Downloads"
  echo ""
  echo -e "${YELLOW}What this means:${NC}"
  echo "  • Agents can see files you send them via right-click"
  echo "  • Agents can show native notifications"
  echo "  • You can toggle features from the menubar"
  echo "  • All processing still happens locally on your machine"
  echo ""
  
  read -r -p "Install Desktop Mode? [Y/n]: " desktop_choice
  desktop_choice=${desktop_choice:-Y}
  
  if [[ $desktop_choice =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}${CHECK} Desktop Mode will be installed${NC}"
    echo -e "${YELLOW}${INFO} You'll need to run 'ronin os install mac' after setup${NC}"
    
    # Set config flag
    echo "" >> "$SHELL_RC"
    echo "# Ronin - Desktop Mode requested" >> "$SHELL_RC"
    echo "export RONIN_DESKTOP_MODE=true" >> "$SHELL_RC"
    export RONIN_DESKTOP_MODE=true
  else
    echo -e "${INFO} Desktop Mode skipped${NC}"
    echo -e "${YELLOW}${INFO} You can install later with: ronin os install mac${NC}"
  fi
else
  echo -e "${YELLOW}${INFO} Desktop Mode is only available on macOS${NC}"
  echo "Your system: $OSTYPE"
fi

echo ""

# ---------------------------------------------------------------------------
# STEP 4: Cloudflare Integration (Optional - for remote access)
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${CLOUD} STEP 4: Cloudflare Integration (Optional)${NC}"
echo "------------------------------------------------"
echo ""

echo -e "${CYAN}What is this?${NC}"
echo "Cloudflare integration lets you:"
echo "  ${CHECK} Create secure tunnels to share Ronin dashboard remotely"
echo "  ${CHECK} Deploy agents to the edge (Cloudflare Workers)"
echo "  ${CHECK} Access your local Ronin from anywhere (securely)"
echo ""
echo -e "${SHIELD}${YELLOW} IMPORTANT - Security Model:${NC}"
echo "Ronin's Cloudflare integration uses ZERO-TRUST security:"
echo "  ${LOCK} NOTHING is exposed by default"
echo "  ${LOCK} You must explicitly whitelist each route"
echo "  ${LOCK} Dangerous paths (/disk, /admin) are always blocked"
echo "  ${LOCK} Optional: time-based access, authentication required"
echo "  ${LOCK} Audit logs of all access attempts"
echo ""
echo -e "${CYAN}Use cases:${NC}"
echo "  • Share your dashboard with team members temporarily"
echo "  • Demo Ronin to clients without deploying"
echo "  • Access your agents while traveling"
echo "  • Webhook endpoints that trigger agents"
echo ""

read -r -p "Set up Cloudflare integration? [y/N]: " cf_choice
cf_choice=${cf_choice:-N}

if [[ $cf_choice =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${CYAN}Installing Cloudflare tools...${NC}"
  
  # Check/install Wrangler
  if ! command -v wrangler &> /dev/null; then
    echo "Installing Wrangler CLI..."
    npm install -g wrangler
    echo -e "${GREEN}${CHECK} Wrangler installed${NC}"
  else
    echo -e "${GREEN}${CHECK} Wrangler already installed${NC}"
  fi
  
  # Check/install cloudflared
  if ! command -v cloudflared &> /dev/null; then
    echo ""
    echo "Installing cloudflared daemon..."
    
    # Detect OS and install appropriately
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS
      if command -v brew &> /dev/null; then
        brew install cloudflared
      else
        echo -e "${YELLOW}Please install Homebrew first: https://brew.sh${NC}"
        echo "Then run: brew install cloudflared"
      fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      # Linux
      if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
        sudo dpkg -i cloudflared.deb
        rm cloudflared.deb
      elif command -v yum &> /dev/null; then
        # RHEL/CentOS
        curl -L --output cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
        sudo rpm -i cloudflared.rpm
        rm cloudflared.rpm
      else
        # Generic binary
        curl -L --output cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
        chmod +x cloudflared
        sudo mv cloudflared /usr/local/bin/
      fi
    fi
    
    echo -e "${GREEN}${CHECK} cloudflared installed${NC}"
  else
    echo -e "${GREEN}${CHECK} cloudflared already installed${NC}"
  fi
  
  echo ""
  echo -e "${CYAN}Authentication${NC}"
  echo "You'll now authenticate with Cloudflare via your browser."
  echo "This gives Ronin permission to create tunnels on your behalf."
  echo ""
  echo -e "${YELLOW}Press Enter to open browser authentication...${NC}"
  read -r
  
  # Run Wrangler login
  wrangler login
  
  echo ""
  echo -e "${GREEN}${CHECK} Cloudflare authentication complete!${NC}"
  echo ""
  echo -e "${CYAN}Next steps for Cloudflare:${NC}"
  echo "  1. Initialize route policy: ronin cloudflare route init"
  echo "  2. Add routes you want to expose: ronin cloudflare route add /dashboard"
  echo "  3. Create tunnel: ronin cloudflare tunnel create my-tunnel"
  echo ""
  echo -e "${YELLOW}Remember:${NC} Nothing is exposed until you explicitly whitelist it!"
  
  # Set config flag
  echo "" >> "$SHELL_RC"
  echo "# Ronin - Cloudflare integration enabled" >> "$SHELL_RC"
  echo "export RONIN_CLOUDFLARE_ENABLED=true" >> "$SHELL_RC"
  export RONIN_CLOUDFLARE_ENABLED=true
else
  echo -e "${INFO} Cloudflare integration skipped${NC}"
  echo -e "${YELLOW}${INFO} You can set up later with: ronin cloudflare login${NC}"
fi

echo ""

# ---------------------------------------------------------------------------
# STEP 5: Ollama Configuration
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${ROBOT} STEP 5: Ollama (Local AI) Configuration${NC}"
echo "---------------------------------------------------"
echo ""

# Check if Ollama is installed
if command -v ollama &> /dev/null; then
  echo -e "${GREEN}${CHECK} Ollama is installed${NC}"
  
  # Check if qwen model is available
  if ollama list | grep -q "qwen"; then
    echo -e "${GREEN}${CHECK} Qwen model found${NC}"
  else
    echo -e "${YELLOW}${INFO} Downloading recommended model (qwen3:1.7b)...${NC}"
    echo "This is a lightweight but capable model for local use."
    ollama pull qwen3:1.7b
    echo -e "${GREEN}${CHECK} Model ready${NC}"
  fi
else
  echo -e "${YELLOW}${WARN} Ollama not found${NC}"
  echo ""
  echo "Ollama is REQUIRED for Ronin to work. It provides local AI capabilities."
  echo ""
  echo "Install options:"
  
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  macOS:   brew install ollama"
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "  Linux:   curl -fsSL https://ollama.com/install.sh | sh"
  fi
  
  echo "  Docker:  docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama"
  echo "  More:    https://ollama.com/download"
  echo ""
  echo -e "${RED}Please install Ollama, then re-run this setup script.${NC}"
fi

echo ""

# ---------------------------------------------------------------------------
# STEP 6: Summary & Next Steps
# ---------------------------------------------------------------------------
echo -e "${PURPLE}${ROBOT} Setup Complete!${NC}"
echo "=============="
echo ""

echo -e "${GREEN}What's been configured:${NC}"

if [ -n "$GROK_API_KEY" ]; then
  echo "  ${CHECK} Grok API Key"
fi

if [ -n "$GEMINI_API_KEY" ]; then
  echo "  ${CHECK} Gemini API Key"
fi

if [ "$RONIN_OFFLINE_MODE" = "true" ]; then
  echo "  ${CHECK} Offline Mode (most private)"
else
  echo "  ${CHECK} Hybrid Mode (local + cloud)"
fi

if [ "$RONIN_DESKTOP_MODE" = "true" ]; then
  echo "  ${CHECK} Desktop Mode (macOS integration)"
fi

if [ "$RONIN_CLOUDFLARE_ENABLED" = "true" ]; then
  echo "  ${CHECK} Cloudflare integration"
fi

echo ""
echo -e "${CYAN}Configuration saved to:${NC} $SHELL_RC"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT: Reload your shell to apply changes:${NC}"
echo "     source $SHELL_RC"
echo ""

echo -e "${CYAN}Quick Start Commands:${NC}"
echo ""
echo "  # Start Ronin with all agents"
echo "  ronin start"
echo ""
echo "  # Create your first agent"
echo "  ronin create agent 'monitor system logs'"
echo ""
echo "  # Ask a question (uses local AI by default)"
echo "  ronin ask 'How do I create a scheduled agent?'"
echo ""

if [ "$RONIN_DESKTOP_MODE" = "true" ]; then
  echo "  # Enable Desktop Mode (after restart)"
  echo "  ronin os install mac"
  echo "  ronin config set desktop.enabled true"
  echo ""
fi

if [ "$RONIN_CLOUDFLARE_ENABLED" = "true" ]; then
  echo "  # Set up Cloudflare tunnel"
  echo "  ronin cloudflare route init"
  echo "  ronin cloudflare tunnel create my-tunnel"
  echo ""
fi

echo -e "${CYAN}Documentation:${NC}"
echo "  ronin docs                    # View all docs"
echo "  ronin docs CLI                # CLI reference"
echo "  ronin docs DESKTOP_MODE       # Desktop Mode guide"
echo ""

echo -e "${GREEN}Welcome to Ronin! 🥷${NC}"
echo "Your local-first AI agent framework is ready."
echo ""

# ---------------------------------------------------------------------------
# Optional: Start Ronin now?
# ---------------------------------------------------------------------------
read -r -p "Would you like to start Ronin now? [y/N]: " start_now
if [[ $start_now =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${CYAN}Starting Ronin...${NC}"
  echo ""
  
  if [ "$RONIN_DESKTOP_MODE" = "true" ]; then
    ronin start --desktop
  else
    ronin start
  fi
fi
