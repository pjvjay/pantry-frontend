// Mirrors pantry-api's pydantic models (pantry_planner/models.py).

export interface RecipeIngredient {
  line_no: number;
  name: string;
  category: string | null;
}

export interface Recipe {
  slug: string;
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
}

export interface PlanLineItem {
  line_no: number;
  ingredient_name: string;
  product_id: number;
  product_name: string;
  product_description: string;
  price: number;
  confidence: number;
  reasoning: string;
  model_used: string;
  // Query-plan path: which store the price comes from
  store_name: string;
  store_price: number | null;
  origin?: OriginReceipt | null;
  // One purchase can cover several recipe lines: line_no is the first, also_lines the rest.
  match?: 'exact' | 'form' | 'generic';
  also_lines?: number[];
  packs?: number;
}

// An ingredient a partial plan (allow_partial) left out instead of aborting.
export interface DroppedIngredient {
  ingredient: string;
  reason: string;
  suggestions: string[];
}

// One executed step of the retrieval query plan (t1 existence -> t2 options
// -> t3 brand stats -> t4 lookups), with its SQL for the timeline panel.
// One stretch of a step's time. LLM calls: DNS lookup, TCP connect, TLS handshake, upload,
// waiting for the provider, download, retry wait (per HTTP attempt).
export interface StepPhase {
  name: string;
  ms: number;
  attempt: number;
}

export interface StepResult {
  step_id: string;
  kind: 'existence' | 'options' | 'statistics' | 'lookup' | 'llm';
  label: string;
  sql_display: string;
  row_count: number;
  duration_ms: number;
  outcome: 'ok' | 'aborted' | 'skipped';
  phases?: StepPhase[];
}

// One LLM call inside a plan, phase by phase; server_ms is the provider's own processing
// time as its front end reports it (Google's server-timing), when it does.
export interface LlmCallTrace {
  step: string;
  model: string;
  total_ms: number;
  attempts: number;
  status: number | null;
  server_ms: number | null;
  phases: StepPhase[];
}

export interface PlanAlertDetail {
  name: string;
  reason: string;
  suggestions: string[];
}

export interface PlanAlert {
  stage: string;
  code: 'missing_ingredients' | 'unavailable_within_constraints' | 'budget_infeasible';
  message: string;
  details: PlanAlertDetail[];
}

// The 409 payload when a plan gate aborts: trace up to the failed step + alert.
export interface PlanExecution {
  steps: StepResult[];
  aborted: PlanAlert | null;
}

// 4A: one point on the stops-vs-cost frontier from the split-trip optimizer.
export interface TripItem {
  product_id: number;
  product_name: string;
  store_name: string;
  price: number;
}

export interface TripOption {
  stores: string[];
  basket_cost: number;
  travel_km: number;
  travel_cost: number;
  total_cost: number;
  savings_vs_one_stop: number;
  recommended: boolean;
  items: TripItem[]; // populated on the recommended option only
}

export interface ShoppingPlan {
  recipe_slug: string;
  recipe_name: string;
  line_items: PlanLineItem[];
  total_cost: number;
  routing_strategy: string;
  preselected_model: string;
  escalated: boolean;
  total_llm_cost_usd: number;
  total_latency_ms: number;
  // NL2SQL path extras (empty on the classic path)
  interpretation: string[];
  plan_trace: StepResult[];
  candidate_count: number;
  llm_calls?: LlmCallTrace[];
  burr_run?: string;            // the Burr run (app id) that traced this plan call
  trip_options: TripOption[];
  origin_coverage?: OriginCoverage | null;
  // not_requested | verified | unverified — read this before calling a basket clean
  origin_status?: 'not_requested' | 'verified' | 'unverified';
  not_stocked?: DroppedIngredient[];
  out_of_range?: DroppedIngredient[];
  skipped?: DroppedIngredient[];
  ingredient_count?: number;
}

// 5A: weekly menu optimizer (/plan/week)
export interface WeekItem {
  product_id: number;
  product_name: string;
  store_name: string;
  price: number;
  used_by: string[];
  origin?: OriginReceipt | null;
}

export interface DayPlan {
  recipe_slug: string;
  recipe_name: string;
  line_items: PlanLineItem[];
  day_cost: number;
}

export interface WeekPlan {
  days: DayPlan[];
  shopping_list: WeekItem[];
  total_cost: number;
  standalone_cost: number;
  overlap_savings: number;
  budget: number | null;
  notes: string[];
  plan_trace: StepResult[];
  trip_options: TripOption[];
  total_llm_cost_usd: number;
  origin_coverage?: OriginCoverage | null;
  // not_requested | verified | unverified — read this before calling a basket clean
  origin_status?: 'not_requested' | 'verified' | 'unverified';
}

export interface Health {
  status: string;
  routing_strategy: string;
  default_model: string;
  escalation_model: string;
  confidence_threshold: number;
  demo_mode?: boolean;
}

// ─── Provenance (pantry-api origins.py) ──────────────────────

// status is what the ranking keys off. Only 'resolved' carries usable
// evidence: 'unknown' means no source published an origin, 'conflicting'
// means sources disagreed and no winner was picked, 'lookup_failed' means
// a source did not answer, and 'guess' is a name-based hint that is never
// provenance. Absence is never evidence of foreign origin.
export interface ProductOrigin {
  product_id: number;
  product_name: string;
  status: 'resolved' | 'conflicting' | 'unknown' | 'lookup_failed' | 'guess';
  claim_type: string;
  country: string;
  ingredient_origin: string;
  manufactured_in: string;
  verbatim: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  note: string;
  evidence_count: number;
}

export interface RankedProduct {
  product_id: number;
  product_name: string;
  price: number;
  rank: number;
  tier_label: string;
  origin: ProductOrigin;
  matched_country: string;
  matched_field: string;
}

export interface ExcludedProduct {
  product_id: number;
  product_name: string;
  price: number;
  excluded_country: string;
  matched_field: string;
  claim_type: string;
  verbatim: string;
  confidence: string;
}

export interface UnrankedProduct {
  product_id: number;
  product_name: string;
  price: number;
  reason: 'no_evidence' | 'conflicting' | 'lookup_failed' | 'guess_only';
  detail: string;
}

export interface OriginRanking {
  preference: string[];
  exclude: string[];
  ranked: RankedProduct[];
  excluded: ExcludedProduct[];
  unranked: UnrankedProduct[];
  counts: Record<string, number>;
  coverage_note: string;
}

// Provenance carried on a chosen plan line (pantry-api origins.py).
export interface OriginReceipt {
  status: string;
  country: string;
  claim_type: string;
  ingredient_origin: string;
  manufactured_in: string;
  source: string;
  confidence: string;
  verbatim: string;
}

// How much of a basket's provenance is actually known. Reported both
// count- and spend-weighted because they diverge: the one line somebody
// photographed is often the cheapest thing in the cart.
export interface OriginCoverage {
  lines_total: number;
  lines_known: number;
  lines_excluded_origin: number;
  count_fraction: number;
  spend_total: number;
  spend_known: number;
  spend_fraction: number;
  meets_floor: boolean;
  floor: number;
  note: string;
}

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  subcategory: string | null;
  dietary_tags: string | null;
  unit_size: string | null;
  brand: string | null;
  store_name: string | null;
  store_price: number | null;
  distance_km: number | null;
}

// ─── Demo hub (pantry-platform/demo-hub) ─────────────────────

export interface RuntimeSettings {
  demo_mode: boolean;
  models: Record<string, string>;
  gemini_key_configured?: boolean;
  anthropic_key_configured?: boolean;
  editable?: boolean;
}

export interface ServiceStatus {
  id: string;
  label: string;
  url: string;
  ok: boolean;
  status: number;
  detail: Record<string, unknown> | null;
  links?: Record<string, string>;
  runtime?: RuntimeSettings | null;
  servers?: { name: string; id: string; tools: number }[];
  models?: string[];
  skill?: string | null;
}

export interface HubStatus {
  services: ServiceStatus[];
  keys: Record<string, boolean>;
  agent: { default_model: string };
}

export interface McpTarget {
  id: string;
  label: string;
  description: string;
  auth: string;
  url: string;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
}

export interface McpResource { uri: string; name?: string; description?: string; mimeType?: string }
export interface McpTemplate { uriTemplate: string; name?: string; description?: string }
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface McpCatalog {
  target: McpTarget;
  tools: McpTool[];
  resources: McpResource[];
  resource_templates: McpTemplate[];
  prompts: McpPrompt[];
  notes: string[];
}

export interface ToolResult {
  name: string;
  is_error: boolean;
  structured: unknown;
  text: string;
  truncated: boolean;
  ms: number;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  title?: string;
  [key: string]: unknown;
}

// Every event is stamped by the hub: `ts` ms since the turn began, `at` epoch ms when it was sent
// (the browser measures how late it arrived).
export type AgentEvent = AgentEventBody & { ts?: number; at?: number };

export interface EvalCheck { name: string; passed: boolean; detail: string }

// A plan's own confidence: the selector's per-line confidence, exact matches, origin coverage.
export interface PlanConfidence {
  lines: number;
  min_line_confidence: number | null;
  mean_line_confidence: number | null;
  exact_share: number | null;
  origin_status?: string | null;
  origin_spend_verified?: number | null;
  left_out: number;
}

// The answer's online evals: deterministic checks against this turn's own tool results.
export interface Evals {
  checks: EvalCheck[];
  passed: number;
  total: number;
  answer_confidence: number | null;
  plan: PlanConfidence | null;
}

type AgentEventBody =
  | { type: 'start'; conversation_id: string; model: string; target: string; tools: string[];
      available?: number; disclosure?: 'progressive' | 'all'; trace_id?: string }
  | { type: 'observing'; trigger: string; model: string; observers: string[] }
  | { type: 'observation'; observer: string; condition: string; kind: 'code' | 'llm'; when: string;
      value: boolean; evidence: string; added: string[]; removed: string[] }
  | { type: 'goal_enabled'; reason: string; skill: string | null; text: string }
  | { type: 'tools_offered'; added: string[]; removed: string[]; reason: string }
  | { type: 'thinking'; step: number; model: string }
  | { type: 'progress'; step: number; model: string; phase: 'reading' | 'writing' | 'waiting';
      elapsed_s?: number; tokens?: number; eta_s?: number | null; estimate_s?: number;
      read_s?: number; gen_s?: number; prompt_tokens_est?: number; new_tokens_est?: number;
      output_tokens_est?: number; read_tok_s?: number; gen_tok_s?: number; samples?: number;
      basis?: string }
  | { type: 'llm_call'; step: number; model: string; tool_calls: number; wall_s?: number;
      prompt_tokens?: number; prompt_s?: number; output_tokens?: number; gen_s?: number;
      load_s?: number; num_ctx?: number; thinking_chars?: number; new_tokens_est?: number;
      reasoning?: string }
  // `plans`: the turn's plan results as data, drawn by the browser under `reply` (the model's
  // own sentences); `text` is the same answer with the hub's Markdown tables
  | { type: 'assistant'; text: string; step: number; reply?: string;
      plans?: { kind: 'plan' | 'week'; summary: Record<string, unknown> }[] }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; step: number }
  | ({ type: 'tool_result'; id: string; step: number; model_chars?: number } & ToolResult)
  | ({ type: 'evals'; trace_id: string } & Evals)
  | { type: 'error'; message: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; steps: number; stop: string; seconds: number;
      input_tokens: number; output_tokens: number };

export interface AgentOptions {
  models: { id: string; label: string }[];
  default_model: string;
  targets: McpTarget[];
  default_target: string;
  max_steps: number;
  skill_loaded: boolean;
  disclosures?: ('progressive' | 'all')[];
  default_disclosure?: 'progressive' | 'all';
}

export interface SimScenario {
  name: string;
  title: string;
  category: string;
  status: string;
  passed?: number;
  runs?: number;
  pass_rate?: number | null;
  pass_k?: unknown;
  last_run?: string | null;
  run_count?: number;
  [key: string]: unknown;
}

export interface SimJob {
  id: string;
  state: string;
  scenarios: { name: string; state: string; run_id?: string | null }[];
  log: string[];
  [key: string]: unknown;
}

// --- traces and metrics (the hub's /hub/traces and /hub/metrics) ------------------------------

export interface Span {
  id: string;
  parent: string | null;
  kind: 'turn' | 'observers' | 'model' | 'tool' | 'gateway' | 'gateway.tool' | 'pantry.step'
    | 'pantry.llm' | 'browser';
  name: string;
  start_ms: number;
  end_ms: number | null;
  duration_ms: number | null;
  status: string;
  attrs: Record<string, unknown>;
  events: { at_ms: number; name: string; attrs: Record<string, unknown> }[];
}

export interface TraceSummary {
  id: string;
  started_at: string;
  model: string;
  target: string;
  disclosure: string;
  message: string;
  status: string;
  wall_ms: number | null;
  steps: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  tools: string[];
  answer_confidence: number | null;
}

export interface Trace extends TraceSummary {
  conversation_id: string;
  turn: number;
  evals: Evals | null;
  browser: Record<string, unknown> | null;
  spans: Span[];
}

// One run as every system saw it (GET /hub/runs/{id}): the hub's trace with pantry's steps at
// Burr's recorded times, each plan call's Burr run, and each tool call's ContextForge trace.
export interface BurrStep {
  action: string;
  sequence_id: number;
  start_ms: number | null;
  end_ms: number | null;
  ms: number | null;
  inputs: unknown;
  result: unknown;
  exception: string | null;
  changed: Record<string, unknown>;
}

export interface BurrRun {
  tool_span: string;
  app_id: string;
  ui_url: string;
  steps: BurrStep[];
  note?: string;
}

export interface GatewaySpan {
  name: string;
  status: string;
  duration_ms: number | null;
  start_ms: number | null;
  attributes: Record<string, unknown>;
}

export interface GatewayTrace {
  tool_span: string;
  trace_id: string;
  name?: string;
  status?: string;
  http_status?: number;
  duration_ms?: number;
  start_ms?: number | null;
  attributes?: Record<string, unknown>;
  spans?: GatewaySpan[];
  note?: string;
}

export interface RunDetail {
  trace: Trace;
  burr: BurrRun[];
  gateway: GatewayTrace[];
  links: { burr_ui: string; contextforge: string };
}

export type MetricsRow = Record<string, string | number | null>;

export interface Metrics {
  traces: number;
  answer_confidence_mean: number | null;
  models: MetricsRow[];
  tools: MetricsRow[];
  observers: MetricsRow[];
  evals: MetricsRow[];
  pantry_steps: MetricsRow[];
  browser: Record<string, unknown> & { api: MetricsRow[] };
  hub_http: MetricsRow[];
  prices_usd_per_1m: Record<string, { input: number; output: number }>;
  prices_source: string;
  free_tier_requests_per_day: number;
}
