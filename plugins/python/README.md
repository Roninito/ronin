# Python Bridge for Ronin

This directory contains the Python backend infrastructure for Ronin's Python Bridge plugin.

## Structure

```
python/
├── __init__.py              # Python package exports
├── bridge_runtime.py        # Base class for Python backends
└── examples/
    ├── echo_backend.py      # Simple echo example
    └── reticulum_backend.py # Reticulum integration
```

## Quick Start

### 1. Install Python Dependencies

```bash
pip install reticulum lxmf
```

### 2. Create a Python Backend

```python
# my_backend.py
from bridge_runtime import PythonBridge

class MyBackend(PythonBridge):
    def greet(self, name: str):
        return {"greeting": f"Hello, {name}!"}

if __name__ == "__main__":
    backend = MyBackend()
    backend.run()
```

### 3. Use from Ronin

```typescript
const backend = await api.python?.spawn("my_backend.py");
const result = await backend?.call("greet", { name: "Alice" });
console.log(result); // { greeting: "Hello, Alice!" }
```

## bridge_runtime.py

The `PythonBridge` base class handles all IPC communication with Bun. Subclass it and implement your backend methods.

### Features

- Automatic JSON serialization
- Null-byte message framing
- Error handling with stack traces
- Async event notifications
- Graceful shutdown

### Usage

```python
from bridge_runtime import PythonBridge

class MyBackend(PythonBridge):
    def __init__(self):
        super().__init__()
        # Your initialization
    
    def my_method(self, param1, param2="default"):
        # Your implementation
        return {"result": "success"}
    
    def shutdown(self):
        # Cleanup before exit
        self._running = False
        return {"status": "shutdown"}

if __name__ == "__main__":
    backend = MyBackend()
    backend.run()
```

### Methods

All public methods (not starting with `_`) are automatically callable from Bun.

### Event Notifications

Send async events to Bun:

```python
def start_streaming(self):
    import threading
    
    def stream():
        while self._running:
            data = {"value": get_next_value()}
            self.send_event("data", data)
    
    thread = threading.Thread(target=stream, daemon=True)
    thread.start()
    return {"status": "streaming"}
```

### Logging

Use `stderr` for logging (stdout is reserved for IPC):

```python
import sys

def heavy_operation(self):
    print("[backend] Starting...", file=sys.stderr)
    # Operation...
    print("[backend] Complete", file=sys.stderr)
```

## Examples

### Echo Backend

Simple echo backend for testing:

```python
class EchoBackend(PythonBridge):
    def echo(self, data):
        return {"echo": data}
    
    def ping(self):
        return {"pong": True}
```

### Reticulum Backend

Full-featured Reticulum integration:

```python
class ReticulumBackend(PythonBridge):
    def __init__(self):
        super().__init__()
        import RNS
        import LXMF
        self.RNS = RNS
        self.LXMF = LXMF
    
    def init(self, **options):
        self.network = self.RNS.Reticulum()
        self.identity = self.RNS.Identity(create_keys=True)
        return {"status": "initialized"}
    
    def send_message(self, destination, content):
        # Send LXMF message
        pass
```

## Message Protocol

### Bun → Python

```json
{"id": 1, "cmd": "greet", "params": {"name": "Alice"}}\n
```

### Python → Bun

```json
{"id": 1, "status": "success", "result": {"greeting": "Hello, Alice!"}}\0
```

## Best Practices

1. **Always call `super().__init__()`**
2. **Always call `backend.run()`** in `__main__`
3. **Use stderr for logging**, not stdout
4. **Handle exceptions** gracefully
5. **Implement `shutdown()`** for cleanup
6. **Validate inputs** before processing

## Testing

Test your backend independently:

```bash
python my_backend.py
# Then type commands in JSON format:
{"id": 1, "cmd": "greet", "params": {"name": "Test"}}
```

## Troubleshooting

### Backend exits immediately

Check stderr for errors:

```bash
python my_backend.py 2>&1 | less
```

### Messages not received

Ensure you're calling `backend.run()` and not blocking the main thread.

### Import errors

Install required packages:

```bash
pip install -r requirements.txt
```

## License

Part of the Ronin project.
