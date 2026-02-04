# Changelog

All notable changes to ClawGuard will be documented in this file.

## [0.3.1] - 2026-02-04

### Fixed
- Gateway status always showing "Stopped" after the clawdbot → openclaw rebrand
- Telegram webhook alerts not firing (`sendAlert()` was never called)
- Telegram payload missing required `chat_id` field
- Alert risk filtering now uses configurable `onRiskLevels` array instead of boolean
- Kill switch `results.verified` now included in response (was firing after response was sent)

### Added
- Multi-gateway support: detects `openclaw`, `moltbot`, and `clawdbot` processes and CLIs
- `telegramChatId` config field for Telegram webhook alerts
- Top-level session path detection (`~/.openclaw/sessions` etc.)
- Legacy `alertOnHighRisk` boolean auto-converts to `onRiskLevels` array

### Changed
- Export filenames renamed from `clawdbot-activity` to `clawguard-activity`
- Process detection uses `ps + grep` instead of `pgrep` for macOS reliability

### Contributors
- @UC-VR — PRs #1, #2

## [0.3.0] - 2026-02-03

### Added
- Initial public release
- Real-time activity monitoring dashboard
- Risk analysis engine with categorisation
- Kill switch for emergency gateway termination
- Webhook alerts (generic + Telegram)
- Session browser and tool call inspector
- CSV/JSON activity exports
- Configurable risk levels and alert thresholds
