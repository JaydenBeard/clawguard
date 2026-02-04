# Contributing to ClawGuard

Thanks for wanting to contribute! Here's how to get started.

## Dev Setup

```bash
git clone https://github.com/JaydenBeard/clawguard.git
cd clawguard
npm install
npm start
# Dashboard at http://localhost:3847
```

ClawGuard reads session logs from your local OpenClaw installation (`~/.openclaw/agents/main/sessions/`). If you don't have OpenClaw installed, the dashboard will show an empty state.

## Project Structure

```
clawguard/
├── bin/clawguard.js           # CLI entry point
├── src/
│   ├── server.js              # Express + WebSocket server
│   └── lib/
│       ├── parser.js          # JSONL session log parser
│       ├── risk-analyzer.js   # Risk detection engine
│       └── config.js          # Configuration loader
├── public/
│   ├── index.html             # Dashboard UI
│   └── app.js                 # Frontend logic
├── tests/                     # Test files
└── config.default.json        # Default configuration
```

## Making Changes

1. **Fork** the repo and create a branch from `main`
2. **Name your branch** descriptively: `fix/issue-description` or `feat/feature-name`
3. **Test your changes** — make sure `node --check` passes on all modified `.js` files
4. **Commit** with clear messages: `fix: description` or `feat: description`
5. **Push** and open a PR against `main`

## Coding Style

- ES Modules (`import`/`export`)
- Single quotes for strings
- 2-space indentation
- Descriptive variable names
- JSDoc comments for functions

## What We're Looking For

Check the [open issues](https://github.com/JaydenBeard/clawguard/issues) for things to work on. Issues labelled `good first issue` are great starting points.

## Pull Request Process

1. Describe what your PR does and link any related issues
2. CodeRabbit will automatically review your PR
3. A maintainer will review and may request changes
4. Once approved, we'll merge it in

## Reporting Bugs

Use the [bug report template](https://github.com/JaydenBeard/clawguard/issues/new?template=bug_report.md) and include:
- ClawGuard version (`clawguard version`)
- OS and Node.js version
- Steps to reproduce
- Expected vs actual behaviour

## Feature Requests

Use the [feature request template](https://github.com/JaydenBeard/clawguard/issues/new?template=feature_request.md) and describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
