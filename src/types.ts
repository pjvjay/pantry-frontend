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
  trip_options: TripOption[];
}

// 5A: weekly menu optimizer (/plan/week)
export interface WeekItem {
  product_id: number;
  product_name: string;
  store_name: string;
  price: number;
  used_by: string[];
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
}

export interface Health {
  status: string;
  routing_strategy: string;
  default_model: string;
  escalation_model: string;
  confidence_threshold: number;
}
