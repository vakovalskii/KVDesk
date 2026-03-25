# Architecture

## Overview

ValeDesk uses a **three-layer architecture**: Tauri (Rust) + Node.js Sidecar + React UI.

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri App (Rust)                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │  main.rs    │───>│  SQLite DB   │    │   Scheduler   │   │
│  │  (IPC hub)  │    │  sessions.db │    │   Service     │   │
│  └─────────────┘    └──────────────┘    └───────────────┘   │
│         │                                       │           │
│         │ JSON Events                          │ stdin/out  │
│         v                                       v           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Node.js Sidecar (pkg binary)           │    │
│  │  ┌──────────────┐  ┌───────────┐  ┌─────────────┐   │    │
│  │  │ LLM Runner   │  │  Tools    │  │  Session    │   │    │
│  │  │ (OpenAI SDK) │  │ Executor  │  │  Store      │   │    │
│  │  └──────────────┘  └───────────┘  └─────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ^
                            │ WebView
                            v
┌─────────────────────────────────────────────────────────────┐
│                    React UI (Vite)                          │
│  ┌───────────────┐  ┌────────────┐  ┌──────────────┐        │
│  │  useAppStore  │  │ Components │  │  Tauri IPC   │        │
│  │  (Zustand)    │  │            │  │  Bridge      │        │
│  └───────────────┘  └────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1: Tauri (Rust)

**Path:** `src-tauri/src/`

| Module | Purpose |
|--------|---------|
| `main.rs` | Entry point, IPC routing, sidecar management |
| `db.rs` | SQLite operations (sessions, messages, settings, providers, models) |
| `scheduler.rs` | Task scheduler with native notifications |
| `sandbox.rs` | Isolated JS/Python execution |

**Why Tauri over Electron:**
- App size: ~10MB vs ~150MB
- RAM usage: significantly lower
- Security: Rust eliminates entire classes of vulnerabilities

## Layer 2: Node.js Sidecar

**Path:** `src/sidecar/`, `src/agent/`

Sidecar is a standalone Node.js process compiled to binary with `pkg`. Communicates with Rust via stdin/stdout JSON.

| File | Purpose |
|------|---------|
| `sidecar/main.ts` | Sidecar entry point, IPC handling |
| `agent/main.ts` | Agent entry point |
| `agent/libs/runner-openai.ts` | LLM loop, streaming, retry logic |
| `agent/libs/tools-executor.ts` | Tool execution |
| `agent/libs/session-store.ts` | Session state storage |
| `agent/libs/tools/` | All tool implementations |
| `agent/libs/prompts/system.txt` | System prompt template |

## Layer 3: React UI

**Path:** `src/ui/`

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Root component |
| `store/useAppStore.ts` | Zustand store |
| `components/` | UI components (Sidebar, SettingsModal, TodoPanel, etc.) |
| `platform/` | Platform abstraction (tauri.ts, electron.ts, web.ts) |
| `i18n/` | Internationalization (en, ru) |

## Data Flow

1. **UI -> Rust**: User action triggers `ClientEvent` via Tauri IPC
2. **Rust**: Persists to SQLite, forwards to sidecar via stdin
3. **Sidecar**: Processes LLM calls, executes tools, emits `ServerEvent` via stdout
4. **Rust -> UI**: Parses JSON, emits to WebView via `server-event` channel
5. **Sync**: Sidecar sends `session.sync` events, Rust persists to DB

## SQLite Schema

Key tables:
- `sessions` — chat sessions (id, title, cwd, model, status, tokens, timestamps)
- `messages` — messages per session (type, data as JSON)
- `todos` — todo lists per session (data as JSON array)
- `scheduled_tasks` — scheduler (title, schedule, prompt, next_run, is_recurring)
- `settings` — key-value app settings
- `llm_providers` — LLM provider configs (name, type, base_url, api_key)
- `llm_models` — models per provider

## Data Storage Paths

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/ValeDesk/` |
| Windows | `%APPDATA%/ValeDesk/` |
| Linux | `~/.config/ValeDesk/` |

Global data: `~/.valera/memory.md`, `~/.valera/logs/sessions/`
