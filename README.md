# pantry-frontend

React SPA for the [pantry-platform](https://github.com/pjvjay/pantry-platform)
GitOps demo. Lists recipes from [pantry-api](https://github.com/pjvjay/pantry-api)
and renders LLM-matched shopping plans (products, prices, per-item confidence,
which Claude model handled each line).

Served under **`/pantry/`** in every environment — the ingress, the compose
file, and the vite dev proxy all agree on that contract.

## Local dev

```bash
npm install
npm run dev
# → http://localhost:5173/pantry/  (proxies /pantry/api → localhost:8000)
```

Run the API alongside it (`uvicorn pantry_planner.api:app` in pantry-api), or
bring up the whole stack with docker-compose from pantry-platform.

## Recipe import

"Import a recipe" (the Assistant's composer and the Planner) reads a recipe
into ingredient lines the shopper reviews before anything is planned
(`components/ImportSheet.tsx`). What was reviewed is what gets planned: lines
can be ticked or removed, never rewritten.

| Tab | Read by | Where |
|---|---|---|
| Link | the demo hub's `POST /hub/recipes/import` (the hub fetches; pantry-api never does) | local stack only |
| YouTube | the same route: title and channel, and with the hub's YouTube key the description; Gemini watches the video only on a click (`/hub/recipes/import/video`) | local stack only |
| Paste | pantry-api's `POST /recipes/parse-lines`, no AI | everywhere |

Without a hub (`/hub/status` does not answer) only Paste is offered, with
"Reading links needs the local demo hub". "Plan this now" sends the reviewed
doc into the chat (`recipe_doc`) in the Assistant when the hub reports
`recipe_import` in `/hub/status` (an older hub would drop the doc), and to
`POST /plan/spec` otherwise. A link pasted in chat is read by the hub before the model starts;
its `recipe_import` event is drawn as an import card.

`src/recipes.ts` (pure, tested) holds the sheet's words and edits and the
browser storage contract, in its header:

- `pantry.recipes.v1`: `{v: 1, recipes: RecipeDoc[]}`, each keyed `my:<id>`
  ("Save to my recipes"); the meal plan reads the same key.
- `pantry.mealplan.inbox.v1`: `{v: 1, entries: [{key, title, added_at}]}`
  ("Add to meal plan"): saved recipes waiting for the meal plan's tray, which
  takes them with `takeInbox`.

## Tests

Logic that needs no browser lives in pure modules (`src/mealplan/*.ts` and
the others named in `tests/pure-modules.test.ts`): no React, DOM or
`import.meta.env`, and sibling imports name the `.ts` file. Node runs them
and `tests/*.test.ts` as they are, stripping the types itself, so there is no
test framework to install. It needs Node 22.18 or later (CI uses 24):

```bash
npm test   # node --test "tests/**/*.test.ts"
```

## Meal plan (`#/mealplan`)

The meal plan is pantry-api's `MealPlanDraft`, held in this browser; the
server computes its schedule, trips and freshness on every change and keeps
nothing. The logic is in pure modules under `src/mealplan/`:

| Module | What it holds |
|---|---|
| `dates.ts` | calendar dates as `YYYY-MM-DD`, arithmetic on whole days |
| `model.ts` | the plan's frame and the reducer for every edit; each edit bumps `rev`, and a server answer is used only for the rev it was computed from |
| `undo.ts` | 50 snapshots of undo, in memory |
| `persist.ts` | saving under `pantry.mealplan.v1` (a value it cannot read is kept under `pantry.mealplan.v1.backup`), JSON export and import |
| `consequences.ts` | what a move means for freshness, from the last answer; remedies as edits |
| `dnd.ts` | the drag gesture, hit-testing and the keyboard route |
| `selectionPreview.ts` | Quick add's chips: only exact and plural matches are accepted without asking |
| `board.ts` | what the views draw: cells, trip chips and lines, a trip as a cart card, the summary line, a Planner week as a plan |

`src/nutritionFormat.ts` words nutrition the same way everywhere: a complete
total is a number, a partial one "≥ N" with the missing lines in its title, a
missing one "unknown" (never 0), and every figure built from demo house amounts
carries the "demo amounts" badge.

The tab has three bands. **Pick** (`components/mealtray.tsx`): Quick add, each
recipe's count ("3 meals × 2 people"), slot and servings question, and the demo
starters, library and My recipes. **Place** (`components/mealcal.tsx`): 7 or 14
days of Breakfast, Lunch, Dinner and Snack, the nutrition band
(`components/nutrition.tsx`) and Suggest cook days. **Shop**
(`components/mealtrips.tsx`): the trips code suggests, each opened as a sheet
with its cart per store and Copy list / Print list, the warnings with their
fixes, and what the data covers. `views/MealPlanView.tsx` puts them together.
The Planner's week plan has "Open in Meal plan".

How a meal moves (all four end in one reducer edit):

| Way | How |
|---|---|
| Drag | the grip (the only element with `touch-action: none`, so the page still scrolls); a press that moves under 6 px is a tap |
| Tap | tap a meal, then a highlighted slot; the bar at the bottom has Back to tray and Cancel |
| Menu | ⋯ opens the Move sheet: every cell with its freshness preview, servings, the pin, the nutrition receipt |
| Keyboard | Enter or Space picks up; Tab reaches slot buttons named "Place X in Dinner, Fri 16 Oct"; arrows, Page Up/Down, Home and End move between them; Enter places; Escape cancels; Delete sends a meal back to the tray; Ctrl/Cmd+Z undoes |

Trips move the same ways along the Shop rows, while they are suggestions; an
approved trip stays put and shows "Changed since approved" with the diff when
edits change it. The tab works with only `/pantry/api` (no hub), so it runs on
the public demo and on AKS as well as in the local stack.

`src/myRecipes.ts` reads the shopper's own recipes: `pantry.recipes.v1` holds
`{v: 1, recipes: RecipeDoc[]}`, each keyed `my:<id>`. Recipe import's
`src/recipes.ts` (on `feat/recipe-import`) is the only writer of that key; the
meal plan never writes it. Recipes sent with "Add to meal plan" wait in
`pantry.mealplan.inbox.v1` (`{v: 1, entries: [{key, title, added_at}]}`); the
meal plan takes them when it loads, when another tab writes either key and when
the tab opens, adds each to the tray with one meal unless it is there already,
and empties the inbox. `src/mealplan/store.tsx` (`MealPlanProvider`, `useMealPlan`) wraps
the reducer with saving, the schedule call and the other `/mealplan/*`
requests in `api.ts`.

## Build the image

```bash
docker build -t pantry-frontend .
docker run --rm -p 8080:80 pantry-frontend   # /healthz works; api calls need the stack
```

## How it deploys

```
git push here
  → GitHub Actions: vite build → ghcr.io/pjvjay/pantry-frontend:dev-<sha>
  → CI bumps the image tag in pantry-gitops
  → ArgoCD rolls the Deployment on AKS
```

No kubectl from a laptop — the cluster only ever changes through
[pantry-gitops](https://github.com/pjvjay/pantry-gitops).
