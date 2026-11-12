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

"Import a recipe" (the Assistant's composer and the Workshop's Planner lab) reads a recipe
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

## Pages and addresses

Every page lives in the hash (`src/routes.ts`, pure and tested), so it can be
bookmarked, reloaded and reached with Back:

| Address | Page |
|---|---|
| `#/home` | Home (also an empty hash and any address the console does not know) |
| `#/plan?step=1..6` | the meal plan's six stages |
| `#/shop` | the shopping plan on its own (`#/shop/trip/<YYYY-MM-DD>`: one trip, for the shop itself) |
| `#/ask` | the Assistant |
| `#/workshop/<tab>` | the Workshop: `catalog` (the default), `provenance` (`?product=`), `mcp`, `simulations`, `metrics` (`?trace=`), `system`, `planner` (the Planner lab) and `about` |

The old addresses still work: `#/overview`, `#/mealplan` (with every query key,
`?step=`, `?calendar=` and `?reason=` included), `#/assistant`, `#/planner` and
`#/catalog`, `#/provenance`, `#/mcp`, `#/simulations`, `#/metrics`, `#/system`
(which move under `#/workshop/`). The shell rewrites an old address to its new
one in place (`history.replaceState`), so Back never lands on it.

The shell (`App.tsx`, `components/nav.tsx`, `styles/shell.css`) is the header (the
wordmark, the status of the services, the theme menu, the Workshop) and the four
places, Home, Plan, Shop and Ask: a row under the header from 900px, a bar fixed
to the bottom of a narrower screen, whose height is `--bottom-nav-h` (anything
fixed or sticky at the bottom keeps clear of it). The status asks pantry-api
every 15 s, and the demo hub once for the whole console (`src/hubStatus.tsx`:
on load, every 30 s, on window focus, and at once when a hub call fails as if
the hub were down); it reads "Ready", "Hub paused" (the hub refused: 401 or 403),
"Hub offline" (nothing answered), "API offline · retrying" or "Connecting…", and
opens into a line per service. A page that needs the hub shows one `OfflinePanel`
while it is off, saying what is off, what still works, Retry and Open System,
instead of a red banner per failed call. The shared pieces (`Notice`,
`OfflinePanel`, `EmptyState`, `Skeleton`, `Tag`, toasts with `useToast`) are in
`components/ui.tsx` and `styles/ui.css`.

## Meal plan (`#/plan`, and `#/shop`)

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
| `options.ts` | Options on a trip line or on an ingredient across the plan: the pins a choice makes (one edit), the dialog's words, the fix for a pin the schedule refuses |
| `chatDraft.ts` | the Assistant's meal-plan draft: the plan sent with each chat message (`meal_plan`, at most 64 KB), the card's strip and diff, and Apply as one undo step |
| `wizard.ts` | the six stages: the address (`#/mealplan?step=1..6`), the gates between stages, where a stage opens, the progress indicator, and Basics' origin rules |
| `catalog.ts` | the Meals stage: recipe cards by meal from `/mealplan/catalog`, the budget bar's arithmetic, a real total against the budget |
| `room.ts` | how many of each meal the plan's days hold (one breakfast, lunch and dinner and two snacks a day, for the meals planned), and why a recipe's + stops |
| `basket.ts` | the Ingredients stage: each recipe's ingredients from `/mealplan/basket`, and which ones no store nearby sells still need an answer |
| `basics.ts` | Basics: where the shopper is (areas, the device's location, the address search's words), the budget's picks and the "Your plan" summary |
| `stores.ts` | Ingredients' "Your stores": the distances, the stores near the shopper, and the warning when none is in range |
| `images.ts` | the pictures: which source a recipe's comes from (the shopper's own import first, then the one pantry-api names) and its credit, and the names a product's picture is asked by |
| `tiles.ts` | Web Mercator tile math for the stores map: points to tiles and pixels, the tiles a view needs, the zoom that fits the stores and the distance circle |

**From the Assistant.** Each chat message carries the plan in brief
(`chatDraft.contextOf`: window, meals, recipes, the dates of approved trips, the
lines of the shopper's own recipes). Counted dishes ("3 Pepperoni Pizza + 2
Chicken Fried Rice + 3 chicken briyani + 7 mango milkshakes in 2 weeks") come
back as a meal-plan card (`components/MealPlanCard.tsx`): the days as a strip,
what adding it changes, a misspelt or other name as a question with **Use** and
**Not this** (never placed until the shopper says Use), the suggested trips,
**Add to your plan** (one undo step; when the plan changed since the
draft, each change is tried in turn and a meal whose slot is taken waits for a
free one) and **Open your plan**. The Assistant stays mounted once opened,
so its conversation is there when the shopper comes back. Nothing in the chat
approves a trip.

`src/nutritionFormat.ts` words nutrition the same way everywhere: a complete
total is a number, a partial one "≥ N" with the missing lines in its title, a
missing one "unknown" (never 0), and every figure built from demo house amounts
carries the "demo amounts" badge.

The tab is a wizard of six stages under a progress indicator (a nav of links,
`aria-current="step"` on the stage shown; done, current and ahead, and a stage the
plan cannot be on yet says what it waits for), with Back and Next under each; Next
stays focusable when it cannot be used and says what stops it. The stage is in the
address, `#/plan?step=1..6`, so the browser's Back works and a reload comes
back to it; Google's `?calendar=` return lands on Calendar, and the Assistant's and
the Planner lab's "Open in your plan" on Place on days. On each change of stage focus moves
to its heading. `views/MealPlanView.tsx` puts them together:

1. **Basics** (`components/basics.tsx`): form cards (`components/fields.tsx`:
   segments, tiles, chips and switches over native inputs) for the start date
   and 1 or 2 weeks, the budget for the period with quick picks and its figure a
   day, the diet (any, pescatarian, vegetarian, vegan), what to avoid (dairy,
   gluten, nuts, soy, egg), the origin rules (United States products left out
   and Canada preferred by default, then an editable order of allies; a
   preference, never a whitelist), where the shopper is (an address searched
   through the hub's `/hub/geocode`, on Search only, never as one types; the
   device's location; or a Vancouver area), the shop days and the meals to plan,
   with a "Your plan" summary beside them on a wide screen. All saved in the
   plan, in this browser only. Every plan is for one person for now: a plan read
   back is set to one.
2. **Meals** (`components/mealcards.tsx`): recipe cards in Breakfast, Lunch and
   Dinner (Snack collapsed) from `/mealplan/catalog`, each with its picture
   (`components/pictures.tsx`: a Wikipedia article's through `/hub/images/wiki`,
   a page's through `/hub/images/remote`, an imported recipe's own
   `source.image_url`; decorative, lazy, 16:9, its credit on hover or focus, and
   the meal's icon on a soft tint when there is none or it fails), its diet, what
   one more meal adds to the plan's cost, what cannot be bought nearby (and
   whether only the origin rule stops it), and Add or a count. The selection is
   priced in whole packs, as trips buy it (`catalog.packCost`). A budget bar
   stays at the top while the page scrolls (budget, estimated spend, what is
   left, slots filled); an Add stops once every place for its meal is taken
   ("All 7 dinners this week are planned", counting every recipe's meals of
   it) or when it would pass the budget, saying by how much, and recipes that do not fit the diet are
   counted under "n hidden by your diet". Quick add, Import a recipe and My
   recipes are below. Next needs a meal.
3. **Ingredients** (`components/ingredients.tsx`): first "Your stores"
   (`components/stores.tsx`): how far the shopper goes, and the stores near them
   from `/mealplan/stores`, each with its address ("demo store" when they are the
   demo's own), distance, what it sells of the plan's products and a switch (a
   store turned off is skipped, kept in `settings.stores_off`, and never checks
   the products again). Beside them, while the hub serves tiles
   (`/hub/status` `tiles`), a map drawn with no library
   (`components/storemap.tsx`): OpenStreetMap's tiles from `/hub/tiles`, the
   shopper, each store (greyed when off), the distance as a circle, + and −;
   hovering or focusing a store's row lights its marker, and clicking a marker
   focuses its row. Then each recipe as a card with its picture, and its
   ingredients from `/mealplan/basket`, each a row with its product's picture
   (`/hub/images/ingredient`), product, store and distance, price, origin and
   labels, and the basket's total against the budget. The whole row is a button
   that opens the ingredient's Options across the whole plan (no trip); a choice
   pins every line that buys it. A row with no product opens them for its recipe
   line ("Options for X: nothing chosen yet", `/mealplan/alternatives` with
   `line`): what can be chosen, what is out of reach (`ranking.out_of_reach`,
   with where it is sold and the nearest offer: only at a store turned off, with
   Turn it back on; only beyond the distance, with Go up to the distance that
   takes it in; or stocked nowhere), what the origin rule holds back with its
   evidence, and when
   nothing can be chosen, the row's own answers. A row with no match is tinted, edged and
   labelled with what is wrong (`basket.lineIssue`), and one no
   store nearby sells needs an answer before Schedule: Back to meals, another
   product, Skip this ingredient (kept with the plan as `skipped`), or, when only
   stores turned off sell it, turning one back on.
4. **Schedule** (`components/mealcal.tsx`, the tray from `components/mealtray.tsx`),
   laid out as a sprint board: the plan's recipes in a sidebar card (each with
   its picture, how many of its meals are placed, its count and meal, and the
   meals still to place as cards to drag), the calendar in a card beside it, both
   in view from 1024 px, the sidebar staying put while the board scrolls; on a
   phone the sidebar sits above the board and folds away. The whole sidebar is
   the tray's drop target. 7 or 14 days of Breakfast, Lunch, Dinner and Snack,
   each meal's card with its recipe's thumbnail, Fill empty slots, Suggest cook
   days, Undo and Redo, and the nutrition band (`components/nutrition.tsx`).
5. **Shopping plan** (`components/mealtrips.tsx`): a week strip of the plan's days,
   each trip draggable (or picked up with Move) to another day and each day's
   meal count, the strategy's total against the budget, the trips code suggests
   (each with "Move to…"), each opened as a sheet with its cart per store
   and Copy list / Print list, the warnings with their fixes (over_budget among
   them), and what the data covers. Next needs an approved trip.
6. **Calendar** (`components/CalendarExport.tsx`): trip and cook times and the
   reminders on each kind of event, the events, the `.ics` and Google Calendar.

The Planner lab's week plan has "Open in your plan".

How a meal moves (all four end in one reducer edit):

| Way | How |
|---|---|
| Drag | the grip (the only element with `touch-action: none`, so the page still scrolls); a press that moves under 6 px is a tap |
| Tap | tap a meal, then a highlighted slot; the bar at the bottom has Back to tray and Cancel |
| Menu | ⋯ opens the Move sheet: every cell with its freshness preview, servings, the pin, the nutrition receipt |
| Keyboard | Enter or Space picks up; Tab reaches slot buttons named "Place X in Dinner, Fri 16 Oct"; arrows, Page Up/Down, Home and End move between them, starting from the held meal itself; Enter places; Escape cancels; Delete sends a meal back to the tray; Ctrl/Cmd+Z undoes |

Trips move the same ways along the Shop rows, while they are suggestions; an
approved trip stays put and shows "Changed since approved" with the diff when
edits change it. An approval belongs to the strategy it was given under, as the
engine reads it: after switching strategy that day reads "Approved under Shop
fresh" (say), with Take the approval back, and approving the other strategy's
list replaces the approval only when asked; a plan keeps one approval a day.
The meal plan works with only `/pantry/api` (no hub), so it runs on the public demo
and on AKS as well as in the local stack. `#/shop` is the same view in "shop" mode
(`MealPlanView mode="shop"`): stage 5 with no stepper, its heading beside "Back
to planning", and, while a stage before it is blocked, what it waits for and a
button to that stage.

The plan is saved in this browser only (`pantry.mealplan.v1`): a private
window, cleared site data or another device starts empty, so Basics and Calendar
have Export and Import (.json). A plan saved before the wizard (no budget, diet,
avoid-tags or skipped lines) loads as no budget, any diet and nothing avoided. A saved plan this console cannot read is kept under
`pantry.mealplan.v1.backup` and a new plan starts, with a banner saying so.
Print list prints only the trip's list: the button adds `mp-printing` to the
page, and the `@media print` rules hide everything but that list. Printing the
page any other way prints the page.

**Options on a trip line.** Every line of a trip sheet has Options, the chat
cart's dialog (`components/alternatives.tsx`) opened by
`components/tripoptions.tsx` with pantry-api's `/mealplan/alternatives` (REST, no
hub): the products that could take the line's place, ranked for every recipe line
the purchase covers, each with what it costs on this trip and what it does to the
plan's total, unknowns shown as unknown and the demo-data note. The header names
the recipe and line. "Use this" pins the product on each of those lines as one
edit (Undo puts it back); the plan as it would be is scheduled first with no model
call, so a choice pantry-api refuses says why and changes nothing, and otherwise
that answer is shown at once and focus goes to the trip line that now buys it. An
approved trip whose products change reads "Changed since approved". The
`open_options` remedy of a warning (a product no longer stocked, for one) opens
the trip sheet with that line's Options. A pin the schedule later refuses (its
product since held back by the plan's origin rules, or no longer sold in range)
gets "Use the planner's product for that line" beside the error.

**Matched by meaning.** pantry-api matches a line's products by meaning, and
Options (the chat cart's, a trip line's and an ingredient's alike) shows its rows
under its groups: Same item, Works instead and Looser match (its own
`group_label` when it gives one), each row with its reasons on one line
(`summary`: "butter · 454 g covers 80 g · no new allergens"). What a hard rule
keeps out (`filtered`: it adds an allergen, breaks the diet, or is outside the
plan's rules) is a closed "Not offered (n)" list, each with its picture and why.
A note under the heading says "Matched by meaning", or "Matched by words: the
meaning model is off" with pantry's reason. An older pantry's rows, which have no
group, are under "Same ingredient" and "Not the same ingredient" as before
(`alternatives.rowGroups`).

**Calendar** (the last stage, `components/CalendarExport.tsx`) posts the
answer's `approved_schedule` back to pantry-api's `/calendar/preview` and
`/calendar/ics`, which build every event: shopping trips with their lists, cook
days with ingredients and nutrition, and cited freeze and thaw reminders. With
them goes `timing`: trips and cooks at a time in the browser's time zone (trips
10:00 for an hour, reminded an hour and the evening before; cooks at a time for
each meal slot the plan has, breakfast 07:30, lunch 12:00, snack 15:00 and dinner
17:30, sent as `cooks.by_slot`, reminded 30 minutes before) or all day, and each
kind's reminders, chosen in words and sent as minutes. The choices are kept in `pantry.mealplan.calendar.v1`. The stage
previews the events by day with their times and reminders, downloads the `.ics`,
and offers one Google add-event link per event; there is no account and no
sign-in. Nothing in the browser writes ICS or converts a date: `src/calendar.ts`
only shapes the request, reads the preview and accepts a link only when it opens
Google Calendar's add-event page. An export waits while an approved trip needs
review.

**Google Calendar** (on the same stage, `components/CalendarSyncPanel.tsx`,
only with the local demo hub and an OAuth client the user made; demo-hub
`docs/google-calendar.md`): Connect opens Google's consent page from the
`auth_url` the hub returns, and Google sends the shopper back to
`#/plan?calendar=connected`, which opens the Calendar stage (a hub given the old
`#/mealplan` return address still lands there: the shell rewrites it). The times and
reminders go with every review and sync, so changing them shows as an edit. Review changes shows
the hub's diff for a calendar named Pantry plan, grouped Add, Change, Remove,
Edited in Google (Keep chosen, or Overwrite), Deleted in Google (Restore only
when ticked) and Past; the button says what it will write ("Add 2, change 1 and
remove 1 in Pantry plan"), and each row then shows its result, with Retry
failed. Disconnect revokes, optionally deleting the calendar. The wording and
grouping are in the pure `src/calendarSync.ts`. Without a hub, or with no client,
the section is not drawn.

Device check so far: Chrome on a desktop (mouse drag of meals and trips, tap
then tap, the Move sheet, the keyboard route, a 375 px phone width, light and
dark). The wizard's six stages were checked at desktop width and 375 px (no
sideways scroll on any stage) against canned answers in the API contract's shape. Not yet checked: touch drag on iOS Safari, Android Chrome and Samsung
Internet, VoiceOver and TalkBack, forced colours and 200% zoom.

Focus, checked with `document.activeElement` in Chrome at a 279 px width: Escape
or Cancel on a held meal returns focus to that meal's chip, and on a held trip
to that trip's chip; Delete on a placed meal keeps focus on it in the tray;
typing and saving a setting afterwards leaves focus in the field. Repeat this
check on each browser above.

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

## Ask (`#/ask`)

The Assistant runs on the demo hub: each question is one `POST /hub/agent/chat`
whose answer streams back as events (`hub.ts` `agentChat`). `src/transcript.ts`
(pure; `tests/transcript.test.ts`, with two recorded runs in
`tests/fixtures/ask-run-*.json`) folds a question's events into one run: its
steps (observers choosing tools, model calls, tool calls with their results, a
recipe read from a link, dishes read in code), what it is doing now, how long it
took, a thinking model's reasoning, the answer, and what stopped it when
something did. It also holds the words: each step's name and one-line summary,
the run's line, the starters and the follow-ups.

The page (`views/AssistantView.tsx`, `components/assistant/*`, `styles/ask.css`)
draws each run as one line between the question and the answer: "Planned in 6
steps · 19 s", or while it works "Planning the shopping · 12 s" beside a slowly
turning ring (still under reduced motion). It opens into the steps
(`RunTimeline.tsx`, `StepRow.tsx`: each with its arguments and result as JSON),
the model and server, the answer's checks and Run details (Workshop › Metrics).
Reasoning is open while it comes and closes as "Thought for 4 s" when the answer
starts. Two or three questions to ask next follow the newest answer; six
starters come before the first. The message box sticks above the bottom bar,
grows with what is typed (Enter sends, Shift+Enter is a new line) and turns
Send into Stop while an answer comes; the model, MCP server and toolset are
under Settings. The page follows a reply only while the reader is within 80px
of its end, and otherwise offers "New reply". Home's Ask box hands its text over
in sessionStorage `pantry.ask.prefill`: the page puts it in the box (never
sends it), focuses the box and removes the key. While the hub is refusing or not
there, one `OfflinePanel` says so and the starters and Send wait.

## Workshop (`#/workshop/<tab>`)

The tools under the hood (`views/WorkshopView.tsx` and the views it holds,
`styles/workshop.css`). Their small decisions are in the pure module
`src/workshop.ts` (`tests/workshop.test.ts`): which row or tab a key moves to, a
product's price per 100 g, the words and tag of each state, the waterfall's legend.

- The Catalog and Metrics' Recent turns are grids of rows the keyboard walks
  (`components/useRowNav.ts`): one Tab stop, Up and Down, Home and End, Page Up and
  Down, Enter opens the row. A table's head stays in view while its rows scroll, and
  figures sit right-aligned in equal widths; the Catalog also prices each product per
  100 g and shows its picture (a quiet placeholder when there is none). Under 900px a
  product opens in a sheet over the table. Recent turns are newest first, by when each
  began; on a phone they keep the question, its state and its time.
- While the mcp-sim runner is not running, Simulations says so calmly, with how to start
  it (`scripts/up.sh`), rather than as an error.
- A run opens in a drawer over Metrics (`views/RunView.tsx`, the drawer preset of
  `components/Sheet.tsx`) whose header stays in view: the way back, the question, its
  model and state, the raw JSON, even when the run cannot be read.
  `#/workshop/metrics?trace=<id>` opens it from anywhere (the Assistant's Run details);
  Back closes it, and closing a drawer that came in by its address leaves Metrics' own
  address in its place. The waterfall has a legend in the chart colours and folds the
  browser's spans away when there are many.
- "Run all" (Simulations) and "Reset demo data" (System) ask first, in place
  (`components/InlineConfirm.tsx`, also behind the Planner lab's "Open in your plan"):
  Escape or Cancel puts the button back, with focus. Reset demo data reseeds the whole
  database, so it lives in System now; Provenance points there.
- The Catalog's "Submit a label reading" lands in Provenance's Submit panel: scrolled
  into view, the product field focused with the product chosen.
- States are tags (`Tag` in `components/ui.tsx`): an origin, a reading in the review
  queue, a simulation, a run. Origin evidence and readings are cards
  (`components/evidence.tsx`): the claim and the place, the label's words in quotes, a
  confidence band, the source, who saw or reviewed it and when.
- The MCP explorer's tools, resources and prompts are a tab list (`components/Tabs.tsx`):
  the arrow keys move along it and go round, Home and End go to either end.

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
