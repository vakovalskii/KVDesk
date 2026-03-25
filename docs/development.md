# Development Guide

## Prerequisites

| Component | Version |
|-----------|---------|
| Rust | 1.74+ |
| Node.js | 20+ |
| Python | 3.x (for `execute_python` tool) |

## Commands

```bash
# Full development (Tauri + Vite + Sidecar)
make dev

# Individual components
make dev-ui          # Vite dev server only
make dev-sidecar     # Transpile sidecar only
make dev-tauri       # Tauri dev only

# Build for production
make bundle          # Full production build

# Checks
npm run type-check   # TypeScript validation
npm run lint         # ESLint
npm run test         # Vitest tests
```

## Code Style

- **Files**: `kebab-case.ts`
- **Tools**: `snake_case` with `verb_noun` pattern (`read_file`, `search_web`)
- **Components**: `PascalCase.tsx`
- **Classes**: `PascalCase`
- **Functions/variables**: `camelCase`
- TypeScript strict mode
- Prefer `interface` for objects, `type` for unions
- Use `async/await`, avoid callbacks
- No `any` without justification

## Git Conventions

### Commit Format
```
type: description
```

Types: `feat`, `fix`, `refactor`, `chore`, `security`, `perf`

### Branch Naming
- `feature/*` — new features
- `fix/*` — bug fixes
- `hotfix/*` — urgent fixes

## Environment Variables

Set in `.env`:
- `TAVILY_API_KEY` — Tavily web search
- `ZAI_API_KEY` — Z.AI reader
- `VLLM_URL` — default vLLM endpoint

## Performance Guidelines

- Use `requestAnimationFrame` for streaming UI updates
- Avoid blocking operations in the main thread
- Minimize logging in hot paths
- Stream events are not persisted to state (only final results)

## Build Targets

```bash
# macOS
npm run dist:mac-arm64   # ARM64 .dmg
npm run dist:mac-x64     # Intel .dmg

# Windows
npm run dist:win         # .exe / .msi

# Linux
npm run dist:linux       # AppImage
```
