"""
Python Bridge Runtime

Standard runtime for Python backends communicating with Bun via IPC.
Uses JSON-over-stdin/stdout with null-byte framing for reliable message boundaries.

Usage:
    class MyBackend(PythonBridge):
        def create_identity(self):
            # Your implementation
            return {"hash": "abc123"}
    
    if __name__ == "__main__":
        backend = MyBackend()
        backend.run()
"""

import sys
import json
import traceback
from typing import Any, Dict, Optional


class PythonBridge:
    """
    Base class for Python backends that communicate with Bun via IPC.
    
    Subclass this and implement your backend methods. The run() method
    handles the IPC loop automatically.
    """
    
    def __init__(self):
        """Initialize the Python bridge backend."""
        self.state: Dict[str, Any] = {}
        self._running = False
    
    def ready(self) -> Dict[str, Any]:
        """
        Health check method called by Bun to verify backend is ready.
        
        Override this if you need custom initialization checks.
        """
        return {"status": "ready", "python_version": sys.version}
    
    def shutdown(self) -> Dict[str, Any]:
        """
        Graceful shutdown handler.
        
        Override this to cleanup resources before the backend exits.
        """
        self._running = False
        return {"status": "shutdown"}
    
    def handle_command(self, cmd_json: str) -> Optional[str]:
        """
        Handle an incoming command from Bun.
        
        Args:
            cmd_json: JSON string containing cmd, id, and params
            
        Returns:
            JSON response string (or None to suppress response)
        """
        try:
            cmd = json.loads(cmd_json)
            cmd_name = cmd.get("cmd", "")
            params = cmd.get("params", {})
            request_id = cmd.get("id", 0)
            
            # Get the method to call
            method = getattr(self, cmd_name, None)
            
            if method is None:
                response = {
                    "id": request_id,
                    "status": "error",
                    "error": f"Unknown command: {cmd_name}",
                }
            elif not callable(method):
                response = {
                    "id": request_id,
                    "status": "error",
                    "error": f"Command is not callable: {cmd_name}",
                }
            else:
                try:
                    # Call the method
                    result = method(**params) if params else method()
                    
                    # Handle async results
                    if hasattr(result, "__await__"):
                        import asyncio
                        result = asyncio.get_event_loop().run_until_complete(result)
                    
                    response = {
                        "id": request_id,
                        "status": "success",
                        "result": result,
                    }
                except Exception as e:
                    response = {
                        "id": request_id,
                        "status": "error",
                        "error": str(e),
                        "traceback": traceback.format_exc(),
                    }
            
            return json.dumps(response)
            
        except json.JSONDecodeError as e:
            return json.dumps({
                "id": 0,
                "status": "error",
                "error": f"Invalid JSON: {e}",
            })
        except Exception as e:
            return json.dumps({
                "id": 0,
                "status": "error",
                "error": f"Handler error: {e}",
                "traceback": traceback.format_exc(),
            })
    
    def send_response(self, response_json: str) -> None:
        """
        Send a response back to Bun.
        
        Args:
            response_json: JSON response string
        """
        # Write with null byte delimiter
        sys.stdout.buffer.write(response_json.encode() + b"\0")
        sys.stdout.buffer.flush()
    
    def send_event(self, event_type: str, data: Any) -> None:
        """
        Send an async event notification to Bun.
        
        Args:
            event_type: Type of event (e.g., "message", "status_update")
            data: Event payload data
        """
        response = {
            "cmd": event_type,
            "status": "event",
            "result": data,
        }
        self.send_response(json.dumps(response))
    
    def run(self) -> None:
        """
        Start the IPC loop. This blocks until stdin is closed.
        
        Override this only if you need custom event loop behavior.
        """
        self._running = True
        
        # Send ready notification
        ready_response = self.handle_command(json.dumps({"cmd": "ready", "id": 0}))
        if ready_response:
            self.send_response(ready_response)
        
        # Main IPC loop
        for line in sys.stdin:
            if not self._running:
                break
            
            line = line.strip()
            if not line:
                continue
            
            response = self.handle_command(line)
            if response:
                self.send_response(response)


# Example backend implementation
class ExampleBackend(PythonBridge):
    """
    Example Python backend demonstrating the bridge pattern.
    """
    
    def __init__(self):
        super().__init__()
        self.counter = 0
        self.messages = []
    
    def increment(self) -> Dict[str, int]:
        """Increment and return the counter."""
        self.counter += 1
        return {"count": self.counter}
    
    def get_count(self) -> Dict[str, int]:
        """Get the current counter value."""
        return {"count": self.counter}
    
    def add_message(self, message: str) -> Dict[str, Any]:
        """Add a message to the list."""
        self.messages.append(message)
        return {"count": len(self.messages)}
    
    def get_messages(self) -> Dict[str, list]:
        """Get all messages."""
        return {"messages": self.messages}
    
    def echo(self, data: Any) -> Dict[str, Any]:
        """Echo back the input data."""
        return {"echo": data}
    
    def calculate(self, expression: str) -> Dict[str, Any]:
        """
        Evaluate a mathematical expression (unsafe - for demo only).
        
        WARNING: This uses eval() which is dangerous. Don't use in production!
        """
        try:
            result = eval(expression)
            return {"result": result}
        except Exception as e:
            raise ValueError(f"Calculation error: {e}")


if __name__ == "__main__":
    # Run the example backend
    # In production, replace with your own backend class
    backend = ExampleBackend()
    print("Starting ExampleBackend...", file=sys.stderr)
    backend.run()
