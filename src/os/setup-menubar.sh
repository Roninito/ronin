#!/bin/bash
# Simple menubar launcher using native macOS tools

readonly RONIN_HOME="$HOME/.ronin"
readonly TRAY_PLIST="$HOME/Library/LaunchAgents/com.roninito.ronintray.plist"

# Create LaunchAgent plist
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$TRAY_PLIST" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.roninito.ronintray</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>http://localhost:17341/dashboard</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
EOF

# Make it executable
chmod 644 "$TRAY_PLIST"

echo "✅ Menubar launcher configured"
