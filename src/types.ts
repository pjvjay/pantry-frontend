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

// ─── a recipe as reviewed lines (RecipeDoc) ──────────────────
// One shape for every recipe the meal plan and the planner take: library recipes, demo
// starters, the shopper's own, imported pages and videos, and dishes the Assistant writes. What
// the shopper reviews is exactly what gets planned (POST /plan/spec), so every amount says where
// it came from. Mirrors RecipeDoc in pantry-api's models.py, which validates it.

// 'imp:draft' is a doc the import sheet holds outside a conversation; chat re-keys it to imp:N.
export type RecipeKey = `lib:${string}` | `starter:${string}` | `my:${string}` | `imp:${number}`
  | 'imp:draft' | `asst:${number}`;

// Shown next to every amount: never presented as more certain than its source.
export type AmountBasis = 'stated_by_source' | 'demo_house_amounts' | 'parsed_from_your_paste'
  | 'transcribed_confirmed_by_you' | 'written_by_assistant';

export interface RecipeLine {
  line_no: number;
  text: string;                    // verbatim, as the source wrote it
  name: string;
  quantity: number | null;         // null: the source states no amount
  unit: string;
  note: string;
  // where in the source the line is: a quote, or mm:ss in a video
  evidence: { quote?: string | null; at?: string | null } | null;
  // false only for lines transcribed from a video, until the shopper ticks them; such a line
  // is never planned
  confirmed: boolean;
  amount_basis: AmountBasis;
}

export interface RecipeSource {
  kind: 'library' | 'starter' | 'pasted' | 'web' | 'youtube' | 'assistant';
  method: 'db' | 'seed' | 'paste' | 'jsonld' | 'microdata' | 'youtube_description'
    | 'youtube_linked_page' | 'gemini_video' | 'agent_written';
  url?: string | null;
  site?: string | null;
  page_title?: string | null;
  author?: string | null;
  channel?: string | null;
  retrieved_at?: string | null;
  extractor?: string | null;
  model?: string | null;
  label?: string | null;           // e.g. "demo recipe"
}

export interface RecipeDoc {
  v: 1;
  key: RecipeKey;
  title: string;
  servings: number | null;         // null: not stated, and never taken as 1
  servings_stated: boolean;
  servings_basis: 'source' | 'your_setting' | null;
  yield_text: string;              // verbatim
  lines: RecipeLine[];             // ingredient lines only, at most 60; method text is never kept
  source: RecipeSource;
  warnings: string[];
}

// ─── recipe import (the demo hub's /hub/recipes/import) ──────
// A link read into a RecipeDoc for the shopper to review. The hub fetches; pantry-api never
// does. Mirrors demo-hub's recipe_import ImportResult (docs/recipe-import.md there).

// pantry's POST /recipes/parse-lines: lines read with no LLM.
export interface ParsedLine {
  line_no: number;
  text: string;
  name: string;
  quantity: number | null;
  unit: string;
  note: string;
  amount_basis: 'parsed_from_your_paste' | 'stated_by_source';
}

export interface ParsedLines {
  servings: number | null;         // null: nothing says how many it serves
  servings_stated: boolean;
  lines: ParsedLine[];
  warnings: string[];
}

// Today's Gemini video seconds against the hub's daily cap (UTC date).
export interface VideoDaily {
  date: string;
  seconds: number;
  calls: number;
  limit_s: number;
}

export interface VideoTranscribe {
  enabled: boolean;
  reason: string;                  // why not, when it is not enabled
  model?: string;
  daily?: VideoDaily;
}

export interface ImportVideo {
  id: string;
  url: string;
  title: string;
  channel: string;
  channel_url?: string | null;
  thumbnail_url?: string | null;
  duration_s: number | null;       // null without a YouTube key: the shopper estimates it
  description_read: boolean;
  transcribe: VideoTranscribe;
  daily?: VideoDaily;
}

// What Gemini's transcription cost, as the hub priced it ("preview pricing" while it is free).
export interface ImportUsage {
  kind: 'video_import';
  model: string;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_cost_usd: number;
  pricing: string;
}

export type ImportNeeds = 'none' | 'confirm_lines' | 'choose_method' | 'needs_servings';

export interface ImportResult {
  doc: RecipeDoc | null;           // null exactly when needs is choose_method
  method: RecipeSource['method'] | null;
  linked_pages: { url: string; site: string }[];
  video: ImportVideo | null;
  needs: ImportNeeds;
  warnings: string[];
  structured_data?: 'jsonld' | 'microdata';
  usage?: ImportUsage;
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
  // the summed need of every line this purchase covers; null when one of them states no amount,
  // or they are in different units
  need_qty?: number | null;
  need_uom?: 'g' | 'ml' | 'each' | null;
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
  servings?: number | null;     // null: the recipe does not say, and the plan never claims 1
  basis?: PlanBasis | null;
}

// ─── what a plan was built from (PlanBasis) ──────────────────
// Everything needed to re-rank or re-price a plan without asking a model again: the planned
// lines, the constraints, the location and origin rules, what was left out, and the shopper's
// pins. The console never reads into it; it holds a meal plan's basis and sends it back to the
// alternatives and re-pricing endpoints, which validate it. Mirrors PlanBasis in pantry-api's
// models.py.

export interface BasisLine {
  line_no: number;
  name: string;
  form: string | null;
  prep: string | null;
  quantity: number | null;
  unit: string | null;
  level: 'exact' | 'form' | 'generic';
  product_id: number | null;
  confidence: number | null;
  // the selector called its pick a substitution, so a re-price keeps saying so
  substitution: boolean;
}

// The shopper's own choice for a line, which the planner keeps.
export interface Pin {
  line_no: number;
  product_id: number;
}

// nlsearch Constraints, as parsed from the request.
export interface PlanConstraints {
  max_item_price: number | null;
  max_total_budget: number | null;
  max_distance_km: number | null;
  exclude_tags: string[];
  require_tags: string[];
  categories: string[];
  exclude_categories: string[];
  subcategories: string[];
  exclude_subcategories: string[];
  soft_text: string;
}

export interface PlanBasis {
  v: 1;
  // library: a seeded recipe; nl: typed text through the parser; spec: reviewed lines (a
  // RecipeDoc), planned with no parse
  path: 'library' | 'nl' | 'spec';
  recipe_slug: string;
  recipe_name: string;
  lines: BasisLine[];
  constraints: PlanConstraints;
  lat: number | null;
  lon: number | null;
  max_km: number | null;
  exclude_origin: string[];
  preference: string[];
  origin_requested: boolean;
  origin_dropped: number;          // how many products the origin exclusion removed
  interpretation: string[];
  not_stocked: DroppedIngredient[];
  out_of_range: DroppedIngredient[];
  skipped: DroppedIngredient[];
  ingredient_count: number;
  pins: Pin[];
  servings: number | null;         // the plan's own servings, so a re-price reports them
}

// ─── a planned line's alternatives (AlternativeRanking) ──────
// The other products that could fill one line of a plan, in the planner's own order, with the
// cart's pick among them (`current`). Built by pantry-api's alternatives.py from the plan's
// basis and the database alone: every fact on a row is a database fact or says it is unknown,
// and `data_note` labels what is demo data. Mirrors models.py.

// A short reason on a row; `tone` says how to show it, and its text says it without colour.
export interface AltReason {
  code: string;                    // match | pack | origin | trip | rating
  text: string;
  tone: 'plus' | 'minus' | 'info' | 'unknown';
}

// The product's cheapest offer in range, per pack. `store` is '' and `distance_km` null when
// the plan has no shopping location (the catalog price).
export interface AltOffer {
  store: string;
  price: number;
  distance_km: number | null;
  on_trip: boolean;
}

// Another purchase the trip buys at a different store after the swap.
export interface AltMove {
  product_id: number;
  product: string;
  from_store: string;
  to_store: string;
}

// Where a trip buys a product, and its price a pack there.
export interface AltBuy {
  store: string;
  price: number;
  distance_km: number | null;
}

// The cart's trip re-optimised with this product on the line, exactly as a swap would price it.
// `buys_at`: the store that trip buys the product at and its price a pack there, which is what
// the cart charges after the swap (the row's offer is the lowest price in range, which the trip
// may skip when the stop costs more than it saves). Absent from an older pantry.
export interface AltTrip {
  total: number;
  delta: number;                   // 0 for the cart's own pick
  stores: string[];
  stops_delta: number;
  buys_at?: AltBuy | null;
  merges_with_line: number | null;
  moved_items: AltMove[];
}

export interface AltOrigin {
  status: string;
  country: string;                 // '' unless the evidence resolved
  claim: 'full' | 'processing' | '';
  label: string;                   // e.g. "Origin not checked"
  verbatim: string;
  source: string;
  demo: boolean;                   // evidence from a demo label photo
}

export interface AltRating {
  avg: number;
  count: number;
  synthetic: boolean;
}

export interface RankedAlternative {
  rank: number;
  current: boolean;                // the cart's pick
  product_id: number;
  product: string;
  brand: string;
  size: string;
  // same: the ingredient itself; other: shares a word or the aisle; outside: the cart's pick
  // when it matches none of the line's words
  tier: 'same' | 'other' | 'outside';
  match: 'exact' | 'form' | 'generic' | 'related' | 'substitute' | 'outside';
  offer: AltOffer;
  packs: number;                   // what the cart would buy
  pack_fit: 'covers' | 'short' | 'unknown';
  cost_for_need: number | null;    // null: the amount or the pack size is unknown or not comparable
  unit_price: number | null;
  unit_basis: '100 g' | '100 ml' | 'each' | '';
  trip: AltTrip | null;            // null: no shopping location, or not worked out for this row
  origin: AltOrigin;
  rating: AltRating | null;        // null: no reviews (never 0 stars)
  says_organic: boolean;
  reasons: AltReason[];            // at most 5: match, pack, origin, trip, rating
  rank_reason: string;             // why it sits below the row above, in plain words
}

// A product the plan's origin exclusion holds back: shown with its evidence, never choosable.
export interface HeldBack {
  product_id: number;
  product: string;
  country: string;
  field: string;                   // ingredient_origin | manufactured_in | conflicting_evidence
  verbatim: string;
  source: string;
  demo: boolean;
}

export interface AlternativeRanking {
  line_no: number;
  lines: number[];                 // every recipe line the purchase covers
  ingredient: string;
  need: string;                    // "500 g", or '' when there is no amount to compare
  // why `need` is '': "Recipe gives no amount", "Planned without amounts (a library recipe)",
  // "Recipe amount '2 cloves' can't be compared with a pack"; absent from an older pantry
  need_note?: string;
  need_qty: number | null;
  need_uom: string | null;
  order: string[];
  ranking_text: string;
  items: RankedAlternative[];      // the first `limit` rows, plus the cart's pick wherever it ranks
  held_back: HeldBack[];
  total: number;                   // every ranked row
  unavailable: number;             // matching products with no offer in range
  counts: { exact: number; no_new_stop: number; preferred_origin: number; says_organic: number;
            rated: number };
  data_note: string;
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
  // with recipe import: whether the hub can read links (it has the extractor) and video
  // descriptions (it has a YouTube key), and whether Gemini may watch a video
  recipe_import?: { links: boolean; youtube_description: boolean; reason?: string };
  video_import?: VideoTranscribe;
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

// ─── a plan as a shopping cart (the hub's plan cards) ────────
// The Assistant's answer carries each plan as a card (`plans` on the 'assistant' event), drawn
// by components/cart.tsx. The types live here so pure modules can build carts too (a meal-plan
// trip is drawn as one). The fields marked "with …" come from hubs that have that feature; all
// are optional, so a card from an older hub renders as before.

export type CartLine = {
  ingredient: string; product: string; product_id?: number; store?: string; price?: number;
  trip_store?: string; trip_price?: number | null; origin_country?: string; origin_status?: string;
  confidence?: number; match?: string; packs?: number;
  // with cart alternatives: the recipe line this purchase is for, and the other lines it covers
  line_no?: number; also_lines?: number[];
  brand?: string; size?: string;
  // with the meal plan: a muted note ("for 3 meals: …") and a warning ("amount unknown")
  note?: string; warn?: string;
};
export type LeftOut = { ingredient: string; reason?: string; suggestions?: string[] };
export type CartSummary = {
  recipe_name?: string; total_cost?: number; lines?: CartLine[]; origin_status?: string;
  coverage?: { spend_fraction?: number; lines_known?: number; lines_total?: number } | null;
  trip?: { stores: string[]; total_cost: number; basket_cost?: number; travel_cost?: number } | null;
  not_stocked?: LeftOut[]; out_of_range?: LeftOut[]; skipped?: LeftOut[];
};
export type PlanCardData = {
  kind: 'plan' | 'week'; summary: CartSummary;
  // with cart alternatives: the hub's tool_log index of the plan behind the card, which the
  // Options dialog and a swap name, and the lines the shopper has pinned
  ref?: number; pinned_lines?: number[];
  // links the card offers, such as a week card's "Open in Meal plan"; the console draws one only
  // when it has the tab the link leads to (alternatives.routedLinks)
  links?: { label: string; href: string }[];
};

// The hub's answer to a swap in a chat cart: the re-priced plan's card, which replaces the card
// it was chosen from, and the note the model reads next turn ('' when the line is back to what
// the model last saw).
export type SwapResult = { card: PlanCardData; note: string };

// The hub's answer to an import in chat. doc_key names the doc the model plans with
// plan_from_lines, null when no lines were read (a video with none). `fallback`: a web page the
// hub could not read goes to the fetch tool as before; a YouTube link never does.
export type RecipeImportEvent =
  | { type: 'recipe_import'; status: 'ok'; url: string | null; doc_key: string | null;
      result: ImportResult; note: string; ms: number; via?: 'console' }
  | { type: 'recipe_import'; status: 'failed'; url: string;
      error: { status: number; code: string; message: string; [k: string]: unknown };
      fallback: boolean; ms: number };

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
  | { type: 'assistant'; text: string; step: number; reply?: string; plans?: PlanCardData[] }
  // A change the shopper made in a cart since the last turn, told to the model at the start of
  // this one (`note` is the line it reads); sent right after 'start', once per changed line.
  | { type: 'cart_change'; ref: number; line_no: number; lines: number[]; recipe_name: string;
      ingredient: string; from: { id: number | null; name: string };
      to: { id: number | null; name: string }; total_before: number | null;
      total_after: number | null; stores_after: string[]; undone: boolean; note: string;
      structured: { summary: CartSummary; full: null } }
  // A link in the shopper's message read by the hub before the model's first call, or the
  // recipe the shopper reviewed in the import sheet (via 'console').
  | RecipeImportEvent
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
