import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { MiniWorkflow } from "../src/shared/mini-workflow-types.ts";
import {
  MiniWorkflowStore,
  buildReplayPrompt,
  checkDistillability,
  generateSkillMarkdown,
  redactSecrets,
  renderTemplate,
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
    chain: [
      {
        id: "step_1",
        title: "Search the web",
        prompt_template: "Search for {{inputs.topic}} and summarize findings.",
        tools: ["search_web"],
        output_key: "research"
      },
      {
        id: "step_2",
        title: "Write report",
        prompt_template: "Based on research:\n{{steps.step_1.result}}\n\nWrite a report.",
        tools: ["write_file"],
        output_key: "report"
      }
    ],
    validation: {
      acceptance_criteria: "Report file exists and contains all sections",
      prompt_template: "Check the report and fix if needed.",
      tools: ["read_file", "write_file"],
      max_fix_attempts: 3
    },
    artifacts: [{ type: "file", title: "report.md", description: "Generated report" }],
    safety: {
      permission_mode_on_replay: "ask",
      side_effects: [],
      network_policy: "allow_web_read"
    }
  };
}

describe("MiniWorkflow v2 UT", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    for (const d of tempDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("UT-01: checkDistillability identifies conversation-centric session", () => {
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

  it("UT-02: checkDistillability accepts session with tool calls", () => {
    const result = checkDistillability([
      { type: "user_prompt", prompt: "do something" },
      { type: "tool_use", id: "u1", name: "search_web", input: {} }
    ] as any);
    expect(result.suitable).toBe(true);
  });

  it("UT-03: validateWorkflow fails without goal", () => {
    const wf = baseWorkflow();
    const invalid = { ...wf } as any;
    delete invalid.goal;
    const result = validateWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: goal");
  });

  it("UT-04: validateWorkflow fails without chain", () => {
    const wf = baseWorkflow();
    const invalid = { ...wf } as any;
    delete invalid.chain;
    const result = validateWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: chain");
  });

  it("UT-05: validateWorkflow passes for valid workflow", () => {
    const wf = baseWorkflow();
    const result = validateWorkflow(wf as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  it("UT-06: redactSecrets replaces secret fields", () => {
    const result = redactSecrets(
      { api_key: "sk-12345", query: "test" },
      new Set(["api_key"])
    );
    expect(result).toEqual({ api_key: "[REDACTED]", query: "test" });
  });

  it("UT-07: renderTemplate resolves inputs placeholders", () => {
    const result = renderTemplate(
      "Search for {{inputs.topic}} in {{inputs.year}}",
      { inputs: { topic: "AI", year: "2025" }, steps: {} }
    );
    expect(result).toBe("Search for AI in 2025");
  });

  it("UT-08: renderTemplate resolves step result placeholders", () => {
    const result = renderTemplate(
      "Based on:\n{{steps.search.result}}",
      { inputs: {}, steps: { search: { result: "found 5 items" } } }
    );
    expect(result).toBe("Based on:\nfound 5 items");
  });

  it("UT-09: saveNewVersion keeps only last 5 versions", async () => {
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

  it("UT-10: buildReplayPrompt generates correct prompt", () => {
    const wf = baseWorkflow();
    wf.inputs = [
      { id: "topic", title: "Topic", description: "Research topic", type: "string", required: true }
    ];
    const { prompt } = buildReplayPrompt(wf, { topic: "AI" });
    expect(prompt).toContain("Report Gen");
    expect(prompt).toContain("AI");
    expect(prompt).toContain("Критерии готовности");
    expect(prompt).toContain("Report file exists and contains all sections");
  });

  it("UT-11: buildReplayPrompt redacts secret inputs", () => {
    const wf = {
      ...baseWorkflow("secret-wf"),
      inputs: [
        { id: "topic", title: "Topic", description: "", type: "string" as const, required: true },
        { id: "api_key", title: "Api key", description: "", type: "secret" as const, required: true, redaction: true }
      ]
    };
    const { prompt, redactedInputs } = buildReplayPrompt(wf, { topic: "AI", api_key: "sk-real" });
    expect(prompt).toContain("{{secret::api_key}}");
    expect(redactedInputs).toEqual({ topic: "AI", api_key: "[REDACTED]" });
  });

  it("UT-12: store list merges project and global with project priority", async () => {
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

  it("UT-13: store.delete removes both global and project scopes", async () => {
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

  it("UT-14: generateSkillMarkdown includes chain steps", async () => {
    const wf = {
      ...baseWorkflow("md-wf"),
      constraints: ["no network"],
      inputs: [{ id: "topic", title: "Topic", description: "Theme", type: "string" as const, required: true }]
    };
    const md = await generateSkillMarkdown(wf);
    expect(md).toContain("## Входные данные");
    expect(md).toContain("## Цепочка шагов");
    expect(md).toContain("Search the web");
    expect(md).toContain("## Ограничения");
  });

  it("UT-15: writeReplayLog writes run file", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const wf = baseWorkflow("replay-wf");
    await writeReplayLog(
      wf,
      {
        inputs: { topic: "AI" },
        final_status: "success",
        step_results: [{ step_id: "s1", status: "success", duration_ms: 12 }]
      },
      { baseDir }
    );
    const runsDir = join(baseDir, ".valera", "workflows", "replay-wf", "runs");
    const entries = await fs.readdir(runsDir);
    expect(entries.length).toBe(1);
    const raw = await fs.readFile(join(runsDir, entries[0]), "utf8");
    expect(raw).toContain('"step_results"');
  });

  it("UT-16: writeReplayLog redacts secrets", async () => {
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
});
