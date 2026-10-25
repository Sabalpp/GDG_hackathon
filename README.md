# ADAPT concept planner

ADAPT is a sample home-accessibility planning workspace. It compares a calibrated layout with a concept proposal in 2D and 3D, then reports what the model measured and what remains unknown. It does not determine code compliance, structural safety, medical suitability, construction feasibility, or contractor pricing.

## Run the frontend

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. With no `VITE_API_BASE_URL`, the app runs in labeled local sample mode: manual goals, a deterministic sample doorway check, and a bounded concept edit. AI interpretation and path/route measurement remain unavailable.

## Connect the API

In a second terminal:

```sh
npm --prefix apps/api install
npm --prefix apps/api run dev
```

Create `.env.local` in the repository root with:

```env
VITE_API_BASE_URL=http://localhost:3001
```

Restart Vite after changing the environment variable. The frontend sends interpretation requests to `/api/v1/requirements/interpret`, checks to `/api/v1/layouts/validate`, and proposals to `/api/v1/proposals/generate`. The frontend always loads the calibrated sample from `src/data/sampleLayout.ts`. Set `GEMINI_API_KEY` in `apps/api/.env` for AI interpretation; without it, the interpretation request reports an error and users can enter measurable goals manually. The backend still handles validation and proposal generation.

The interpretation endpoint returns draft themes, not millimeter targets. Users must enter and confirm measurable goals before validation or proposal generation. See [API.md](apps/api/API.md) for endpoint details.

## Verify

```sh
npm test
npm run build
npm --prefix apps/api test
```

The main workspace follows `reference/02-3d-workspace-mobile.html`. Its 3D renderer reads the same canonical millimeter `Layout` as the 2D plan and does not use the reference's hardcoded apartment as proposal data.
