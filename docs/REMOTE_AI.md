# Remote AI Providers Guide

## Setting Up Remote AI Providers

### Grok Plugin

The Grok plugin allows you to use Grok AI (xAI) for remote AI calls with streaming support.

#### Setup

1. **Get a Grok API Key**
   - Sign up at https://x.ai
   - Get your API key from the developer dashboard

2. **Set Environment Variable**

   ```bash
   # For current session
   export GROK_API_KEY="your-api-key-here"
   
   # For permanent setup, add to ~/.bashrc or ~/.zshrc
   echo 'export GROK_API_KEY="your-api-key-here"' >> ~/.bashrc
   source ~/.bashrc
   
   # Or use the setup script
   ./setup-env.sh
   ```

3. **Verify Setup**

   ```bash
   # Check if key is set
   echo $GROK_API_KEY
   
   # Test the plugin
   bun run ronin ask grok "Hello, test message"
   ```

#### Usage

```bash
# Single question with Grok
bun run ronin ask grok "explain how plugins work"

# Interactive mode with Grok
bun run ronin ask grok

# Use local (default) instead
bun run ronin ask local "question"
bun run ronin ask "question"  # defaults to local
```

### Gemini Plugin

The Gemini plugin allows you to use Google Gemini AI for remote AI calls with streaming support.

#### Setup

1. **Get a Gemini API Key**
   - Go to https://aistudio.google.com/app/apikey
   - Create a new API key

2. **Set Environment Variable**

   ```bash
   # For current session
   export GEMINI_API_KEY="your-api-key-here"
   
   # For permanent setup, add to ~/.bashrc or ~/.zshrc
   echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.bashrc
   source ~/.bashrc
   
   # Or use the setup script
   ./setup-env.sh
   ```

3. **Verify Setup**

   ```bash
   # Check if key is set
   echo $GEMINI_API_KEY
   
   # Test the plugin
   bun run ronin ask gemini "Hello, test message"
   ```

#### Usage

```bash
# Single question with Gemini
bun run ronin ask gemini "explain how plugins work"

# Interactive mode with Gemini
bun run ronin ask gemini
```

## Model Selection

The `ask` command supports multiple AI providers:

- **local** (default) - Uses Ollama with local models
- **grok** - Uses Grok API (requires GROK_API_KEY)
- **gemini** - Uses Gemini API (requires GEMINI_API_KEY)

### Examples

```bash
# Use local Ollama (default)
ronin ask "how do plugins work?"

# Explicitly use local
ronin ask local "how do plugins work?"

# Use Grok
ronin ask grok "how do plugins work?"

# Use Gemini (when available)
ronin ask gemini "how do plugins work?"
```

## Creating Custom Remote AI Plugins

You can create plugins for other AI providers by following the Grok plugin pattern:

1. Create a plugin file in `plugins/` directory
2. Implement `chat()` method for non-streaming
3. Implement `streamChat()` method for streaming (returns AsyncIterable<string>)
4. Use environment variables for API keys
5. Follow the Plugin interface from `src/plugins/base.ts`

Example structure:

```typescript
import type { Plugin } from "../src/plugins/base.js";

const myAIPlugin: Plugin = {
  name: "myai",
  description: "My AI provider plugin",
  methods: {
    chat: async (messages, options) => {
      // Non-streaming implementation
    },
    streamChat: function (messages, options) {
      // Streaming implementation (returns AsyncIterable)
    },
  },
};

export default myAIPlugin;
```

