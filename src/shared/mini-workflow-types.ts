export type DistillResult =
  | { status: "success"; workflow: MiniWorkflow }
  | { status: "needs_clarification"; questions: string[] }
  | { status: "not_suitable"; reason: string; suggest_prompt_preset: boolean };

export type WorkflowStatus = "draft" | "testing" | "published" | "archived";
export type TestSeverity = "blocking" | "warning";
export type TestContext = "session_cwd" | "isolated";

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

export type OutputSpec = {
  name: string;
  type: "string" | "file_path" | "json" | "number" | "boolean";
  description: string;
  source: "tool_result" | "llm_response" | "manual_input";
};

export type StepSpec = {
  id: string;
  kind: "tool" | "llm" | "manual";
  title: string;
  description: string;
  outputs: OutputSpec[];
  on_error: { strategy: "fail" | "retry" | "ask_user"; max_retries?: number };
  tool_name?: string;
  args_template?: Record<string, unknown>;
};

export type TestSpec = {
  id: string;
  title: string;
  kind: "file_exists" | "file_contains" | "json_schema" | "tool_smoke" | "custom_llm_judge";
  params: Record<string, unknown>;
  severity: TestSeverity;
  test_context?: TestContext;
};

export type ArtifactSpec = {
  type: "file" | "text" | "link" | "table";
  title: string;
  ref: string;
};

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
  steps: StepSpec[];
  tests: TestSpec[];
  artifacts: ArtifactSpec[];
  safety: {
    permission_mode_on_replay: "ask" | "auto";
    side_effects: Array<"local_fs" | "git" | "network" | "external_accounts">;
    network_policy: "offline" | "allow_web_read" | "allow_web_write";
  };
};

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

export type MiniWorkflowTestResult = {
  id: string;
  title: string;
  kind: string;
  severity: "blocking" | "warning";
  passed: boolean;
  message: string;
};
