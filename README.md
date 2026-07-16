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
git push here
  → GitHub Actions: vite build → ghcr.io/pjvjay/pantry-frontend:dev-<sha>
  → CI bumps the image tag in pantry-gitops
  → ArgoCD rolls the Deployment on AKS
```

No kubectl from a laptop — the cluster only ever changes through
[pantry-gitops](https://github.com/pjvjay/pantry-gitops).
