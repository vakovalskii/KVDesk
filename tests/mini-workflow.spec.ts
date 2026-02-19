import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { MiniWorkflow } from "../src/agent/libs/mini-workflow.ts";
import {
  MiniWorkflowStore,
  buildReplayPrompt,
  checkDistillability,
  distillSessionToWorkflow,
  extractToolTrace,
  filterFailedRetries,
  generateSkillMarkdown,
  redactSecrets,
  resolveTemplate,
  runMiniWorkflowTests,
  saveNewVersion,
  validateWorkflow,
  writeReplayLog
} from "../src/agent/libs/mini-workflow.ts";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "valedesk-mini-workflow-"));
}

function baseWorkflow(id = "report-gen"): MiniWorkflow {
  const now = new Date().toISOString();
  return {
    id,
    name: "Report Gen",
    description: "Workflow",
    icon: "🧪",
    version: "0.1.0",
    created_at: now,
    updated_at: now,
    source_session_id: "sess-1",
    tags: [],
    status: "draft",
    compatibility: {
      valedesk_min_version: "0.0.8",
      tools_required: ["search_web"],
      tools_optional: []
    },
    goal: "Generate report",
    definition_of_done: "File exists",
    constraints: [],
    inputs: [],
    steps: [
      {
        id: "step_1",
        kind: "tool",
        title: "Search",
        description: "Search web",
        outputs: [],
        on_error: { strategy: "fail" },
        tool_name: "search_web",
        args_template: { query: "ai" }
      }
    ],
    tests: [
      {
        id: "t1",
        title: "smoke",
        kind: "tool_smoke",
        params: { tool_name: "search_web", test_args: {} },
        severity: "blocking",
        test_context: "session_cwd"
      }
    ],
    artifacts: [{ type: "text", title: "result", ref: "x" }],
    safety: {
      permission_mode_on_replay: "ask",
      side_effects: [],
      network_policy: "allow_web_read"
    }
  };
}

describe("MiniWorkflow UT", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    for (const d of tempDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("UT-01: extractToolTrace returns ordered pairs", () => {
    const messages: any[] = [
      { type: "user_prompt", prompt: "x" },
      { type: "tool_use", id: "u1", name: "search_web", input: { query: "a" } },
      { type: "tool_result", tool_use_id: "u1", output: "ok", is_error: false },
      { type: "tool_use", id: "u2", name: "write_file", input: { path: "a.md" } },
      { type: "tool_result", tool_use_id: "u2", output: "ok", is_error: false },
      { type: "tool_use", id: "u3", name: "edit_file", input: { path: "a.md" } },
      { type: "tool_result", tool_use_id: "u3", output: "ok", is_error: false }
    ];
    const trace = extractToolTrace(messages as any);
    expect(trace).toHaveLength(3);
    expect(trace.map((t) => t.tool_use.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("UT-02: filterFailedRetries removes failed duplicate when success exists", () => {
    const trace = [
      {
        tool_use: { id: "a1", name: "search_web", input: { query: "AI" } },
        tool_result: { tool_use_id: "a1", output: "err", is_error: true }
      },
      {
        tool_use: { id: "a2", name: "search_web", input: { query: "AI" } },
        tool_result: { tool_use_id: "a2", output: "ok", is_error: false }
      },
      {
        tool_use: { id: "a3", name: "write_file", input: { path: "x.md" } },
        tool_result: { tool_use_id: "a3", output: "ok", is_error: false }
      }
    ];
    const filtered = filterFailedRetries(trace);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.tool_use.id)).toEqual(["a2", "a3"]);
  });

  it("UT-03: checkDistillability identifies conversation-centric session", () => {
    const result = checkDistillability([
      { type: "user_prompt", prompt: "hello" },
      { type: "text", text: "world" }
    ] as any);
    expect(result).toEqual({
      suitable: false,
      reason: "no_tool_calls",
      suggest_prompt_preset: true
    });
  });

  it("UT-04: validateWorkflow fails without goal", () => {
    const wf = baseWorkflow();
    const invalid = { ...wf } as any;
    delete invalid.goal;
    const result = validateWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: goal");
  });

  it("UT-05: redactSecrets replaces secret fields", () => {
    const result = redactSecrets(
      { api_key: "sk-12345", query: "test" },
      new Set(["api_key"])
    );
    expect(result).toEqual({ api_key: "[REDACTED]", query: "test" });
  });

  it("UT-06: resolveTemplate resolves inputs placeholders", () => {
    const args = { query: "{{inputs.topic}} {{inputs.year}}" };
    const resolved = resolveTemplate(args, { inputs: { topic: "AI", year: "2025" } });
    expect(resolved).toEqual({ query: "AI 2025" });
  });

  it("UT-07: resolveTemplate resolves step outputs placeholders", () => {
    const args = { content: "{{steps.search.outputs.results}}" };
    const resolved = resolveTemplate(args, { steps: { search: { results: "found 5 items" } } });
    expect(resolved).toEqual({ content: "found 5 items" });
  });

  it("UT-08: saveNewVersion keeps only last 5 versions", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    let wf = baseWorkflow("report-gen");
    for (let i = 1; i <= 6; i++) {
      wf = { ...wf, version: `0.1.${i}` };
      await saveNewVersion(wf, { baseDir });
    }
    const versionsDir = join(baseDir, ".valera", "workflows", "report-gen", "versions");
    const entries = (await fs.readdir(versionsDir)).sort();
    expect(entries).toEqual(["v2", "v3", "v4", "v5", "v6"]);

    const store = new MiniWorkflowStore();
    const active = await store.load("report-gen", { baseDir });
    expect(active?.version).toBe("0.1.6");
  });

  it("distill with clarification proceeds even without successful tool results", () => {
    const result = distillSessionToWorkflow(
      "sess-1",
      [
        { type: "tool_use", id: "t1", name: "search_web", input: { query: "x" } },
        { type: "tool_result", tool_use_id: "t1", output: "error", is_error: true }
      ] as any,
      "/tmp",
      "Результат был в отчете, даже если tool_result помечен ошибкой."
    );
    expect(result.status).toBe("success");
  });

  it("store list merges project and global with project priority", async () => {
    const globalDir = await makeTempDir();
    const projectDir = await makeTempDir();
    tempDirs.push(globalDir, projectDir);
    const store = new MiniWorkflowStore();
    const g = { ...baseWorkflow("same-id"), name: "Global Wf", updated_at: "2026-01-01T00:00:00.000Z" };
    const p = { ...baseWorkflow("same-id"), name: "Project Wf", updated_at: "2026-01-02T00:00:00.000Z" };
    await store.save(g, { baseDir: globalDir });
    await store.save(p, { projectCwd: projectDir, scope: "project" });
    const list = await store.list({ baseDir: globalDir, projectCwd: projectDir, includeProject: true });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Project Wf");
  });

  it("buildReplayPrompt redacts secret inputs with handles", () => {
    const wf = {
      ...baseWorkflow("secret-wf"),
      inputs: [
        { id: "topic", title: "Topic", description: "", type: "string", required: true },
        { id: "api_key", title: "Api key", description: "", type: "secret", required: true, redaction: true }
      ]
    };
    const { prompt, redactedInputs } = buildReplayPrompt(wf, { topic: "AI", api_key: "sk-real" });
    expect(prompt).toContain("{{secret::api_key}}");
    expect(redactedInputs).toEqual({ topic: "AI", api_key: "[REDACTED]" });
  });

  it("runMiniWorkflowTests validates file_exists in session_cwd", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    await fs.mkdir(join(baseDir, "src"), { recursive: true });
    await fs.writeFile(join(baseDir, "src/index.ts"), "export {};\n", "utf8");
    const wf = {
      ...baseWorkflow("fs-wf"),
      tests: [
        { id: "t1", title: "exists", kind: "file_exists", params: { path: "src/index.ts" }, severity: "blocking", test_context: "session_cwd" as const }
      ]
    };
    const res = await runMiniWorkflowTests(wf, { sessionCwd: baseDir });
    expect(res.passed).toBe(true);
    expect(res.results[0].passed).toBe(true);
  });

  it("runMiniWorkflowTests respects isolated context", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    await fs.writeFile(join(baseDir, "src-index.ts"), "x", "utf8");
    const wf = {
      ...baseWorkflow("iso-wf"),
      tests: [
        { id: "t1", title: "isolated miss", kind: "file_exists", params: { path: "src-index.ts" }, severity: "blocking", test_context: "isolated" as const }
      ]
    };
    const res = await runMiniWorkflowTests(wf, { sessionCwd: baseDir });
    expect(res.passed).toBe(false);
  });

  it("generateSkillMarkdown includes steps and constraints", async () => {
    const wf = {
      ...baseWorkflow("md-wf"),
      constraints: ["no network"],
      inputs: [{ id: "topic", title: "Topic", description: "Theme", type: "string", required: true }]
    };
    const md = await generateSkillMarkdown(wf);
    expect(md).toContain("## Входные данные");
    expect(md).toContain("## Инструкция для агента");
    expect(md).toContain("## Ограничения");
  });

  it("writeReplayLog writes run file with step_results", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const wf = baseWorkflow("replay-wf");
    await writeReplayLog(
      wf,
      {
        inputs: { topic: "AI" },
        final_status: "success",
        step_results: [
          {
            step_id: "s1",
            status: "success",
            outputs: { ok: true },
            duration_ms: 12
          }
        ]
      },
      { baseDir }
    );
    const runsDir = join(baseDir, ".valera", "workflows", "replay-wf", "runs");
    const entries = await fs.readdir(runsDir);
    expect(entries.length).toBe(1);
    const raw = await fs.readFile(join(runsDir, entries[0]), "utf8");
    expect(raw).toContain("\"step_results\"");
    expect(raw).toContain("\"outputs_hash\"");
  });

  it("store.delete removes both global and project scopes", async () => {
    const globalDir = await makeTempDir();
    const projectDir = await makeTempDir();
    tempDirs.push(globalDir, projectDir);
    const store = new MiniWorkflowStore();
    await store.save(baseWorkflow("del-wf"), { baseDir: globalDir });
    await store.save(baseWorkflow("del-wf"), { projectCwd: projectDir, scope: "project" });
    await store.delete("del-wf", { baseDir: globalDir, projectCwd: projectDir, scope: "both" });
    const globalLoaded = await store.load("del-wf", { baseDir: globalDir });
    const projectLoaded = await store.load("del-wf", { baseDir: projectDir });
    expect(globalLoaded).toBeNull();
    expect(projectLoaded).toBeNull();
  });
});

describe("MiniWorkflow Integration (ST scenarios backend)", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    for (const d of tempDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("ST-01 backend: distill tool-centric session yields valid workflow with inputs and steps", () => {
    const messages = [
      { type: "user_prompt", prompt: "Создай отчёт по теме AI на 2 страницы" },
      { type: "tool_use", id: "u1", name: "search_web", input: { query: "AI trends 2025", explanation: "search" } },
      { type: "tool_result", tool_use_id: "u1", output: "ok", is_error: false },
      { type: "tool_use", id: "u2", name: "write_file", input: { path: "report.md", content: "..." } },
      { type: "tool_result", tool_use_id: "u2", output: "ok", is_error: false },
      { type: "text", text: "Готово. Файл report.md создан." }
    ] as any;
    const result = distillSessionToWorkflow("sess_01", messages, "/tmp");
    expect(result.status).toBe("success");
    if (result.status === "success") {
      const wf = result.workflow;
      expect(wf.name).toBeTruthy();
      expect(wf.steps.length).toBeGreaterThanOrEqual(2);
      expect(wf.tests.length).toBeGreaterThanOrEqual(1);
      expect(wf.goal).toBeTruthy();
      expect(validateWorkflow(wf as unknown as Record<string, unknown>).valid).toBe(true);
    }
  });

  it("ST-02 backend: run tests + save creates SKILL.md and workflow.json", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    await fs.mkdir(join(baseDir, "src"), { recursive: true });
    await fs.writeFile(join(baseDir, "src", "report.md"), "# Report\n", "utf8");
    const wf = baseWorkflow("report-gen");
    wf.tests = [
      { id: "t1", title: "report exists", kind: "file_exists", params: { path: "src/report.md" }, severity: "blocking", test_context: "session_cwd" }
    ];
    const store = new MiniWorkflowStore();
    const saved = await store.save(wf, { baseDir });
    const testRes = await runMiniWorkflowTests(saved, { sessionCwd: baseDir });
    expect(testRes.passed).toBe(true);

    const skillPath = join(baseDir, ".valera", "skills", "report-gen", "SKILL.md");
    const wfPath = join(baseDir, ".valera", "skills", "report-gen", "workflow.json");
    const skillExists = await fs.access(skillPath).then(() => true).catch(() => false);
    const wfExists = await fs.access(wfPath).then(() => true).catch(() => false);
    expect(skillExists).toBe(true);
    expect(wfExists).toBe(true);

    const skillContent = await fs.readFile(skillPath, "utf8");
    expect(skillContent).toContain("type: mini-workflow");
  });

  it("ST-05 backend: conversation-centric session returns not_suitable", () => {
    const messages = [
      { type: "user_prompt", prompt: "Привет" },
      { type: "text", text: "Привет! Чем помочь?" },
      { type: "user_prompt", prompt: "Расскажи про погоду" },
      { type: "text", text: "Не могу узнать погоду без инструментов." }
    ] as any;
    const result = distillSessionToWorkflow("sess_02", messages);
    expect(result.status).toBe("not_suitable");
    if (result.status === "not_suitable") {
      expect(result.reason).toContain("инструмент");
      expect(result.suggest_prompt_preset).toBe(true);
    }
  });

  it("ST-07 backend: redactSecrets excludes secrets from payload", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const wf = baseWorkflow("secret-wf");
    (wf as any).inputs = [
      { id: "topic", title: "Topic", description: "", type: "string", required: true },
      { id: "api_key", title: "Api key", description: "", type: "secret", required: true, redaction: true }
    ];
    await writeReplayLog(
      wf,
      { inputs: { topic: "AI", api_key: "sk-real-key-12345" }, final_status: "success" },
      { baseDir }
    );
    const runsDir = join(baseDir, ".valera", "workflows", "secret-wf", "runs");
    const entries = await fs.readdir(runsDir);
    const raw = await fs.readFile(join(runsDir, entries[0]), "utf8");
    expect(raw).not.toContain("sk-real-key-12345");
    expect(raw).toContain("[REDACTED]");
  });

  it("ST-08 backend: delete removes skills and workflow dirs", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const store = new MiniWorkflowStore();
    await store.save(baseWorkflow("seo-audit"), { baseDir });
    const skillPath = join(baseDir, ".valera", "skills", "seo-audit");
    const wfPath = join(baseDir, ".valera", "workflows", "seo-audit");
    expect(await fs.access(skillPath).then(() => true).catch(() => false)).toBe(true);

    await store.delete("seo-audit", { baseDir });
    const skillGone = await fs.access(skillPath).then(() => false).catch(() => true);
    const wfGone = await fs.access(wfPath).then(() => false).catch(() => true);
    expect(skillGone).toBe(true);
    expect(wfGone).toBe(true);
  });
});
