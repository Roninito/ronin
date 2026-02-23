# Python Bridge Plugin

Enable Ronin plugins to execute Python code and communicate with Python subprocesses via IPC. This plugin provides the foundation for integrating with Reticulum, ML libraries, data science tools, and any other Python ecosystem.

## Features

- ✅ **Inline Execution** - Run Python code one-off with `api.python.execute()`
- ✅ **Persistent Backends** - Spawn long-running Python processes with `api.python.spawn()`
- ✅ **JSON-over-IPC** - Reliable message framing with null-byte delimiters
- ✅ **Async Events** - Python can push notifications to Bun
- ✅ **Error Handling** - Full stack traces from Python exceptions
- ✅ **Type-Safe** - TypeScript types for all bridge methods

## Quick Start

### 1. Check Python Availability

```typescript
const hasPython = await api.python?.hasPython();
if (!hasPython) {
  console.error("Python 3 not found. Please install Python 3.8+");
  return;
}

const version = await api.python?.getPythonVersion();
console.log("Python version:", version);
```

### 2. Execute Python Code Inline

```typescript
// Simple execution
const result = await api.python?.execute("return {'hello': 'world'}");
console.log(result); // { hello: "world" }

// With imports
const result = await api.python?.execute(`
import json
data = {"sum": 2 + 2, "items": [1, 2, 3]}
return json.dumps(data)
`);

// With parameters (via string interpolation)
const value = 42;
const result = await api.python?.execute(`
value = ${value}
return {"squared": value ** 2}
`);
```

### 3. Spawn a Persistent Backend

```typescript
// Spawn backend
const backend = await api.python?.spawn("plugins/python/examples/echo_backend.py");

// Call methods
const echo = await backend?.call("echo", { data: "Hello from Bun!" });
console.log(echo); // { echo: "Hello from Bun!", timestamp: 1234567890 }

const count = await backend?.call("get_count");
console.log(count); // { count: 0 }

await backend?.call("increment");
const newCount = await backend?.call("get_count");
console.log(newCount); // { count: 1 }

// Cleanup
await backend?.terminate();
```

### 4. Handle Async Events

```typescript
// Python can send async notifications
backend?.on("message", (data) => {
  console.log("Async message from Python:", data);
});

backend?.on("status_update", (data) => {
  console.log("Status update:", data);
});
```

## Creating Python Backends

### Basic Backend

```python
# my_backend.py
from bridge_runtime import PythonBridge

class MyBackend(PythonBridge):
    def __init__(self):
        super().__init__()
        self.counter = 0
    
    def increment(self):
        """Increment the counter."""
        self.counter += 1
        return {"count": self.counter}
    
    def get_count(self):
        """Get current count."""
        return {"count": self.counter}
    
    def greet(self, name: str):
        """Greet someone."""
        return {"greeting": f"Hello, {name}!"}

if __name__ == "__main__":
    backend = MyBackend()
    backend.run()
```

### Backend with Async Events

```python
# streaming_backend.py
from bridge_runtime import PythonBridge
import time

class StreamingBackend(PythonBridge):
    def start_streaming(self, interval: float = 1.0):
        """Start streaming data."""
        import threading
        
        def stream():
            counter = 0
            while self._running:
                counter += 1
                self.send_event("data", {
                    "count": counter,
                    "timestamp": time.time()
                })
                time.sleep(interval)
        
        thread = threading.Thread(target=stream, daemon=True)
        thread.start()
        return {"status": "streaming_started"}
    
    def stop_streaming(self):
        """Stop streaming."""
        self._running = False
        return {"status": "streaming_stopped"}

if __name__ == "__main__":
    backend = StreamingBackend()
    backend.run()
```

### Backend with External Libraries

```python
# ml_backend.py
from bridge_runtime import PythonBridge

class MLBackend(PythonBridge):
    def __init__(self):
        super().__init__()
        self.model = None
    
    def load_model(self, path: str):
        """Load a machine learning model."""
        import joblib
        self.model = joblib.load(path)
        return {"status": "loaded", "path": path}
    
    def predict(self, features: list):
        """Make a prediction."""
        if not self.model:
            raise RuntimeError("Model not loaded. Call load_model() first.")
        
        import numpy as np
        features_array = np.array(features).reshape(1, -1)
        prediction = self.model.predict(features_array)
        
        return {
            "prediction": prediction[0],
            "confidence": float(self.model.predict_proba(features_array).max())
        }

if __name__ == "__main__":
    backend = MLBackend()
    backend.run()
```

## API Reference

### `api.python.execute(code, options?)`

Execute Python code inline (one-off execution).

**Parameters:**
- `code` (string): Python code to execute (should return a value)
- `options` (object, optional):
  - `timeout` (number): Timeout in milliseconds (default: 30000)
  - `pythonPath` (string): Path to Python executable (default: "python3")

**Returns:** Promise resolving to the Python execution result

**Example:**
```typescript
const result = await api.python?.execute(`
import datetime
return {"now": datetime.datetime.now().isoformat()}
`);
```

### `api.python.spawn(script, options?)`

Spawn a persistent Python backend process.

**Parameters:**
- `script` (string): Path to Python script
- `options` (object, optional):
  - `env` (object): Environment variables for the Python process
  - `timeout` (number): Default timeout for calls (default: 30000)

**Returns:** Promise resolving to a `PythonBackendHandle`

**Example:**
```typescript
const backend = await api.python?.spawn("plugins/my_backend.py");
```

### `backend.call(cmd, params?, timeout?)`

Call a method on a spawned backend.

**Parameters:**
- `cmd` (string): Method name to call
- `params` (object, optional): Parameters to pass to the method
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)

**Returns:** Promise resolving to the method result

**Example:**
```typescript
const result = await backend?.call("greet", { name: "Alice" });
```

### `backend.on(event, handler)`

Register an event handler for async notifications from Python.

**Parameters:**
- `event` (string): Event type name
- `handler` (function): Handler function `(data) => void`

**Example:**
```typescript
backend?.on("data", (data) => {
  console.log("Received:", data);
});
```

### `backend.terminate()`

Terminate the Python backend process.

**Returns:** Promise that resolves when the backend is terminated

**Example:**
```typescript
await backend?.terminate();
```

### `api.python.hasPython()`

Check if Python 3 is available.

**Returns:** Promise resolving to boolean

### `api.python.getPythonVersion()`

Get the Python version string.

**Returns:** Promise resolving to version string (e.g., "Python 3.11.5")

## Message Framing Protocol

The Python Bridge uses **JSON-over-stdin/stdout with null-byte framing**:

**Bun → Python:**
```
{"id": 1, "cmd": "greet", "params": {"name": "Alice"}}\n
```

**Python → Bun:**
```
{"id": 1, "status": "success", "result": {"greeting": "Hello, Alice!"}}\0
```

The null byte (`\0`) delimiter ensures reliable message boundaries since it must be escaped in valid JSON.

## Error Handling

Python exceptions are caught and returned with full stack traces:

```typescript
try {
  await backend?.call("divide", { a: 10, b: 0 });
} catch (error) {
  console.error("Python error:", error.message);
  console.error("Traceback:", error.stack);
}
```

## Best Practices

### 1. Reuse Backend Instances

Don't spawn a new backend for every call. Spawn once and reuse:

```typescript
// ❌ Bad
for (let i = 0; i < 10; i++) {
  const backend = await api.python?.spawn("my_backend.py");
  await backend?.call("process", { i });
  await backend?.terminate();
}

// ✅ Good
const backend = await api.python?.spawn("my_backend.py");
for (let i = 0; i < 10; i++) {
  await backend?.call("process", { i });
}
await backend?.terminate();
```

### 2. Handle Cleanup

Always terminate backends when done:

```typescript
const backend = await api.python?.spawn("my_backend.py");

try {
  // Use backend
  await backend?.call("process");
} finally {
  // Always cleanup
  await backend?.terminate();
}
```

### 3. Use Timeouts

Set appropriate timeouts for long-running operations:

```typescript
// Short timeout for quick operations
const result = await backend?.call("quick_calc", {}, 5000);

// Long timeout for ML inference
const prediction = await backend?.call("predict", { features }, 60000);
```

### 4. Validate Inputs

Validate inputs in Python before processing:

```python
def process_data(self, data: list):
    if not isinstance(data, list):
        raise ValueError("data must be a list")
    if len(data) == 0:
        raise ValueError("data cannot be empty")
    
    # Process...
```

### 5. Use Logging

Log to stderr for debugging (stdout is reserved for IPC):

```python
def heavy_operation(self):
    print("[backend] Starting heavy operation...", file=sys.stderr)
    # Operation...
    print("[backend] Complete", file=sys.stderr)
```

## Troubleshooting

### "python3 not found"

Install Python 3.8+ and ensure it's in your PATH:

```bash
# macOS
brew install python@3.11

# Ubuntu/Debian
sudo apt install python3 python3-pip

# Verify
python3 --version
```

### "Module not found"

Install required Python packages:

```bash
pip install reticulum lxmf numpy joblib
```

### Backend exits immediately

Check stderr for errors:

```typescript
const backend = await api.python?.spawn("my_backend.py");
// Watch stderr in terminal
```

### Messages not received

Ensure your Python backend calls `super().__init__()` and `backend.run()`:

```python
class MyBackend(PythonBridge):
    def __init__(self):
        super().__init__()  # Required!
        # Your init...

if __name__ == "__main__":
    backend = MyBackend()
    backend.run()  # Required!
```

## Next Steps

- [Reticulum Integration](./RETICULUM.md) - Mesh networking with Reticulum
- [Creating Custom Backends](#creating-python-backends) - Build your own Python backends
- [Example Backends](./plugins/python/examples/) - See example implementations

## License

Part of the Ronin project.
