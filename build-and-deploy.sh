#!/bin/bash
# RoninTray Build & Deploy Script
# Automates: build → deploy → commit → push

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR"
DEPLOY_DIR="$HOME/Desktop/Bun Apps/ronin"
BINARY_NAME="RoninTray"

echo "🔨 Building RoninTray..."
cd "$SOURCE_DIR"
swift build -c release

if [ ! -f ".build/release/$BINARY_NAME" ]; then
    echo "❌ Build failed: Binary not found at .build/release/$BINARY_NAME"
    exit 1
fi

echo "📦 Deploying binary..."
DEPLOY_BINARY="$DEPLOY_DIR/RoninTray.app/Contents/MacOS/$BINARY_NAME"
cp ".build/release/$BINARY_NAME" "$DEPLOY_BINARY"
chmod +x "$DEPLOY_BINARY"

echo "📝 Committing changes..."
cd "$DEPLOY_DIR"
git add RoninTray.app
git commit -m "Update RoninTray

- Rebuilt native Swift binary
- All menu updates and features included

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" || echo "⚠️  No changes to commit"

echo "🚀 Pushing to GitHub..."
git push

echo "✅ RoninTray updated successfully!"
echo "💡 Tip: Users can reinstall with: bun run ronin os install mac"
