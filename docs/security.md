# Security

## Multi-Layer Protection

| Layer | Mechanism | Description |
|-------|-----------|-------------|
| File system | Directory sandboxing | Access only within workspace folder |
| JavaScript | Node.js vm | No network, no timers, no modules |
| Python | Subprocess | Separate process with workspace restriction |
| Tools | Permission modes | Confirmation for dangerous operations |
| Data | Local-only | No telemetry, everything stored locally |

## Workspace Sandboxing

All file paths are validated through:
1. **Path normalization** (`path.normalize()`) — prevents `../` traversal
2. **Symlink resolution** (`fs.realpathSync()`) — prevents symlink escapes
3. **Absolute path verification** — must start with workspace path
4. **Security logging** — violations logged to console

## No-Workspace Mode

Users can start chat without workspace:
- General conversation and web search work normally
- File operations are blocked with helpful error messages

## Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` | Every tool call requires user confirmation |
| `default` | Auto-execute for trusted operations |

`run_command`, `write_file`, `edit_file` always require confirmation.

## Reporting Security Issues

Email security issues directly. Do NOT create public GitHub issues for vulnerabilities.
