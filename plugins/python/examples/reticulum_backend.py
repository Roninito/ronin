"""
Example Python Backend for Reticulum

This demonstrates how to create a Python backend that can be used
with the Python Bridge plugin.
"""

import sys
import json
import time

# Import the bridge runtime
from bridge_runtime import PythonBridge


class ReticulumBackend(PythonBridge):
    """
    Reticulum mesh network backend.
    
    This is a stub implementation showing the structure.
    The actual Reticulum integration will be in the full implementation.
    """
    
    def __init__(self):
        super().__init__()
        self.identity = None
        self.destination = None
        self.network = None
        self.lxmf_router = None
        
        # Try to import Reticulum
        try:
            import RNS
            import LXMF
            
            self.RNS = RNS
            self.LXMF = LXMF
            self.available = True
        except ImportError:
            self.available = False
            print(
                "Warning: Reticulum not installed. Install with: pip install reticulum lxmf",
                file=sys.stderr
            )
    
    def init(self, config_path: str = None, **options) -> dict:
        """
        Initialize Reticulum network.
        
        Args:
            config_path: Path to Reticulum config directory
            **options: Additional initialization options
                - enable_auto_interface: Enable local network auto-discovery
                - group_id: Network group ID for local mesh
                - shared_key: Shared secret for private network
        """
        if not self.available:
            raise RuntimeError(
                "Reticulum not installed. Install with: pip install reticulum lxmf"
            )
        
        # Initialize network
        self.network = self.RNS.Reticulum(
            configdir=config_path,
            loglevel=self.RNS.LOG_INFO
        )
        
        # Enable AutoInterface for local network discovery
        if options.get("enable_auto_interface", True):
            group_id = options.get("group_id", "ronin-mesh")
            
            # Add AutoInterface
            auto_interface = self.RNS.AutoInterface(
                group_id=group_id,
                discovery_scope="link"
            )
            self.network.add_interface(auto_interface)
            
            print(f"[reticulum] AutoInterface enabled with group_id: {group_id}", file=sys.stderr)
        
        # Create identity
        self.identity = self.RNS.Identity(create_keys=True)
        
        # Initialize LXMF router for messaging
        self.lxmf_router = self.LXMF.LXMRouter(
            identity=self.identity,
            storage_path="/tmp/lxmf_storage"
        )
        
        return {
            "status": "initialized",
            "identity_hash": self.identity.hash.hex(),
            "network": str(self.network),
        }
    
    def create_identity(self) -> dict:
        """Create a new Reticulum identity."""
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        
        self.identity = self.RNS.Identity(create_keys=True)
        return {
            "hash": self.identity.hash.hex(),
            "created_at": time.time(),
        }
    
    def load_identity(self, path: str) -> dict:
        """Load an existing identity from file."""
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        
        self.identity = self.RNS.Identity.from_file(path)
        return {
            "hash": self.identity.hash.hex(),
            "loaded_from": path,
        }
    
    def get_identity(self) -> dict:
        """Get the current identity."""
        if not self.identity:
            return {"hash": None}
        
        return {
            "hash": self.identity.hash.hex(),
        }
    
    def create_destination(self, aspects: list, app_name: str = "ronin") -> dict:
        """
        Create a Reticulum destination.
        
        Args:
            aspects: List of aspect strings
            app_name: Application name
        """
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        if not self.identity:
            raise RuntimeError("Identity not initialized. Call init() first.")
        
        self.destination = self.RNS.Destination(
            self.identity,
            self.RNS.Destination.IN,
            self.RNS.Destination.SINGLE,
            app_name,
            *aspects
        )
        
        # Announce the destination
        self.destination.announce()
        
        return {
            "hash": self.destination.hash.hex(),
            "app_name": app_name,
            "aspects": aspects,
        }
    
    def announce(self, app_data: str = None) -> dict:
        """
        Announce the destination on the network.
        
        Args:
            app_data: Optional application data to include in announcement
        """
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        if not self.destination:
            raise RuntimeError("Destination not created. Call create_destination() first.")
        
        self.destination.announce(
            app_data=app_data.encode() if app_data else None
        )
        
        return {"status": "announced"}
    
    def send_packet(self, destination: str, data: str) -> dict:
        """
        Send a raw packet to a destination.
        
        Args:
            destination: Destination hash (hex string)
            data: Data to send (hex string)
        """
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        
        dest_hash = bytes.fromhex(destination)
        data_bytes = bytes.fromhex(data)
        
        dest = self.RNS.Destination(dest_hash)
        packet = self.RNS.Packet(dest, data_bytes)
        receipt = packet.send()
        
        return {
            "status": receipt.status,
            "packet_hash": packet.packet_hash.hex(),
        }
    
    def send_lxmf_message(
        self,
        destination: str,
        content: str,
        title: str = None,
        fields: dict = None
    ) -> dict:
        """
        Send an LXMF message.
        
        Args:
            destination: Destination hash (hex string)
            content: Message content
            title: Optional message title
            fields: Optional additional fields
        """
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        if not self.lxmf_router:
            raise RuntimeError("LXMF router not initialized. Call init() first.")
        
        dest_hash = bytes.fromhex(destination)
        dest = self.RNS.Destination(dest_hash)
        
        message = self.LXMF.LXMessage(
            dest,
            self.identity,
            content,
            title=title,
            fields=fields
        )
        
        self.lxmf_router.handle_outbound(message)
        
        return {
            "hash": message.hash.hex(),
            "status": "queued",
        }
    
    def receive_lxmf_message(self, timeout: int = 5000) -> dict:
        """
        Receive an LXMF message.
        
        Args:
            timeout: Timeout in milliseconds
        """
        if not self.available:
            raise RuntimeError("Reticulum not installed")
        if not self.lxmf_router:
            raise RuntimeError("LXMF router not initialized")
        
        # Poll for messages
        messages = self.lxmf_router.get_messages()
        
        if messages:
            msg = messages[0]
            return {
                "hash": msg.hash.hex(),
                "content": msg.content,
                "title": msg.title,
                "fields": msg.fields,
                "timestamp": msg.timestamp,
                "source": msg.source_hash.hex() if msg.source_hash else None,
            }
        
        return None
    
    def get_status(self) -> dict:
        """Get current Reticulum status."""
        if not self.available:
            return {
                "available": False,
                "error": "Reticulum not installed",
            }
        
        return {
            "available": True,
            "identity": self.identity.hash.hex() if self.identity else None,
            "destination": self.destination.hash.hex() if self.destination else None,
            "network": str(self.network) if self.network else None,
        }
    
    def get_peers(self) -> list:
        """Get list of discovered peers."""
        if not self.available:
            return []
        
        # Get peers from network
        # This is a stub - actual implementation depends on Reticulum version
        return []
    
    def shutdown(self) -> dict:
        """Shutdown Reticulum gracefully."""
        self._running = False
        
        if self.network:
            self.network.teardown()
        
        return {"status": "shutdown"}


if __name__ == "__main__":
    print("[reticulum] Starting ReticulumBackend...", file=sys.stderr)
    backend = ReticulumBackend()
    backend.run()
