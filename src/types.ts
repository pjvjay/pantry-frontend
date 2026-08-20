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
}

// One executed step of the retrieval query plan (t1 existence -> t2 options
// -> t3 brand stats -> t4 lookups), with its SQL for the timeline panel.
export interface StepResult {
  step_id: string;
  kind: 'existence' | 'options' | 'statistics' | 'lookup';
  label: string;
  sql_display: string;
  row_count: number;
  duration_ms: number;
  outcome: 'ok' | 'aborted' | 'skipped';
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
}

export interface Health {
  status: string;
  routing_strategy: string;
  default_model: string;
  escalation_model: string;
  confidence_threshold: number;
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
