# Team integration checklist (from Dev D)

What each of us needs to do so the pieces plug together and deploy. Status as of Oct 24, ~2:30 PM.

## Everyone

- **Run `npm install` from the repo root, not inside an app folder.** The root `package.json` is an npm
  workspace (`apps/*`, `packages/*`), so one install covers everything. Run app scripts with
  `npm run dev --workspace apps/api` (or `apps/web`).
- **One base path:** `/api/v1`. **One unit:** millimeters. **One layout:** `Proposal.resultLayout`.
- **Use the shared fixtures in `data/`** (`sample-layout.json`, `sample-goals.json`, `sample-proposal-request.json`,
  `impossible-request.json`, `sample-cost-catalog.json`). Don't make private copies; they'll drift.
- **Never put the Gemini key in `apps/web`** or any `VITE_*` variable. CI scans the built site for keys and fails the build.
- **Before you open a PR, run the smoke test** against your local stack (see the README's Test section):
  `npm run smoke:geometry`, or, once Express proxies everything, `npm run smoke -- --express`.
- **Small PRs into `main`.** CI (`.github/workflows/ci.yml`) builds web and api and runs the demo-path test.

## Dev C (geometry)

- [ ] **Merge `feat/geometry` into `main`.** My branch is built on it, so my PR also contains your commit until you merge.
- Nothing else needed. Your Dockerfile already works on Cloud Run (tested with `PORT=8080`), and the smoke test passes 9/9 against it.

## Dev B (API)

Already done on `feat/deployment`: added `"build": "tsc"` and `"start": "node dist/index.js"` to
`apps/api/package.json`. The container builds, listens on Cloud Run's `PORT`, and `/health` works. Please don't remove those scripts.

Endpoints still needed (in priority order):

1. [ ] **`/requirements/interpret` must return spec-shaped goals**, or nothing downstream can use them. The geometry
   service only accepts:
   ```json
   { "id": "goal-1", "type": "minimum-door-width | minimum-path-width | reachable-route",
     "targetMm": 900, "fromRoomId": "bedroom", "toRoomId": "bathroom", "status": "draft" }
   ```
   Suggestion: keep your no-invented-numbers rule. Let Gemma pick only `type` and the room IDs (give it the room IDs
   from the layout), and fill `targetMm` from a server default of 900 that the user edits. Also accept
   `{ description, layout }` as the spec says (keep `text` as an alias if Dev A already uses it). Include `"model": "gemma-4-26b-a4b-it"`
   in the response so the report can show it.
2. [ ] **Pass-through to geometry:** `GET /samples/:id`, `POST /layouts/validate`, `POST /proposals/generate`
   → `${GEOMETRY_BASE_URL}` with the same path. Copy the `callGeometry` snippet in `docs/geometry-integration.md`.
   On a timeout or connection error, return **503 `GEOMETRY_UNAVAILABLE`**, never fake findings.
3. [ ] **Attach costs** to each proposal from `data/sample-cost-catalog.json` (look up by `modification.type`;
   `status: "illustrative"`). `packages/report-ui/src/costs.ts` → `costLinesFromCatalog()` has the exact logic if you want to copy it.
   Read the file via `process.env.ADAPT_DATA_DIR` (set to `/workspace/data` in the Docker image), falling back to the
   repo's `data/` resolved from the source file. `process.cwd()` is `apps/api` under npm workspaces.
4. [ ] **`GET /catalog/costs`** → `{ items, updatedAt, limitations }`, straight from that JSON.
5. [ ] **Raise the JSON limit to `1mb`.** Proposal requests carry a whole layout (32 kb is tight).
6. [ ] **CORS for local dev only:** `cors({ origin: process.env.WEB_ORIGIN })`. In production the browser calls the
   same origin through Firebase, so CORS isn't involved.
7. [ ] Local port: your default is 3001, but `.env.example` and the web app assume **8080**. Set `PORT=8080` in your `.env`
   (Cloud Run sets 8080 itself).

Env vars the deployed API receives (set by `scripts/deploy.ps1`): `PORT`, `NODE_ENV`, `GEMINI_API_KEY` (from Secret
Manager), `GEMMA_MODEL`, `GEOMETRY_BASE_URL`, `WEB_ORIGIN`, `PROJECT_STORE`, `ADAPT_DATA_DIR`.

## Dev A (web)

- [ ] Scaffold with `npm create vite@latest apps/web -- --template react-ts`, then run `npm install` **from the root**.
- [ ] Use **`import.meta.env.VITE_API_BASE_URL`** for every call. Locally it's `http://localhost:8080/api/v1`; in production
  the deploy script builds with `/api/v1`. Don't hardcode hosts.
- [ ] **Use my report panels** instead of building your own findings, cost, or report UI:
  ```tsx
  import { AdaptReport, FindingsPanel } from '@adapt/report-ui';
  import '@adapt/report-ui/styles.css';
  ```
  Add `"@adapt/report-ui": "*"` to `apps/web/package.json` dependencies and run `npm install` from the root.
  - `<FindingsPanel findings goals layout status onSelectElement selectedElementId />`, where
    `status` is `'loading' | 'ready' | 'unavailable'`. Pass `'unavailable'` when the API returns 503, and it will show no passes.
  - `onSelectElement(id)` fires when a user clicks or presses Enter on an element chip. Highlight that ID in your 2D/3D views.
  - `<AdaptReport proposal goals originalLayout budget description model onSelectElement />` is the full printable report.
  - Run `npm run dev --workspace @adapt/report-ui` to see all three scenarios with real data.
- [ ] Render 2D and 3D from the **same** `proposal.resultLayout`. Never apply modifications yourself.
- [ ] Goals from Gemma arrive as `draft`. The user must confirm them (set `status: "confirmed"`) before you call
  validate or generate. The geometry service returns 422 for drafts.
- [ ] `npm run build --workspace apps/web` must produce `apps/web/dist`, which is what Firebase Hosting serves.

## Dev D (me), next

- Deploy the geometry service now to prove the pipeline, then redeploy as the API and web land:
  `.\scripts\deploy.ps1 -ProjectId <id>`.
- Run `npm run smoke -- --express --base-url https://<api-url>/api/v1` after each deploy.
- Record the backup demo before the credits expire at 10:15 PM.
