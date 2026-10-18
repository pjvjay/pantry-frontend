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

## Build the image

```bash
docker build -t pantry-frontend .
docker run --rm -p 8080:80 pantry-frontend   # /healthz works; api calls need the stack
```

## How it deploys

```
merge a labelled PR to main
  → GitHub Actions (build.yml): plan vX.Y.Z from the release labels
  → vite build → ghcr.io/pjvjay/pantry-frontend:dev-<sha>, version baked in
  → git tag vX.Y.Z → the same digest retagged X.Y.Z, X.Y, latest → GitHub Release
  → CI sets X.Y.Z in pantry-gitops
  → ArgoCD rolls the Deployment on AKS
```

Every PR carries one release label (`release:major`, `minor`, `patch` or
`none`), checked by `labels.yml`; `.github/versioning.json` says which paths
ship. The process, the 0.x policy, rollback (`promote_version`) and the
platform release train are in
[RELEASING.md](https://github.com/pjvjay/pantry-platform/blob/main/RELEASING.md).

The header's version chip shows this console's release and the API's; the
build also serves it as `/pantry/version.json`. A dev server or a plain
`docker build` says `unknown` (pass `--build-arg APP_VERSION=...` to see a
number). `package.json`'s `0.0.0` is a placeholder.

No kubectl from a laptop — the cluster only ever changes through
[pantry-gitops](https://github.com/pjvjay/pantry-gitops).
