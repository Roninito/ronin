#!/bin/bash
# Script to check Ollama GPU usage and validate configuration

echo "🔍 Ollama GPU Validation"
echo "======================="
echo ""

# Check current Ollama status
echo "1. Current Ollama Status:"
ollama ps 2>&1 | head -5
echo ""

# Check GPU hardware
echo "2. GPU Hardware:"
lspci | grep -i -E "vga|display|3d" 2>&1
echo ""

# Check environment variables
echo "3. Environment Variables:"
echo "   OLLAMA_NUM_GPU: ${OLLAMA_NUM_GPU:-not set}"
echo "   OLLAMA_GPU_LAYERS: ${OLLAMA_GPU_LAYERS:-not set}"
echo ""

# Check if intel_gpu_top is available
echo "4. GPU Monitoring Tools:"
if command -v intel_gpu_top &> /dev/null; then
  echo "   ✅ intel_gpu_top available"
  echo "   Run 'intel_gpu_top' in another terminal to monitor GPU usage"
else
  echo "   ❌ intel_gpu_top not found"
  echo "   Install with: sudo pacman -S intel-gpu-tools"
fi
echo ""

# Test inference and check CPU/GPU usage
echo "5. Testing Inference (this will take a moment)..."
echo "   Running: ollama run qwen3:0.6b 'test'"
echo "   Watch CPU/GPU usage in another terminal with: htop or intel_gpu_top"
echo ""

time ollama run qwen3:0.6b "test" 2>&1 | tail -3
echo ""

# Check Ollama process
echo "6. Ollama Process Info:"
ps aux | grep -i ollama | grep -v grep | head -2
echo ""

# Recommendations
echo "📋 Recommendations:"
echo ""

if ollama ps 2>&1 | grep -q "100% CPU"; then
  echo "   ⚠️  Ollama is using CPU only (100% CPU detected)"
  echo ""
  echo "   For Intel GPUs on Linux:"
  echo "   1. Set environment variables:"
  echo "      export OLLAMA_NUM_GPU=1"
  echo "      export OLLAMA_GPU_LAYERS=20"
  echo ""
  echo "   2. Restart Ollama:"
  echo "      sudo systemctl restart ollama"
  echo "      # or: pkill ollama && ollama serve"
  echo ""
  echo "   3. Check again: ollama ps"
  echo ""
  echo "   ⚠️  Note: Intel integrated GPUs may not be fully supported."
  echo "      If GPU acceleration doesn't work, consider using remote models:"
  echo "      ronin ask grok 'your question'"
else
  echo "   ✅ GPU appears to be in use (not showing 100% CPU)"
fi

echo ""
echo "💡 Alternative: Use Remote Models"
echo "   Set GROK_API_KEY and use: ronin ask grok 'question'"
echo "   This bypasses local GPU issues entirely"

