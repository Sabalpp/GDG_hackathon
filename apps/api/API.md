# Requirements interpretation

Run `npm run dev` from `apps/api`. Copy `.env.example` to `.env` and set
`GEMINI_API_KEY` to an AI Studio key with access to `gemma-4-26b-a4b-it`.
Keep `.env` on the server; it is ignored by Git. Restart after changing it.

```sh
curl -i http://localhost:3001/api/v1/requirements/interpret \
  -H 'Content-Type: application/json' \
  -d '{"text":"I use a wheelchair and have trouble getting into my bathroom."}'
```

Request: `{ "text": "..." }`, with 1–8000 nonblank characters and no extra fields.
Schemas and exported TypeScript types live in `src/schemas/requirements.ts`.
There were no pre-existing shared contracts in this repository.

Successful response (model selections vary):

```json
{
  "status": "draft",
  "goals": [
    {
      "category": "bathroom_access",
      "priority": "high",
      "room": "bathroom",
      "description": "Explore more accessible bathroom use."
    }
  ],
  "questions": ["Can you provide verified room, doorway, and mobility-device measurements?"],
  "warnings": [
    "These are draft goals for review, not a construction plan.",
    "Measurements have not been verified. No dimensions are inferred or prescribed.",
    "Building-code compliance has not been assessed. Review proposed changes with a qualified local professional."
  ]
}
```

The model selects categories, priorities, rooms, and missing-information codes.
Zod rejects any extra fields, unsupported selections, or malformed JSON. All
returned prose comes from server-owned templates; no model-generated dimensions
or compliance assertions are returned. Measurements always require confirmation.
Goal relevance remains a model inference for user review; these are not geometry
results or verified design recommendations. This endpoint does not call FastAPI.

Errors use `{ "error": { "code": "...", "message": "..." } }`:
400 invalid input/JSON, 413 oversized body, 415 wrong content type,
503 missing server key, 502 provider failure or invalid model output.
Provider requests have a 30-second timeout and no automatic retries.
User text is sent to Google for interpretation; it is not logged by this backend.

Run `npm test` for HTTP integration tests with an injected model boundary (no
credentials or paid requests), and `npx tsc --noEmit` for type checking.
A live successful generation requires a configured API key and model access.
