# Changelog

All notable changes to Ronin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-18

### Added
- **Semantic Agent Runtime workspace**: Introduced the `@ronin/sar` workspace package and wired Ronin to consume the shared chain, executor, middleware, and template runtime through the new package boundary.
- **Telegram and auth integrations**: Added the new `telegram-watcher` agent and an OAuth plugin to expand external integration support.
- **Ops and admin tooling**: Added cleanup administration flows, execution tracking, and richer analytics hooks for runtime visibility.

### Changed
- **Agent registry and runtime internals**: Refactored agent loading and SAR-related runtime paths to use the extracted shared package and cleaner API boundaries.
- **Config and desktop UX**: Expanded the config editor, shell-safe management, desktop tray behavior, and provider/model management flows.
- **Agent behavior**: Improved portfolio, messenger, schedule, tasking, analytics, and Telegram subscription agents to support the new runtime and management features.

### Documentation
- Updated CLI and plugin documentation to cover the new runtime package, management flows, and related platform capabilities.

## [1.1.1] - 2026-02-19

### Changed
- **Ask command refactoring**: The `ask` command now requires Ronin to be running (`ronin start`) and connects via HTTP webhook for unified chat experience with conversation history
- **Ask command model selection**: Updated to support model tiers (`smart`, `cloud`, `local`) in addition to specific model names
- **API provider improvements**: Enhanced error handling and support for remote Ollama instances with API key authentication
- **Tool system**: Improved plugin tool registration and routing for better tool discovery

### Added
- **Skills command**: Comprehensive CLI for managing AgentSkills with subcommands:
  - `ronin skills list` - List all skills
  - `ronin skills discover <query>` - Discover skills by query
  - `ronin skills explore <name>` - Explore skill details
  - `ronin skills use <name>` - Execute skills with abilities or pipelines
  - `ronin skills install <repo>` - Install skills from git repositories
  - `ronin skills update <name>` - Update installed skills
  - `ronin skills init` - Initialize git repository for skills directory
- **Create skill command**: `ronin create skill "<description>"` - AI-powered skill creation using SkillMaker agent
- **Enhanced API**: Better plugin-to-tool registration with automatic discovery

### Documentation
- Updated README.md with new ask command behavior and skills examples
- Updated CLI.md with comprehensive skills command documentation
- Added model tier documentation for ask command

## [0.4.0] - Previous Release

Initial stable release with core features:
- Agent scheduling and execution
- Plugin system
- Memory management
- Desktop Mode (macOS)
- MCP server support
- Hybrid Intelligence system
