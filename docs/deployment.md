# Deployment (Dev D)

| Piece | Service | Notes |
|---|---|---|
| Frontend | Firebase Hosting | `apps/web/dist`, built with `VITE_API_BASE_URL=/api/v1` |
| API | Cloud Run `adapt-api` | Reached through the Hosting rewrite `/api/** → adapt-api`, so the browser stays same-origin |
| Geometry | Cloud Run `adapt-geometry` | Called only by the API, via `GEOMETRY_BASE_URL` |
| Gemini key | Secret Manager `gemini-api-key` | Injected as `GEMINI_API_KEY`; never in the repo or the browser |

Region: `us-central1`. Both Cloud Run services run with `--max-instances 2` to cap spend.

## One-time setup

1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and log in:
   `gcloud auth login`
2. Create the project and link it to the hackathon billing account (credits, no card).
3. Set a budget alert at $10–20 under Billing → Budgets & alerts.
4. Add teammates in IAM as Editor.
5. Add Firebase to the same project at <https://console.firebase.google.com>, then
   `npx firebase-tools login`.
6. Put the project ID in [`.firebaserc`](../.firebaserc).
7. Store the Gemini key (from <https://aistudio.google.com>):

   ```powershell
   gcloud secrets create gemini-api-key --data-file=-
   ```

   Paste the key, press Enter, then Ctrl+Z and Enter (Windows) or Ctrl+D (mac/Linux).

## Deploy

```powershell
.\scripts\deploy.ps1 -ProjectId <your-project-id>
```

The script builds images with Cloud Build ([`cloudbuild.yaml`](../cloudbuild.yaml)), deploys geometry,
then the API and web **if their folders exist yet**. So it's safe to run at hour 1 to prove the pipeline.
It prints the smoke-test command for the deployed URLs at the end.

## Contract with Dev B (API container)

[`apps/api/Dockerfile`](../apps/api/Dockerfile) builds from the repo root and expects:

- `apps/api/package.json` with `"build"` (compile to `dist/`) and `"start"` (e.g. `node dist/index.js`)
- the server to listen on `process.env.PORT` (Cloud Run sets 8080)
- CORS to allow `WEB_ORIGIN` (local dev only, because production is same-origin through the Hosting rewrite)
- the cost catalog to be read from `${ADAPT_DATA_DIR}/sample-cost-catalog.json`. The image sets
  `ADAPT_DATA_DIR=/workspace/data`. Locally, fall back to the repo's `data/` folder resolved from the
  source file, not from `process.cwd()`, because `npm start --workspace` runs inside `apps/api`.

## Credits expiry fallback

The hackathon credits end at 10:15 PM on Oct 24, 2026. Before then:

- Record the full demo against the deployed URLs.
- Confirm the local three-terminal setup in the README works on the presenting laptop.
- If Cloud Run stops, Firebase Hosting static files still load, but `/api` calls will fail.
  Present locally instead and say so; don't present a recording as live.
