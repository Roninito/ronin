#!/bin/bash
# Script to push Ronin to GitHub

echo "🚀 Pushing Ronin to GitHub"
echo "=========================="
echo ""

# Check if repository exists
echo "Step 1: Make sure the repository exists on GitHub"
echo "   Visit: https://github.com/new"
echo "   Repository name: ronin"
echo "   Don't initialize with README"
echo ""
read -p "Press Enter when the repository is created..."

# Add remote
echo ""
echo "Step 2: Adding remote..."
git remote add origin https://github.com/roninito/ronin.git 2>/dev/null || {
  echo "Remote already exists or error occurred"
  git remote set-url origin https://github.com/roninito/ronin.git
}

# Verify remote
echo ""
echo "Step 3: Verifying remote..."
git remote -v

# Check branch
echo ""
echo "Step 4: Checking branch..."
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

# Push
echo ""
echo "Step 5: Pushing to GitHub..."
echo "You may be prompted for credentials."
echo "Username: your GitHub username"
echo "Password: Use a Personal Access Token (get from https://github.com/settings/tokens)"
echo ""

git push -u origin $CURRENT_BRANCH

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully pushed to GitHub!"
  echo "   View at: https://github.com/roninito/ronin"
else
  echo ""
  echo "❌ Push failed. Common issues:"
  echo "   1. Repository doesn't exist - create it at https://github.com/new"
  echo "   2. Authentication failed - use Personal Access Token"
  echo "   3. Wrong repository name - check the URL"
  echo ""
  echo "See GITHUB_TROUBLESHOOT.md for detailed help"
fi

