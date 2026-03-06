// ─── MiniApp v2: chain-of-prompts architecture ───

export type WorkflowStatus = "draft" | "testing" | "published" | "archived";

// ─── Input spec (what to ask user before launch) ───

export type InputSpec = {
  id: string;
  title: string;
  description: string;
  type: "string" | "text" | "number" | "boolean" | "enum" | "date" | "datetime" | "file_path" | "url" | "secret";
  required: boolean;
  default?: unknown;
  enum_values?: string[];
  redaction?: boolean;
};

// ─── Chain step (a single focused prompt for the orchestrator) ───

export type ChainStep = {
  id: string;
  title: string;
  prompt_template: string;              // may contain {{inputs.X}} and {{steps.prev_id.result}}
  tools: string[];                       // which tools are available for this step
  output_key: string;                    // name used to reference this step's result
  execution: "llm" | "script";          // how to execute: LLM agent or deterministic script
  script?: {
    language: "python" | "javascript";
    code: string;                        // inline script source
    file?: string;                       // saved script path (filled after distill)
  };
};

// ─── Validation config ───

export type ValidationConfig = {
  acceptance_criteria: string;           // human-readable criteria for the result
  prompt_template: string;               // prompt for the validation agent
  tools: string[];                       // tools available during validation
  max_fix_attempts: number;              // max retries (typically 3)
};

// ─── Artifact description ───

export type ArtifactSpec = {
  type: "file" | "text" | "link" | "table";
  title: string;
  description: string;
};

// ─── The MiniWorkflow itself ───

export type MiniWorkflow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  created_at: string;
  updated_at: string;
  source_session_id: string;
  source_session_cwd?: string;
  tags: string[];
  status: WorkflowStatus;
  compatibility: {
    valedesk_min_version: string;
    tools_required: string[];
    tools_optional: string[];
  };
  goal: string;
  definition_of_done: string;
  constraints: string[];
  inputs: InputSpec[];
  chain: ChainStep[];
  validation: ValidationConfig;
  artifacts: ArtifactSpec[];
  safety: {
    permission_mode_on_replay: "ask" | "auto";
    side_effects: Array<"local_fs" | "git" | "network" | "external_accounts">;
    network_policy: "offline" | "allow_web_read" | "allow_web_write";
  };
};

// ─── Distill result ───

export type DistillResult =
  | { status: "success"; workflow: MiniWorkflow }
  | { status: "needs_clarification"; questions: string[] }
  | { status: "not_suitable"; reason: string; suggest_prompt_preset: boolean };

// ─── Summary for list view ───

export type MiniWorkflowSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  status: WorkflowStatus;
  tags?: string[];
  inputs_count: number;
  updated_at: string;
};

// ─── Test result (for UI display during distill) ───

export type MiniWorkflowTestResult = {
  id: string;
  title: string;
  passed: boolean;
  message: string;
};
