# Tools Reference

All tools follow `snake_case` naming with `verb_noun` pattern.

## File Operations

| Tool | Description |
|------|-------------|
| `read_file` | Read text file (up to 5MB) |
| `write_file` | Create new files |
| `edit_file` | Modify files (search & replace) |
| `search_files` | Find files by glob (`*.pdf`, `src/**/*.ts`) |
| `search_text` | Grep-like content search |
| `read_document` | PDF/DOCX text extraction (up to 10MB) |
| `attach_image` | Attach images for vision models |

## Code Execution

| Tool | Description |
|------|-------------|
| `execute_python` | System Python 3 + all pip packages |
| `execute_js` | Node.js vm sandbox (limited) |
| `run_command` | Bash/PowerShell commands |

### Sandbox Comparison

**Python (`execute_python`):**
- Full stdlib (json, os, re, datetime, sqlite3...)
- All pip packages (numpy, pandas, requests...)
- File I/O within workspace
- Network requests allowed

**JavaScript (`execute_js`):**
- `fs`, `path`, `console`, `JSON`, `Math`, `Date` available
- No `require()`, `import` (no npm modules)
- No `fetch()`, `async/await` (no network)
- No `setTimeout`, `setInterval` (no timers)

## Web Tools

| Tool | Description |
|------|-------------|
| `search_web` | Internet search (Tavily/Z.AI) |
| `extract_page` | Full page content (Tavily) |
| `read_page` | Z.AI Reader |
| `render_page` | Chromium for SPA/Telegram |
| `fetch_html` | Download HTML |
| `fetch_json` | Download and parse JSON |
| `download_file` | Download files |

## Browser Automation

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_click` | Click element |
| `browser_type` | Type text |
| `browser_screenshot` | Take screenshot |
| `browser_scroll` | Scroll page |

Powered by Playwright.

## Git Operations

| Tool | Description |
|------|-------------|
| `git_status` | Repository status |
| `git_log` | Commit history |
| `git_diff` | File changes |
| `git_commit` | Create commit |
| `git_push` | Push to remote |
| `git_pull` | Pull changes |
| `git_branch` | Branch management |
| `git_checkout` | Switch branches |

## Memory & Tasks

| Tool | Description |
|------|-------------|
| `manage_memory` | Persistent user preferences (`~/.valera/memory.md`) |
| `manage_todos` | Visual todo panel with progress tracking |
| `schedule_task` | Create/manage scheduled tasks |
| `load_skill` | Load specialized instructions |

## Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` | Every tool call requires user confirmation |
| `default` | Execute without asking (trusted operations) |

`run_command`, `write_file`, `edit_file` always require confirmation regardless of mode.

## Creating New Tools

1. Define tool with JSON schema in `src/agent/libs/tools/your-tool.ts`
2. Create execution function
3. Register in tools index
4. Follow `verb_noun` naming pattern
