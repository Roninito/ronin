# Creating the "Transcribe Audio" Shortcut (macOS)

The STT plugin’s **Apple** backend uses a Shortcut named **"Transcribe Audio"**. The plugin runs it from the command line with an input audio file and reads the transcribed text from the Shortcut’s output.

## 1. Create the Shortcut

1. Open **Shortcuts** (Applications or Spotlight).
2. Click **+** or **File → New Shortcut**.
3. Name it exactly: **Transcribe Audio** (required for the plugin to find it).

## 2. Configure input

1. Open the shortcut’s **details** (ℹ or right‑click → Get Info).
2. Under **Accept**, set input to **Audio** or **Files and Folders** so it can receive an audio file path when run with `-i`.
3. Optionally enable **Accept content from** → **Command Line** so it can be run from Terminal without prompts.

## 3. Add actions

The shortcut must:

- Take the provided **input** (the audio file).
- Run a **transcribe** step on that audio.
- **Output** the resulting text (so the plugin can read it via `-o`).

### Option A: Built‑in “Transcribe Audio” (if available)

On supported macOS versions, Shortcuts may have a **Transcribe Audio** or **Get Transcription of Audio** action:

1. Add **Receive** (or ensure input is passed through).
2. Add the **Transcribe Audio** / **Get Transcription of Audio** action and pass the input into it.
3. Add **Stop and Output** and choose the transcribed text as the output.

### Option B: Use Notes transcription (macOS Sequoia+)

If your Mac uses Apple Notes’ transcription:

1. Add **Create Note** (or **Append to Note**).
2. Attach the **input** (audio file) to the note.
3. Use the Notes transcription result and pass it to **Stop and Output** (or the equivalent action that returns text).

### Option C: No native action available

If there’s no built‑in transcribe action:

- Use another STT backend in the plugin: **whisper** (local) or **deepgram** (cloud).  
  See the [STT plugin](../../plugins/stt.ts) header and env vars: `STT_BACKEND`, `WHISPER_MODEL_PATH`, `DEEPGRAM_API_KEY`.
- Or build a Shortcut that calls an external API (e.g. OpenAI) and outputs the transcript as text; the plugin will read whatever text the Shortcut outputs to the file given with `-o`.

## 4. Ensure the shortcut outputs text

When run as:

```bash
shortcuts run "Transcribe Audio" -i /path/to/audio.wav -o /path/to/out.txt
```

the plugin expects the transcribed **text** to be written to the output path. So the last step of your Shortcut must be something that produces text, for example:

- **Stop and Output** with the transcribed text, or  
- An action whose result is “text” and is the final step.

Then the plugin will read that file and use it as the STT result.

## 5. Test from Terminal

```bash
# List shortcuts to confirm the name
shortcuts list

# Run with an audio file and a text output path
shortcuts run "Transcribe Audio" -i /path/to/your/audio.wav -o /tmp/transcript.txt
cat /tmp/transcript.txt
```

If that works, the STT plugin’s Apple backend will work the same way (it uses `-i` and `-o` and then reads the output file).

## Summary

| Item | Value |
|------|--------|
| Shortcut name | **Transcribe Audio** (exact) |
| Input | Audio (or file) from command line |
| Output | Transcribed text (so `-o out.txt` gets the text) |
| Run from plugin | `shortcuts run "Transcribe Audio" -i <audioPath> -o <tempFile>` |
