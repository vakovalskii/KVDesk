# LLM Agent Loop

## Overview

The agent loop lives in `src/agent/libs/runner-openai.ts` and follows a **ReAct-style** pattern.

## Flow

```
Build messages -> Call LLM -> Stream response -> Execute tools -> Add results -> Continue
```

1. **Build messages**: System prompt + history + user message + memory
2. **Call LLM**: OpenAI SDK streaming request
3. **Stream response**: Emit tokens to UI via `requestAnimationFrame` throttling (60fps)
4. **Execute tools**: If tool calls present, check permissions, execute, add results
5. **Loop**: Continue until LLM returns text-only response (no tool calls)

## Configuration

| Parameter | Value |
|-----------|-------|
| `MAX_ITERATIONS` | 50 |
| `REQUEST_TIMEOUT` | 5 minutes |
| `MAX_STREAM_RETRIES` | 3 |
| `LOOP_THRESHOLD` | 5 (same-tool calls before hint) |

## Loop Detection

When the same tool is called 5+ consecutive times, a hint is injected telling the model to try a different approach.

## Error Handling

Retryable errors: `ECONNRESET`, `ETIMEDOUT`, HTTP 429, 500+. Uses exponential backoff with max 3 retries.

## Logging

Each turn is logged to `~/.valera/logs/sessions/{sessionId}/`:
- `turn-NNN-request.json` — full request (model, messages, tools, temperature)
- `turn-NNN-response.json` — full response (usage, content, tool_calls)

## System Prompt

Built dynamically from `src/agent/libs/prompts/system.txt` template:
- Variable substitution: `{osName}`, `{platform}`, `{shell}`, `{cwd}`, `{tools_summary}`, `{skills_section}`
- Tools summary generated from actual definitions (`generateToolsSummary()`)
- Memory content appended to first user message in `<USER_MEMORY>` tags
- Current todos appended in XML format
- Loaded skills added to `LOADED_SKILLS` section
