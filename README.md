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
doc into the chat (`recipe_doc`) in the Assistant, and to `POST /plan/spec`
otherwise. A link pasted in chat is read by the hub before the model starts;
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
