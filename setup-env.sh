#!/bin/bash
# Setup script for Ronin environment variables

echo "🔧 Ronin Environment Setup"
echo "=========================="
echo ""

# Check current shell
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
else
  SHELL_RC="$HOME/.profile"
fi

echo "📝 Adding to: $SHELL_RC"
echo ""

# Grok API Key
if [ -z "$GROK_API_KEY" ]; then
  echo "Enter your Grok API Key (or press Enter to skip):"
  read -r grok_key
  if [ -n "$grok_key" ]; then
    echo "" >> "$SHELL_RC"
    echo "# Ronin - Grok API Key" >> "$SHELL_RC"
    echo "export GROK_API_KEY=\"$grok_key\"" >> "$SHELL_RC"
    export GROK_API_KEY="$grok_key"
    echo "✅ GROK_API_KEY set"
  fi
else
  echo "✅ GROK_API_KEY already set"
fi

# Gemini API Key
if [ -z "$GEMINI_API_KEY" ]; then
  echo ""
  echo "Enter your Gemini API Key (or press Enter to skip):"
  read -r gemini_key
  if [ -n "$gemini_key" ]; then
    echo "" >> "$SHELL_RC"
    echo "# Ronin - Gemini API Key" >> "$SHELL_RC"
    echo "export GEMINI_API_KEY=\"$gemini_key\"" >> "$SHELL_RC"
    export GEMINI_API_KEY="$gemini_key"
    echo "✅ GEMINI_API_KEY set"
  fi
else
  echo "✅ GEMINI_API_KEY already set"
fi

# Ollama GPU Configuration (for Intel GPUs)
echo ""
echo "🔧 Ollama GPU Configuration"
echo "Your system shows: Intel Haswell-ULT Integrated Graphics"
echo ""
echo "Note: Intel integrated GPUs on Linux may not be fully supported by Ollama."
echo "Ollama currently shows: 100% CPU usage (GPU not detected)"
echo ""

echo "Attempting to configure Ollama for GPU acceleration..."
echo "" >> "$SHELL_RC"
echo "# Ronin - Ollama GPU Configuration" >> "$SHELL_RC"
echo "export OLLAMA_NUM_GPU=1" >> "$SHELL_RC"
echo "export OLLAMA_GPU_LAYERS=20" >> "$SHELL_RC"  # Conservative for Intel GPU
export OLLAMA_NUM_GPU=1
export OLLAMA_GPU_LAYERS=20

echo "✅ Added Ollama GPU environment variables"
echo ""
echo "⚠️  Important: Restart Ollama for GPU settings to take effect:"
echo "   sudo systemctl restart ollama"
echo "   # or if running manually:"
echo "   pkill ollama && ollama serve"
echo ""
echo "📚 Documentation created:"
echo "   - docs/REMOTE_AI.md (Grok setup guide)"
echo "   - docs/OLLAMA_GPU.md (GPU configuration guide)"
echo ""
echo "💡 Tip: If GPU acceleration doesn't work, use remote models:"
echo "   ronin ask grok \"your question\""

