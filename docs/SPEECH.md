# Speech Guide: Voice Integration for Ronin

Ronin provides comprehensive speech capabilities through two powerful plugins: **Piper TTS** for text-to-speech and **STT** for speech-to-text. Both support local processing for privacy and offline operation.

## Table of Contents

- [Overview](#overview)
- [Piper TTS (Text-to-Speech)](#piper-tts-text-to-speech)
  - [Installation](#piper-installation)
  - [Voice Models](#voice-models)
  - [Configuration](#piper-configuration)
  - [Usage Examples](#piper-usage)
- [STT (Speech-to-Text)](#stt-speech-to-text)
  - [Backends](#stt-backends)
  - [macOS Native Setup](#macos-native-setup)
  - [Whisper.cpp Setup](#whispercpp-setup)
  - [Deepgram Setup](#deepgram-setup)
  - [Usage Examples](#stt-usage)
- [Agent Integration](#agent-integration)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)

---

## Overview

Ronin's speech system enables agents to:

- 🔊 **Speak responses** using natural neural voices
- 🎤 **Transcribe audio** from files or microphone
- 🗣️ **Build voice interfaces** for hands-free operation
- 🔒 **Process locally** without sending data to the cloud
- ⚡ **Operate offline** once models are downloaded

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Ronin Agent                           │
│  ┌──────────────┐              ┌──────────────┐         │
│  │   Piper TTS  │              │     STT      │         │
│  │   Plugin     │              │   Plugin     │         │
│  └──────┬───────┘              └──────┬───────┘         │
└─────────┼─────────────────────────────┼─────────────────┘
          │                             │
    ┌─────▼─────┐               ┌───────▼────────┐
    │  Piper    │               │ Apple/Whisper/ │
    │  Binary   │               │ Deepgram       │
    └─────┬─────┘               └───────┬────────┘
          │                             │
    ┌─────▼─────┐               ┌───────▼────────┐
    │  ONNX     │               │ Audio Input    │
    │  Models   │               │ (Mic/Files)    │
    └───────────┘               └────────────────┘
```

---

## Piper TTS (Text-to-Speech)

Piper provides fast, local neural text-to-speech synthesis. It's perfect for:
- Audible agent notifications
- Voice responses in chat interfaces
- Accessibility features
- Hands-free status updates

### Key Features

- ⚡ **Real-time synthesis** on CPU
- 🔒 **100% private** - no network required
- 🎯 **High quality** neural voices
- 💾 **Small footprint** (~50-100MB per model)
- 🔊 **Multiple speakers** per model
- 🌍 **Multilingual** support

### Piper Installation

#### macOS (Homebrew)

```bash
brew install piper-tts
```

#### Linux

```bash
# Download latest release
wget https://github.com/rhasspy/piper/releases/latest/download/piper_amd64.tar.gz
tar -xzf piper_amd64.tar.gz
sudo mv piper /usr/local/bin/
```

#### Windows

Download from [Piper Releases](https://github.com/rhasspy/piper/releases) and add to PATH.

### Voice Models

Download voice models from the [Piper Voices repository](https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0):

#### Recommended English Voices

```bash
# Create models directory
mkdir -p ~/.local/share/piper

# Download a medium-quality voice (recommended balance)
wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
  -O ~/.local/share/piper/en_US-lessac-medium.onnx

# Download config file too
wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json \
  -O ~/.local/share/piper/en_US-lessac-medium.onnx.json
```

#### Available Voices

| Language | Voice | Quality | Size | Style |
|----------|-------|---------|------|-------|
| en_US | lessac | medium | ~80MB | Neutral, clear |
| en_US | amy | medium | ~80MB | Female |
| en_US | ryan | high | ~110MB | Male |
| en_GB | southern_english_female | low | ~30MB | Female, British |
| de_DE | thorsten | medium | ~80MB | Male, German |
| fr_FR | siwis | medium | ~80MB | Female, French |
| es_ES | david | medium | ~80MB | Male, Spanish |

### Piper Configuration

Set environment variables:

```bash
# Required: Path to your voice model
export PIPER_MODEL_PATH="$HOME/.local/share/piper/en_US-lessac-medium.onnx"

# Optional: Path to piper binary (if not in PATH)
export PIPER_BINARY="/usr/local/bin/piper"

# Optional: Default speaker ID (for multi-speaker models)
export PIPER_SPEAKER_ID=0

# Optional: Default speech speed (0.5 = fast, 2.0 = slow)
export PIPER_LENGTH_SCALE=1.0
```

Add to your `~/.zshrc` or `~/.bashrc` for persistence.

### Piper Usage

#### Basic Speech Synthesis

```typescript
// In your agent
async execute(): Promise<void> {
  // Check if Piper is available
  if (!this.api.piper) {
    console.log("Piper plugin not available");
    return;
  }

  // Synthesize speech to file
  const { audioPath, duration } = await this.api.piper.speak(
    "Task completed successfully!"
  );
  
  console.log(`Generated ${duration}s audio at: ${audioPath}`);
  
  // Audio file is saved at audioPath (WAV format)
  // Clean up when done
  await this.api.files.delete(audioPath);
}
```

#### Speak and Play Immediately

```typescript
// Synthesize and play in one call
await this.api.piper.speakAndPlay("Agent started. Monitoring for tasks.");

// Platform-specific audio players are used automatically:
// - macOS: afplay
// - Linux: paplay (PulseAudio)
// - Windows: PowerShell Media.SoundPlayer
```

#### Advanced Options

```typescript
// Control speech parameters
const result = await this.api.piper.speak(
  "This is slower speech for emphasis",
  {
    lengthScale: 1.3,      // Slower (default: 1.0)
    noiseScale: 0.667,     // Noise during generation
    noiseW: 0.8,          // Phoneme width variance
    speakerId: 0,         // For multi-speaker models
    outputPath: "/custom/path/output.wav"
  }
);

// Use a different voice model for this call
await this.api.piper.speak("Hello", {
  modelPath: "/path/to/different/voice.onnx"
});
```

#### Get Voice Information

```typescript
const info = await this.api.piper.getVoiceInfo();
console.log(`Using voice: ${info.modelName}`);
console.log(`Language: ${info.language}`);
console.log(`Model path: ${info.modelPath}`);
```

---

## STT (Speech-to-Text)

The STT plugin provides flexible speech recognition with multiple backends to suit different needs and platforms.

### STT Backends

| Backend | Platform | Privacy | Quality | Setup Complexity |
|---------|----------|---------|---------|------------------|
| **Apple** | macOS only | 🔒 Local | ⭐⭐⭐⭐⭐ | Easy |
| **Whisper** | All | 🔒 Local | ⭐⭐⭐⭐ | Medium |
| **Deepgram** | All | ☁️ Cloud | ⭐⭐⭐⭐⭐ | Easy |

### macOS Native Setup

Uses macOS built-in speech recognition. Best quality for Apple users.

#### Prerequisites

1. Open **Shortcuts** app on your Mac
2. Create a new Shortcut named **"Transcribe Audio"**
3. Add action: **"Transcribe Audio File"** (from the Media category)
4. Configure to accept audio files
5. Save the shortcut

#### Configuration

```bash
export STT_BACKEND=apple
```

That's it! No additional downloads required.

### Whisper.cpp Setup

OpenAI's Whisper running locally via whisper.cpp. Great for privacy and works on all platforms.

#### Installation

```bash
# Clone whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# Build
make

# Or for better performance with OpenBLAS:
make WHISPER_OPENBLAS=1
```

#### Download Model

```bash
# Download a model (base.en is recommended for English)
bash models/download-ggml-model.sh base.en

# Available models:
# - tiny.en (75 MB) - Fastest, lower accuracy
# - base.en (142 MB) - Good balance (recommended)
# - small.en (466 MB) - Better accuracy
# - medium.en (1.5 GB) - Best accuracy, slower
```

#### Configuration

```bash
export STT_BACKEND=whisper
export WHISPER_MODEL_PATH="$HOME/whisper.cpp/models/ggml-base.en.bin"
export WHISPER_BINARY="$HOME/whisper.cpp/main"
```

### Deepgram Setup

Cloud-based STT with excellent accuracy. Requires API key.

#### Configuration

```bash
export STT_BACKEND=deepgram
export DEEPGRAM_API_KEY="your-api-key-here"
```

Get your API key from [Deepgram Console](https://console.deepgram.com).

### STT Usage

#### Transcribe Audio File

```typescript
// Basic transcription
const result = await this.api.stt.transcribe("/path/to/recording.wav");
console.log(`Transcribed: ${result.text}`);

// With language specification (for Whisper/Deepgram)
const result = await this.api.stt.transcribe("/path/to/recording.wav", {
  language: "en"
});

// Force specific backend
const result = await this.api.stt.transcribe("/path/to/recording.wav", {
  backend: "whisper"
});
```

#### Record and Transcribe (macOS only)

```typescript
// Record 5 seconds from microphone and transcribe
const { text, audioPath } = await this.api.stt.recordAndTranscribe(5);

console.log(`You said: ${text}`);
console.log(`Recording saved at: ${audioPath}`);

// Clean up recording
await this.api.files.delete(audioPath);
```

**Note:** Requires `sox` to be installed:
```bash
brew install sox
```

#### List Available Backends

```typescript
const backends = await this.api.stt.listBackends();
console.log("Available STT backends:", backends);
// Output: ["apple (macOS native)", "whisper (local)", "deepgram (cloud)"]
```

---

## Agent Integration

### Voice-Enabled Agent Example

```typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class VoiceAssistant extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Greet user with speech
    if (this.api.piper) {
      await this.api.piper.speakAndPlay(
        "Voice assistant ready. Listening for commands."
      );
    }

    // Example: Transcribe a voice command
    if (this.api.stt && process.platform === "darwin") {
      try {
        const { text } = await this.api.stt.recordAndTranscribe(5);
        
        console.log(`Command received: ${text}`);
        
        // Process command
        if (text.toLowerCase().includes("status")) {
          const response = "All systems operational.";
          await this.api.piper?.speakAndPlay(response);
        }
      } catch (error) {
        console.error("Speech recognition failed:", error);
        await this.api.piper?.speakAndPlay(
          "Sorry, I didn't catch that."
        );
      }
    }
  }
}
```

### Integration with Voice Messaging Agent

The built-in `voice-messaging.ts` agent can use these plugins:

```typescript
// In voice-messaging agent
private async relayMessage(message: QueuedMessage): Promise<void> {
  const announcement = `Message from ${message.from}: ${message.content}`;
  
  // Use Piper TTS instead of console log
  if (this.api.piper) {
    await this.api.piper.speakAndPlay(announcement);
  } else {
    console.log(`🔊 ${announcement}`);
  }
}
```

---

## Configuration Reference

### Environment Variables Summary

#### Piper TTS

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PIPER_MODEL_PATH` | Yes | - | Path to ONNX voice model |
| `PIPER_BINARY` | No | `piper` | Path to piper executable |
| `PIPER_SPEAKER_ID` | No | `0` | Default speaker ID |
| `PIPER_LENGTH_SCALE` | No | `1.0` | Default speech speed |

#### STT

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STT_BACKEND` | No | Auto-detect | Backend: `apple`, `whisper`, `deepgram` |
| `WHISPER_MODEL_PATH` | For Whisper | - | Path to Whisper model |
| `WHISPER_BINARY` | No | `whisper-cli` | Path to whisper executable |
| `DEEPGRAM_API_KEY` | For Deepgram | - | Deepgram API key |

### Ronin Configuration

Add to your `~/.ronin/config.json`:

```json
{
  "piper": {
    "modelPath": "/Users/you/.local/share/piper/en_US-lessac-medium.onnx"
  },
  "stt": {
    "backend": "whisper",
    "whisperModelPath": "/Users/you/whisper.cpp/models/ggml-base.en.bin"
  }
}
```

---

## Troubleshooting

### Piper TTS Issues

#### "Piper model path not configured"

```bash
# Set the environment variable
export PIPER_MODEL_PATH="/path/to/your/voice.onnx"

# Or in your shell profile
echo 'export PIPER_MODEL_PATH="/path/to/your/voice.onnx"' >> ~/.zshrc
```

#### "Failed to run piper"

- Ensure piper is installed: `which piper`
- Check binary permissions: `chmod +x /path/to/piper`
- Verify model file exists: `ls -la $PIPER_MODEL_PATH`

#### Audio playback not working

**macOS:**
```bash
# Test audio system
afplay /System/Library/Sounds/Glass.aiff
```

**Linux:**
```bash
# Install PulseAudio utilities
sudo apt-get install pulseaudio-utils

# Test
paplay /usr/share/sounds/freedesktop/stereo/complete.oga
```

### STT Issues

#### "No STT backend available"

- On macOS: Set `STT_BACKEND=apple` and create the Shortcuts workflow
- On other platforms: Install Whisper.cpp or set Deepgram API key

#### Whisper "Model not found"

```bash
# Verify model path
ls -la $WHISPER_MODEL_PATH

# Should show: ggml-base.en.bin or similar
```

#### "Recording failed" on macOS

```bash
# Install sox for microphone recording
brew install sox

# Grant microphone permissions to Terminal/iTerm
# System Preferences > Security & Privacy > Microphone
```

#### Apple STT not working

- Ensure Shortcuts app has permission to run AppleScript
- Check that the "Transcribe Audio" shortcut exists and works manually
- Try running the shortcut directly in Shortcuts app first

### General Issues

#### Plugin not available in agent

```typescript
// Check if plugin is loaded
if (!this.api.piper) {
  console.error("Piper plugin not loaded. Check plugins directory.");
  return;
}
```

Verify plugins are in the correct location:
```bash
ls -la /Users/ronin/Desktop/Bun Apps/ronin/plugins/piper-tts.ts
ls -la /Users/ronin/Desktop/Bun Apps/ronin/plugins/stt.ts
```

#### Audio file format issues

Both plugins work best with:
- Format: WAV
- Sample rate: 16000 Hz (16 kHz)
- Channels: Mono (1 channel)
- Bit depth: 16-bit

Convert files if needed:
```bash
sox input.mp3 -r 16000 -c 1 -b 16 output.wav
```

---

## Best Practices

1. **Use environment variables** for configuration in production
2. **Download voices** ahead of time for offline operation
3. **Test audio levels** - Piper output should be clear at normal volume
4. **Handle errors gracefully** - Always check if plugins are available
5. **Clean up temp files** - Audio files are not auto-deleted
6. **Choose appropriate models** - Base.en for speed, Medium for accuracy
7. **Use Apple STT on Mac** - Best quality and no setup required
8. **Cache transcriptions** - Save STT results to avoid re-processing

---

## Resources

- [Piper TTS GitHub](https://github.com/rhasspy/piper)
- [Piper Voices HuggingFace](https://huggingface.co/rhasspy/piper-voices)
- [Whisper.cpp GitHub](https://github.com/ggerganov/whisper.cpp)
- [Deepgram Documentation](https://developers.deepgram.com/)
- [Ronin Plugins Guide](./PLUGINS.md)

---

**Note:** Both plugins are fully local (except Deepgram STT backend), meaning your speech data never leaves your machine. Perfect for privacy-conscious applications!
