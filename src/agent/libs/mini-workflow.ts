import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { StreamMessage } from "../types.js";
import { loadApiSettings } from "./settings-store.js";
import { getTools } from "./tools-definitions.js";
import type { DistillResult, MiniWorkflow, MiniWorkflowSummary, StepSpec } from "../../shared/mini-workflow-types.js";
export type { DistillResult, MiniWorkflow, MiniWorkflowSummary } from "../../shared/mini-workflow-types.js";

export type ToolUseMessage = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultMessage = {
  tool_use_id: string;
  output: unknown;
  is_error?: boolean;
};

export type ToolTracePair = {
  tool_use: ToolUseMessage;
  tool_result: ToolResultMessage | null;
};

export function extractToolTrace(messages: StreamMessage[]): ToolTracePair[] {
  const pending = new Map<string, ToolUseMessage>();
  const ordered: ToolTracePair[] = [];
  for (const msg of messages as Array<any>) {
    if (msg?.type === "tool_use") {
      const toolUse: ToolUseMessage = { id: String(msg.id), name: String(msg.name), input: (msg.input as Record<string, unknown>) ?? {} };
      pending.set(toolUse.id, toolUse);
      ordered.push({ tool_use: toolUse, tool_result: null });
      continue;
    }
    if (msg?.type === "tool_result" && msg.tool_use_id) {
      const toolUseId = String(msg.tool_use_id);
      const result: ToolResultMessage = { tool_use_id: toolUseId, output: msg.output, is_error: Boolean(msg.is_error) };
      const index = ordered.findIndex((p) => p.tool_use.id === toolUseId);
      if (index >= 0) {
        ordered[index] = { tool_use: ordered[index].tool_use, tool_result: result };
      } else if (pending.has(toolUseId)) {
        ordered.push({ tool_use: pending.get(toolUseId)!, tool_result: result });
      }
    }
  }
  return ordered;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const obj = value as Record<string, unknown>;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function filterFailedRetries(trace: ToolTracePair[]): ToolTracePair[] {
  return trace.filter((item, idx) => {
    if (!item.tool_result?.is_error) return true;
    const signature = `${item.tool_use.name}::${stableStringify(item.tool_use.input)}`;
    for (let i = idx + 1; i < trace.length; i++) {
      const next = trace[i];
      const nextSig = `${next.tool_use.name}::${stableStringify(next.tool_use.input)}`;
      if (nextSig === signature && next.tool_result && !next.tool_result.is_error) {
        return false;
      }
    }
    return true;
  });
}

export function checkDistillability(messages: StreamMessage[]): { suitable: boolean; reason?: string; suggest_prompt_preset?: boolean } {
  const hasToolUse = (messages as Array<any>).some((m) => m?.type === "tool_use");
  if (!hasToolUse) {
    return { suitable: false, reason: "no_tool_calls", suggest_prompt_preset: true };
  }
  return { suitable: true };
}

export function resolveTemplate<T>(template: T, context: { inputs?: Record<string, unknown>; steps?: Record<string, Record<string, unknown>> }): T {
  const replaceInString = (value: string): unknown => {
    const pure = value.match(/^\{\{([^}]+)\}\}$/);
    const resolveRef = (refPath: string): unknown => {
      const path = refPath.trim();
      if (path.startsWith("inputs.")) return context.inputs?.[path.slice("inputs.".length)];
      if (path.startsWith("steps.")) {
        const parts = path.split(".");
        if (parts.length >= 4 && parts[2] === "outputs") {
          const stepId = parts[1];
          const outputName = parts.slice(3).join(".");
          return context.steps?.[stepId]?.[outputName];
        }
      }
      return `{{${path}}}`;
    };
    if (pure) return resolveRef(pure[1]);
    return value.replace(/\{\{([^}]+)\}\}/g, (_, p1) => String(resolveRef(String(p1)) ?? ""));
  };
  if (typeof template === "string") return replaceInString(template) as T;
  if (Array.isArray(template)) return template.map((v) => resolveTemplate(v, context)) as T;
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(template as Record<string, unknown>)) {
      out[key] = resolveTemplate(val, context);
    }
    return out as T;
  }
  return template;
}

export function redactSecrets<T>(payload: T, secretFields: Set<string>, secretValues: string[] = []): T {
  const redactString = (value: string): string => {
    let next = value;
    for (const s of secretValues) {
      if (!s) continue;
      next = next.split(s).join("[REDACTED]");
    }
    return next;
  };
  if (typeof payload === "string") return redactString(payload) as T;
  if (Array.isArray(payload)) return payload.map((v) => redactSecrets(v, secretFields, secretValues)) as T;
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (secretFields.has(k)) out[k] = "[REDACTED]";
      else out[k] = redactSecrets(v, secretFields, secretValues);
    }
    return out as T;
  }
  return payload;
}

export function validateWorkflow(workflow: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const required = ["id", "name", "description", "version", "goal", "definition_of_done", "inputs", "steps", "tests", "artifacts", "safety"];
  const errors: string[] = [];
  for (const field of required) {
    if (!(field in workflow)) errors.push(`missing required field: ${field}`);
  }
  if (typeof workflow.id !== "string") errors.push("id must be string");
  if (typeof workflow.name !== "string") errors.push("name must be string");
  if (!Array.isArray(workflow.inputs)) errors.push("inputs must be array");
  if (!Array.isArray(workflow.steps)) errors.push("steps must be array");
  if (!Array.isArray(workflow.tests)) errors.push("tests must be array");
  if (!Array.isArray(workflow.artifacts)) errors.push("artifacts must be array");
  if (!workflow.safety || typeof workflow.safety !== "object") errors.push("safety must be object");

  const inputs = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  for (const input of inputs as Array<any>) {
    if (typeof input?.id !== "string") errors.push("input.id must be string");
    if (typeof input?.type !== "string") errors.push(`input ${String(input?.id)}: type must be string`);
    if (typeof input?.required !== "boolean") errors.push(`input ${String(input?.id)}: required must be boolean`);
    if (input?.type === "enum" && !Array.isArray(input?.enum_values)) {
      errors.push(`input ${String(input?.id)}: enum requires enum_values`);
    }
  }
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  for (const step of steps as Array<any>) {
    if (typeof step?.id !== "string") errors.push("step.id must be string");
    if (!["tool", "llm", "manual"].includes(String(step?.kind))) errors.push(`step ${String(step?.id)}: invalid kind`);
    if (!Array.isArray(step?.outputs)) errors.push(`step ${String(step?.id)}: outputs must be array`);
    if (!step?.on_error || typeof step.on_error !== "object") errors.push(`step ${String(step?.id)}: on_error required`);
    if (step?.on_error?.strategy === "retry") {
      if (typeof step.on_error.max_retries !== "number") errors.push(`step ${step.id}: retry strategy requires max_retries`);
      else if (step.on_error.max_retries > 3) errors.push(`step ${step.id}: max_retries must be <= 3`);
    }
  }
  const tests = Array.isArray(workflow.tests) ? workflow.tests : [];
  for (const test of tests as Array<any>) {
    if (typeof test?.id !== "string") errors.push("test.id must be string");
    if (!test?.kind) errors.push(`test ${String(test?.id)}: kind required`);
    if (!test?.params || typeof test.params !== "object") errors.push(`test ${String(test?.id)}: params must be object`);
  }
  const safety = workflow.safety as any;
  if (safety) {
    if (!["ask", "auto"].includes(String(safety.permission_mode_on_replay))) errors.push("safety.permission_mode_on_replay invalid");
    if (!["offline", "allow_web_read", "allow_web_write"].includes(String(safety.network_policy))) errors.push("safety.network_policy invalid");
    if (!Array.isArray(safety.side_effects)) errors.push("safety.side_effects must be array");
  }
  return { valid: errors.length === 0, errors };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `workflow-${randomUUID().slice(0, 8)}`;
}

function parsePatch(version: string): number {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return 0;
  return Number(m[3]) || 0;
}

function nextPatch(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "0.1.0";
  return `${m[1]}.${m[2]}.${(Number(m[3]) || 0) + 1}`;
}

function baseDirs(baseDir?: string): { skillsDir: string; workflowsDir: string } {
  const root = baseDir ?? homedir();
  return {
    skillsDir: join(root, ".valera", "skills"),
    workflowsDir: join(root, ".valera", "workflows")
  };
}

function dedupeById(workflows: MiniWorkflowSummary[]): MiniWorkflowSummary[] {
  const map = new Map<string, MiniWorkflowSummary>();
  for (const wf of workflows) {
    const prev = map.get(wf.id);
    if (!prev || prev.updated_at < wf.updated_at) map.set(wf.id, wf);
  }
  return Array.from(map.values()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function generateSkillMarkdown(workflow: MiniWorkflow): Promise<string> {
  const inputsYaml = workflow.inputs
    .map((i) => `  - id: ${i.id}\n    title: "${i.title.replace(/"/g, '\\"')}"\n    description: "${(i.description || "").replace(/"/g, '\\"')}"\n    type: ${i.type}\n    required: ${i.required ? "true" : "false"}`)
    .join("\n");
  const tools = workflow.compatibility.tools_required.map((t) => `"${t}"`).join(", ");
  const stepsMd = workflow.steps
    .map((s, idx) => `${idx + 1}. [${s.kind}] ${s.title}\n   - ${s.description}`)
    .join("\n");
  const constraintsMd = workflow.constraints.length > 0
    ? workflow.constraints.map((c) => `- ${c}`).join("\n")
    : "- Нет дополнительных ограничений.";
  const inputsMd = workflow.inputs.length > 0
    ? workflow.inputs.map((i) => `- \`${i.id}\` (${i.type})${i.required ? " [required]" : ""} — ${i.description || i.title}`).join("\n")
    : "- Нет входных параметров.";
  return `---
name: ${workflow.name}
description: ${workflow.description}
type: mini-workflow
icon: ${workflow.icon}
allowed-tools: [${tools}]
inputs:
${inputsYaml || "  []"}
workflow-file: workflow.json
---

# ${workflow.name}

## Цель
${workflow.goal}

## Входные данные
${inputsMd}

## Инструкция для агента
${stepsMd || "1. Выполни задачу по цели и Definition of Done."}

## Ограничения
${constraintsMd}

## Definition of Done
${workflow.definition_of_done}
`;
}

export async function saveNewVersion(workflow: MiniWorkflow, options?: { baseDir?: string }): Promise<{ versionFolder: string; totalVersions: number }> {
  const { skillsDir, workflowsDir } = baseDirs(options?.baseDir);
  const workflowDir = join(skillsDir, workflow.id);
  const versionsDir = join(workflowsDir, workflow.id, "versions");
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.mkdir(versionsDir, { recursive: true });

  const skillMd = await generateSkillMarkdown(workflow);
  await fs.writeFile(join(workflowDir, "workflow.json"), JSON.stringify(workflow, null, 2), "utf8");
  await fs.writeFile(join(workflowDir, "SKILL.md"), skillMd, "utf8");

  const entries = await fs.readdir(versionsDir, { withFileTypes: true }).catch(() => []);
  const nums = entries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => Number(e.name.slice(1)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const next = (nums[nums.length - 1] ?? 0) + 1;
  const folder = join(versionsDir, `v${next}`);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(join(folder, "workflow.json"), JSON.stringify(workflow, null, 2), "utf8");
  await fs.writeFile(join(folder, "SKILL.md"), skillMd, "utf8");

  const nowEntries = await fs.readdir(versionsDir, { withFileTypes: true });
  const nowNums = nowEntries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => Number(e.name.slice(1)))
    .sort((a, b) => a - b);
  while (nowNums.length > 5) {
    const oldest = nowNums.shift();
    if (oldest !== undefined) await fs.rm(join(versionsDir, `v${oldest}`), { recursive: true, force: true });
  }
  return { versionFolder: `v${next}`, totalVersions: Math.min(nowNums.length, 5) };
}

function inferGoal(messages: StreamMessage[]): string {
  const prompts = (messages as Array<any>).filter((m) => m?.type === "user_prompt").map((m) => String(m.prompt || "").trim()).filter(Boolean);
  return prompts[0] || "Выполнить задачу с использованием инструментов.";
}

function inferDone(messages: StreamMessage[]): string {
  const text = (messages as Array<any>).filter((m) => m?.type === "text").map((m) => String(m.text || ""));
  const last = text[text.length - 1] || "";
  if (/готов|создан|сохранен|completed|done/i.test(last)) return "Финальный результат сформирован без ошибок.";
  return "Результат воспроизводится при повторном запуске.";
}

export function distillSessionToWorkflow(sessionId: string, messages: StreamMessage[], cwd?: string, clarification?: string): DistillResult {
  const suitability = checkDistillability(messages);
  if (!suitability.suitable) {
    return {
      status: "not_suitable",
      reason: "Сессия не содержит вызовов инструментов.",
      suggest_prompt_preset: Boolean(suitability.suggest_prompt_preset)
    };
  }
  const trace = filterFailedRetries(extractToolTrace(messages)).filter((p) => p.tool_result && !p.tool_result.is_error);
  if (trace.length === 0 && !clarification) {
    return {
      status: "needs_clarification",
      questions: ["Был ли достигнут результат в этой сессии? Что именно является результатом?"]
    };
  }
  const effectiveTrace = trace.length > 0
    ? trace
    : filterFailedRetries(extractToolTrace(messages)).filter((p) => p.tool_result);

  const nameBase = effectiveTrace[effectiveTrace.length - 1].tool_use.name.replace(/_/g, " ");
  const workflowId = slugify(nameBase);
  const now = new Date().toISOString();
  const toolsRequired = Array.from(new Set(effectiveTrace.map((t) => t.tool_use.name)));
  const steps: StepSpec[] = effectiveTrace.map((pair, idx) => ({
    id: `step_${idx + 1}_${pair.tool_use.name}`,
    kind: "tool",
    title: `${pair.tool_use.name}`,
    description: `Вызов инструмента ${pair.tool_use.name}`,
    outputs: [],
    on_error: { strategy: "fail" },
    tool_name: pair.tool_use.name,
    args_template: pair.tool_use.input
  }));

  const promptTexts = (messages as Array<any>)
    .filter((m) => m?.type === "user_prompt")
    .map((m) => String(m.prompt || ""));
  const promptCorpus = promptTexts.join("\n");
  const candidateValues = new Map<string, string>();
  for (const pair of effectiveTrace) {
    for (const [argKey, argValue] of Object.entries(pair.tool_use.input || {})) {
      if (typeof argValue !== "string") continue;
      const value = argValue.trim();
      if (!value || value.length < 3) continue;
      if (promptCorpus.toLowerCase().includes(value.toLowerCase())) {
        candidateValues.set(argKey, value);
      }
    }
  }
  const inputs = Array.from(candidateValues.entries()).map(([key, value]) => ({
    id: key.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(),
    title: key,
    description: `Параметр "${key}" для повторного запуска.`,
    type: value.startsWith("http://") || value.startsWith("https://") ? "url" : "string",
    required: true,
    default: value,
    redaction: /(token|secret|key|password)/i.test(key)
  })) as MiniWorkflow["inputs"];

  const inputByKey = new Map(inputs.map((i) => [i.title, i]));
  const parameterizedSteps: StepSpec[] = steps.map((step) => {
    if (!step.args_template) return step;
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step.args_template)) {
      const input = inputByKey.get(k);
      mapped[k] = input ? `{{inputs.${input.id}}}` : v;
    }
    return { ...step, args_template: mapped };
  });

  const workflow: MiniWorkflow = {
    id: workflowId,
    name: nameBase.charAt(0).toUpperCase() + nameBase.slice(1),
    description: "Автоматически выделенный mini-workflow из сессии.",
    icon: "🧩",
    version: "0.1.0",
    created_at: now,
    updated_at: now,
    source_session_id: sessionId,
    source_session_cwd: cwd,
    tags: ["distilled"],
    status: "draft",
    compatibility: {
      valedesk_min_version: "0.0.8",
      tools_required: toolsRequired,
      tools_optional: []
    },
    goal: clarification ? `Цель по уточнению пользователя: ${clarification}` : inferGoal(messages),
    definition_of_done: inferDone(messages),
    constraints: [],
    inputs,
    steps: parameterizedSteps,
    tests: [
      {
        id: "tool_smoke_1",
        title: `Tool smoke: ${toolsRequired[0]}`,
        kind: "tool_smoke",
        params: { tool_name: toolsRequired[0], test_args: {} },
        severity: "blocking",
        test_context: "session_cwd"
      }
    ],
    artifacts: [
      {
        type: "text",
        title: "Assistant output",
        ref: "{{steps.step_1.outputs.result}}"
      }
    ],
    safety: {
      permission_mode_on_replay: "ask",
      side_effects: [],
      network_policy: "allow_web_read"
    }
  };

  const validation = validateWorkflow(workflow as unknown as Record<string, unknown>);
  if (!validation.valid) {
    return { status: "needs_clarification", questions: validation.errors };
  }
  return { status: "success", workflow };
}

export class MiniWorkflowStore {
  private async listOneRoot(options?: { baseDir?: string }): Promise<MiniWorkflowSummary[]> {
    const { skillsDir } = baseDirs(options?.baseDir);
    await fs.mkdir(skillsDir, { recursive: true });
    const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
    const result: MiniWorkflowSummary[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const wfPath = join(skillsDir, dir.name, "workflow.json");
      try {
        const raw = await fs.readFile(wfPath, "utf8");
        const wf = JSON.parse(raw) as MiniWorkflow;
        if (wf.status === "archived") continue;
        result.push({
          id: wf.id,
          name: wf.name,
          description: wf.description,
          icon: wf.icon,
          version: wf.version,
          status: wf.status,
          tags: wf.tags,
          inputs_count: wf.inputs.length,
          updated_at: wf.updated_at
        });
      } catch {
        // ignore invalid entries
      }
    }
    return result.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async list(options?: { baseDir?: string; projectCwd?: string; includeProject?: boolean }): Promise<MiniWorkflowSummary[]> {
    const globalItems = await this.listOneRoot({ baseDir: options?.baseDir });
    if (!options?.includeProject || !options.projectCwd) return globalItems;
    const projectItems = await this.listOneRoot({ baseDir: options.projectCwd });
    return dedupeById([...projectItems, ...globalItems]);
  }

  async load(workflowId: string, options?: { baseDir?: string; projectCwd?: string; preferProject?: boolean }): Promise<MiniWorkflow | null> {
    if (options?.preferProject && options.projectCwd) {
      const local = await this.load(workflowId, { baseDir: options.projectCwd });
      if (local) return local;
    }
    const { skillsDir } = baseDirs(options?.baseDir);
    const wfPath = join(skillsDir, workflowId, "workflow.json");
    try {
      const raw = await fs.readFile(wfPath, "utf8");
      return JSON.parse(raw) as MiniWorkflow;
    } catch {
      return null;
    }
  }

  async save(workflow: MiniWorkflow, options?: { baseDir?: string; projectCwd?: string; scope?: "global" | "project" }): Promise<MiniWorkflow> {
    const targetBaseDir = options?.scope === "project" && options.projectCwd ? options.projectCwd : options?.baseDir;
    const current = await this.load(workflow.id, { baseDir: targetBaseDir });
    const patch = current ? parsePatch(current.version) : -1;
    const incomingPatch = parsePatch(workflow.version);
    const version = incomingPatch <= patch ? nextPatch(current?.version ?? "0.1.0") : workflow.version;
    const now = new Date().toISOString();
    const toSave: MiniWorkflow = {
      ...workflow,
      version,
      created_at: current?.created_at ?? workflow.created_at ?? now,
      updated_at: now
    };
    await saveNewVersion(toSave, { baseDir: targetBaseDir });
    return toSave;
  }

  async delete(workflowId: string, options?: { baseDir?: string; projectCwd?: string; scope?: "global" | "project" | "both" }): Promise<void> {
    if (options?.scope === "both" && options.projectCwd) {
      await this.delete(workflowId, { baseDir: options.baseDir, scope: "global" });
      await this.delete(workflowId, { baseDir: options.projectCwd, scope: "project" });
      return;
    }
    const targetBaseDir =
      options?.scope === "project" && options.projectCwd
        ? options.projectCwd
        : options?.baseDir;
    const { skillsDir, workflowsDir } = baseDirs(targetBaseDir);
    await fs.rm(join(skillsDir, workflowId), { recursive: true, force: true });
    await fs.rm(join(workflowsDir, workflowId), { recursive: true, force: true });
  }
}

export async function runMiniWorkflowTests(
  workflow: MiniWorkflow,
  context?: { sessionCwd?: string; tempRoot?: string }
): Promise<{ passed: boolean; results: Array<{ id: string; title: string; kind: string; severity: "blocking" | "warning"; passed: boolean; message: string }> }> {
  const results: Array<{ id: string; title: string; kind: string; severity: "blocking" | "warning"; passed: boolean; message: string }> = [];
  const sessionCwd = context?.sessionCwd || workflow.source_session_cwd || process.cwd();
  const tempRoot = context?.tempRoot ?? join(process.cwd(), ".tmp-miniworkflow-tests");
  const isolatedDir = join(tempRoot, `run-${randomUUID()}`);
  await fs.mkdir(isolatedDir, { recursive: true });
  try {
    for (const test of workflow.tests) {
      let passed = true;
      let message = "ok";
      const testContext = test.test_context ?? "session_cwd";
      const baseDir = testContext === "isolated" ? isolatedDir : sessionCwd;
      try {
        if (test.kind === "tool_smoke") {
          const toolName = String(test.params?.tool_name || "");
          const tools = getTools(loadApiSettings());
          const available = new Set(tools.map((t) => t.function.name));
          passed = Boolean(toolName) && available.has(toolName);
          message = passed ? "tool available" : `tool unavailable: ${toolName}`;
        } else if (test.kind === "file_exists") {
          const pathValue = resolveTemplate(String(test.params?.path || ""), { inputs: {}, steps: {} });
          await fs.access(join(baseDir, String(pathValue)));
        } else if (test.kind === "file_contains") {
          const pathValue = resolveTemplate(String(test.params?.path || ""), { inputs: {}, steps: {} });
          const mustInclude = Array.isArray(test.params?.must_include) ? (test.params?.must_include as string[]) : [];
          const content = await fs.readFile(join(baseDir, String(pathValue)), "utf8");
          const missing = mustInclude.filter((m) => !content.includes(m));
          passed = missing.length === 0;
          message = missing.length ? `missing: ${missing.join(", ")}` : "content ok";
        } else if (test.kind === "json_schema") {
          const pathValue = resolveTemplate(String(test.params?.json_path || ""), { inputs: {}, steps: {} });
          const raw = await fs.readFile(join(baseDir, String(pathValue)), "utf8");
          JSON.parse(raw);
        } else if (test.kind === "custom_llm_judge") {
          passed = true;
          message = "custom_llm_judge skipped in MVP runner";
        }
      } catch (error) {
        passed = false;
        message = String(error);
      }
      results.push({
        id: test.id,
        title: test.title,
        kind: test.kind,
        severity: test.severity,
        passed,
        message
      });
    }
  } finally {
    await fs.rm(isolatedDir, { recursive: true, force: true }).catch(() => undefined);
  }
  const blockingFailed = results.some((r) => r.severity === "blocking" && !r.passed);
  return { passed: !blockingFailed, results };
}

export function buildReplayPrompt(workflow: MiniWorkflow, inputs: Record<string, unknown>): { prompt: string; redactedInputs: Record<string, unknown> } {
  const secretFields = new Set(workflow.inputs.filter((i) => i.type === "secret" || i.redaction).map((i) => i.id));
  const renderedInputs: Record<string, unknown> = {};
  for (const input of workflow.inputs) {
    const raw = inputs[input.id] ?? input.default ?? "";
    renderedInputs[input.id] = secretFields.has(input.id) ? `{{secret::${input.id}}}` : raw;
  }
  const lines = Object.entries(renderedInputs).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const stepsLines = workflow.steps.map((s, idx) => `${idx + 1}. [${s.kind}] ${s.title} (${s.description})`);
  return {
    prompt: `Выполни mini-workflow "${workflow.name}".\n\nЦель:\n${workflow.goal}\n\nInputs:\n${lines.join("\n")}\n\nШаги:\n${stepsLines.join("\n")}\n\nDefinition of done:\n${workflow.definition_of_done}`,
    redactedInputs: redactSecrets(inputs, secretFields)
  };
}

export async function writeReplayLog(workflow: MiniWorkflow, payload: { inputs: Record<string, unknown>; final_status: "success" | "partial" | "failed" | "aborted"; step_results?: Array<{ step_id: string; status: "success" | "failed" | "skipped"; outputs?: unknown; error?: string | null; duration_ms?: number; started_at?: string; finished_at?: string }> }, options?: { baseDir?: string }): Promise<void> {
  const base = options?.baseDir ?? homedir();
  const runId = randomUUID();
  const runDir = join(base, ".valera", "workflows", workflow.id, "runs");
  try {
    await fs.mkdir(runDir, { recursive: true });
    const results = (payload.step_results || []).map((s) => ({
      step_id: s.step_id,
      status: s.status,
      started_at: s.started_at ?? new Date().toISOString(),
      finished_at: s.finished_at ?? new Date().toISOString(),
      duration_ms: s.duration_ms ?? 0,
      outputs_hash: createHash("sha256").update(JSON.stringify(s.outputs ?? null)).digest("hex"),
      error: s.error ?? null
    }));
    const secretFields = new Set(workflow.inputs.filter((i) => i.type === "secret" || i.redaction).map((i) => i.id));
    const content = {
      run_id: runId,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      inputs: redactSecrets(payload.inputs, secretFields),
      step_results: results,
      final_status: payload.final_status
    };
    await fs.writeFile(join(runDir, `${runId}.json`), JSON.stringify(content, null, 2), "utf8");
  } catch {
    // Non-blocking by spec
  }
}
