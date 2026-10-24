# Demo script (75–90 seconds)

**Setup before going on:** app open on the sample apartment, the request text in your clipboard,
the smoke test passing against the deployed URL, and the backup recording ready to play.

| Time | Say | Do |
|---|---|---|
| 0–10 s | "Most people only discover accessibility barriers after moving in, or after paying for a consultation." | Show the sample two-bedroom plan in 2D. |
| 10–25 s | "A resident describes what they need in plain language." | Paste: *Make it easier to move between the bedroom, bathroom, and kitchen using a mobility device, with a $12,000 budget.* Gemma 4 returns draft goals. |
| 25–40 s | "Gemma's output is only a draft. The user confirms it, then deterministic geometry measures the plan." | Confirm goals → Validate. Point at the red **Fails**: bedroom door 800 mm vs 900 mm, route to kitchen 649 mm. |
| 40–60 s | "ADAPT only applies edits it's allowed to make, then re-checks every one." | Generate. Before/after updates in 2D **and** 3D: door widened to 920 mm, cabinet moved. |
| 60–75 s | "Every modeled check now passes. Costs are illustrative ranges from a fixed table, not AI guesses." | Show the before/after table (all **Passes**), cost worksheet within budget, "Needs professional review" tag. |
| 75–90 s | "And when it *can't* help, it says so." | Run the 5,000 mm request: "No permitted change was found", findings stay **Fails**. Mention the open-source repo, Gemma 4, Cloud Run + Firebase. |

## Talking points if judges ask

- **Why not let the AI do the geometry?** LLMs can't be trusted to measure. Gemma interprets intent, and code does the measuring.
- **What's unknown vs fail?** Unknown means we don't have a real measurement. We never round it up to a pass.
- **Compliance?** We don't claim it. Targets are user-set, and anything structural is flagged for professional review.
- **Google Cloud:** Firebase Hosting → Cloud Run API → Cloud Run geometry, Gemini key in Secret Manager.

## Backup

- A recording of a real run against the deployed app, made before the credits expired at 10:15 PM.
- The local three-terminal setup from the README.
- If live AI is down, enter goals manually and **say so**. Never present the recording as live.
