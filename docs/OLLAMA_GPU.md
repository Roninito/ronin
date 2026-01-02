# Ollama GPU Configuration Guide

## Checking GPU Usage

### Verify GPU Detection

```bash
# Check if Ollama detects your GPU
ollama ps

# Check GPU info
lspci | grep -i vga
lspci | grep -i display

# For Intel GPUs
intel_gpu_top  # If available
```

### Monitor GPU Usage During Inference

```bash
# In one terminal, watch GPU usage
watch -n 1 intel_gpu_top

# In another terminal, run a test
ollama run qwen3:0.6b "test prompt"
```

## Forcing GPU Usage

### Intel Iris GPU Setup

Intel GPUs use different acceleration methods:

1. **Check Ollama Version**
   ```bash
   ollama --version
   ```

2. **Set Environment Variables**
   
   For Intel GPUs on Linux, Ollama may use CPU by default. Try:
   
   ```bash
   # Force GPU usage (may not work for all Intel GPUs)
   export OLLAMA_NUM_GPU=1
   export OLLAMA_GPU_LAYERS=20  # Conservative for Intel integrated GPU
   
   # Add to ~/.bashrc or ~/.zshrc for persistence
   echo 'export OLLAMA_NUM_GPU=1' >> ~/.bashrc
   echo 'export OLLAMA_GPU_LAYERS=20' >> ~/.bashrc
   source ~/.bashrc
   ```
   
   **⚠️ Note**: Intel integrated GPUs on Linux may have limited or no support in Ollama.
   If `ollama ps` still shows "100% CPU" after restarting, GPU acceleration may not be available.

3. **Check Model Configuration**
   
   Some models may need specific settings. Check:
   ```bash
   ollama show qwen3:0.6b
   ```

4. **Verify GPU Acceleration**
   
   Run a test and monitor:
   ```bash
   # Terminal 1: Monitor
   watch -n 1 'ps aux | grep ollama'
   
   # Terminal 2: Test
   ollama run qwen3:0.6b "test"
   ```

### Alternative: Use Remote Models

If local GPU acceleration isn't working well, consider using remote models:

```bash
# Use Grok instead of local
ronin ask grok "your question"

# This bypasses local GPU issues entirely
```

## Troubleshooting Slow Responses

### Check Ollama Performance

```bash
# Test response time
time ollama run qwen3:0.6b "test prompt"

# Check if model is loaded in GPU memory
ollama ps

# Monitor system resources
htop  # or top
```

### Optimize Model Settings

1. **Reduce Context Size**
   - Use smaller models
   - Limit max tokens in prompts

2. **Use Quantized Models**
   - qwen3:0.6b is already quantized
   - Consider even smaller quantizations

3. **Adjust Ollama Settings**
   ```bash
   # In ~/.ollama/config or environment
   export OLLAMA_NUM_THREAD=4
   export OLLAMA_MAX_LOADED_MODELS=1
   ```

### Switch to Remote Models

If local performance is consistently slow:

```bash
# Use Grok for faster responses
export GROK_API_KEY="your-key"
ronin ask grok "question"

# Remote models often have better GPU acceleration
```

## Environment Variables Summary

### For Ollama GPU
```bash
export OLLAMA_NUM_GPU=1
export OLLAMA_GPU_LAYERS=35
export OLLAMA_NUM_THREAD=4
```

### For Remote AI
```bash
export GROK_API_KEY="your-grok-api-key"
export GEMINI_API_KEY="your-gemini-api-key"  # When available
```

Add these to `~/.bashrc` or `~/.zshrc` for persistence.

