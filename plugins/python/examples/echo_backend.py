"""
Echo Backend Example

Simple example demonstrating the Python Bridge pattern.
"""

from bridge_runtime import PythonBridge


class EchoBackend(PythonBridge):
    """
    Simple echo backend for testing the Python Bridge.
    """
    
    def __init__(self):
        super().__init__()
        self.counter = 0
        self.messages = []
    
    def echo(self, data):
        """Echo back the input data."""
        return {"echo": data, "timestamp": self._time()}
    
    def increment(self):
        """Increment and return the counter."""
        self.counter += 1
        return {"count": self.counter}
    
    def get_count(self):
        """Get the current counter value."""
        return {"count": self.counter}
    
    def add_message(self, message: str):
        """Add a message to the list."""
        self.messages.append(message)
        return {"count": len(self.messages)}
    
    def get_messages(self):
        """Get all messages."""
        return {"messages": self.messages}
    
    def calculate(self, operation: str, a: float, b: float):
        """
        Perform a mathematical operation.
        
        Args:
            operation: One of "add", "subtract", "multiply", "divide"
            a: First operand
            b: Second operand
        """
        if operation == "add":
            result = a + b
        elif operation == "subtract":
            result = a - b
        elif operation == "multiply":
            result = a * b
        elif operation == "divide":
            if b == 0:
                raise ValueError("Division by zero")
            result = a / b
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        return {
            "operation": operation,
            "a": a,
            "b": b,
            "result": result,
        }
    
    def ping(self):
        """Health check."""
        return {"pong": True, "timestamp": self._time()}
    
    def _time(self):
        """Get current timestamp."""
        import time
        return time.time()


if __name__ == "__main__":
    print("[echo] Starting EchoBackend...", file=__import__("sys").stderr)
    backend = EchoBackend()
    backend.run()
