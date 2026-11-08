<!--
Title: sentence case, saying what changed ("Planner: keep the store filter across tabs").
The process behind every section below is in RELEASING.md at the root of pjvjay/pantry-platform.
-->

## What and why

<!-- What changes for whoever uses this, and why. Link the issue or plan section. -->

## Release label

Add exactly one label; the release-label check reads it (RELEASING.md, "Labels"):

- [ ] `release:major`: breaks something already in use. For pantry-frontend: removing a tab or a hash route people bookmark (`#/planner`, `#/mealplan`); changing a browser storage key or format (`pantry.mealplan.v1`, `pantry.recipes.v1`) without migrating saved data; requiring a pantry-api version that is not deployed. Below 1.0.0 it bumps the minor, and the notes open with "Breaking".
- [ ] `release:minor`: new behaviour that nothing already using it notices (a tab, a view, a card, an action).
- [ ] `release:patch`: a fix or internal change to something that ships (`src/`, `index.html`, `nginx.conf`, the build config, dependencies).
- [ ] `release:none`: changes nothing that ships (README, tests, CI).

A PR that lands stacked PRs on main names them here, so its label is at least theirs:

Lands: <!-- e.g. #12, #13; leave empty when this PR carries no other PR -->

## Data sources

- [ ] No new data source, or each new one is listed here with its licence, size and who approved the download.
- [ ] Every price, store, origin, freshness time and nutrition value shown comes from a tool result or a cited row, or is shown as unknown.
- [ ] Synthetic data (store prices, stock, reviews, starter recipes, house amounts) is labelled as such on screen.
- [ ] No key, token or personal data is committed, logged, stored in the browser or put in a URL.

## Live smoke

Run against `demo-hub/scripts/up.sh` in DEMO_MODE in a real browser; record pass or fail per step and attach a screenshot of the final state. Write "Not applicable: <reason>" when nothing a person sees changed.

1.
2.
3.

Result:

## Tests

<!-- The commands run and their results, e.g. `npx tsc --noEmit` clean; `npm run build` ok. -->
