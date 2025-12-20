# GitHub Setup Guide

## Quick Setup Steps

### 1. Stage and Commit Files

```bash
cd ronin

# Stage all files
git add .

# Make initial commit
git commit -m "Initial commit: Ronin AI Agent Library

- Bun-based AI agent scheduling system
- Plugin system with auto-discovery
- Remote AI support (Grok, Gemini)
- CLI with ask command and tool calling
- Memory system with SQLite
- Function calling support"
```

### 2. Add GitHub Remote

```bash
# Add your roninito repository as remote
git remote add origin https://github.com/roninito/roninito.git

# Or if using SSH:
git remote add origin git@github.com:roninito/roninito.git

# Verify remote
git remote -v
```

### 3. Push to GitHub

```bash
# Push to main branch (or master if that's your default)
git branch -M main  # Rename master to main if needed
git push -u origin main

# Or if keeping master:
git push -u origin master
```

## Important Notes

### Before Pushing

✅ **Already in .gitignore:**
- `ronin.db` - Database file
- `.env` files - Environment variables
- `node_modules/` - Dependencies
- `.cursor/` - IDE files

⚠️ **Make sure you haven't committed:**
- API keys in code
- `.env` files with secrets
- Personal configuration files

### Repository Structure

The project will be pushed with this structure:
```
ronin/
├── agents/          # Agent files
├── plugins/         # Plugin files (git, shell, grok, gemini, hyprland)
├── src/            # Source code
├── docs/           # Documentation
├── tests/          # Tests (empty for now)
├── README.md       # Main documentation
├── package.json    # Project config
└── tsconfig.json   # TypeScript config
```

### After Pushing

1. **Add a README** (if the repo doesn't have one)
2. **Add LICENSE** (if needed)
3. **Set up GitHub Actions** (optional, for CI/CD)
4. **Add topics/tags** on GitHub for discoverability

## Troubleshooting

### If remote already exists:
```bash
git remote remove origin
git remote add origin <your-repo-url>
```

### If you need to force push (be careful!):
```bash
git push -u origin main --force
```

### To check what will be pushed:
```bash
git ls-files  # Shows all tracked files
```

