# Bonafide

Judge the dog, not the label.

## Inspiration

Shelters still introduce dogs by breed, and families still get turned away from housing for the same reason. A label says nothing about the dog in the kennel. Bonafide scores what the video shows — energy, stress, approachability, confidence — and matches the whole shelter to waiting families at once.

## What it does

Staff open a dashboard, run one whole-shelter match, and see every pairing with a fit score and a plain-language reason. Dogs who are not ready for any current family land in "Needs behavior team / experienced foster," with the reason shown. Dogs who simply ran out of open families land in "Waiting for the right family." Families chat through an intake that never asks about breed. Each dog has a public behavior passport, and a bias test asks a general model about the same dog twice under two hypothetical labels to show that Bonafide's own scores do not move.

## How we built it

Next.js 16 (App Router, Turbopack) in `/app`. The teammate's video pipeline writes dog documents into MongoDB; this app only reads them through `normalizeDog()`. Matching is the Hungarian algorithm in `src/lib/match.ts`. Gemini runs intake, "ask about this dog," passport summaries, and the bias test, with Supermemory holding volunteer notes. TinyFish collected pet-friendly rentals once. Bedrock, Cognito, and Tiger Data are wired with fallbacks when their keys are empty. A Demo mode toggle preloads the pages before a live demo.

## How we used MongoDB Atlas

Database `bonafide` stores `dogs`, `families`, `matches`, `passports`, `rentals`, and `bias_tests`. The client is cached on `globalThis` (`src/lib/db.ts`). Dogs are normalized on every read. Families are upserted by `family_id` so seeding never overwrites pipeline dogs. Bias-test results are cached by dog and input hash.

## How we used Gemini

`src/lib/gemini.ts` calls the Google GenAI SDK (default model `gemini-3.6-flash`) for intake, answers grounded in notes, passport summaries, and the paired bias-test prompts at temperature 0. Calls set a timeout and the SDK's own retries. If Bedrock is not configured, passport text falls back to Gemini.

## How we used Supermemory

`src/lib/memory.ts` writes each volunteer note with `POST /v3/documents` and retrieves it with `POST /v4/search` (`searchMode: "hybrid"`), tagged per dog. "Ask about this dog" answers only from those notes.

## How we used TinyFish

`scripts/rentals.ts` runs the TinyFish agent against a pet-friendly listings page, keeps listings whose policy does not restrict by label, and stores them on Max's passport.

## How we used AWS

Cognito (Amplify Authenticator) is the sign-in path when `NEXT_PUBLIC_USER_POOL_ID` and `NEXT_PUBLIC_USER_POOL_CLIENT_ID` are set; otherwise the UI uses a demo Staff / Vet / Family switcher. Amazon Bedrock (`ConverseCommand` in `src/lib/bedrock.ts`) is the passport writer when its four variables are set, and falls back to Gemini otherwise. `amplify.yml` builds the Next.js app from the `app` directory.

## How we used Tiger Data

`/api/trend/[dogId]` queries Postgres on `TIGER_URL` for daily stress and energy. When the URL is empty, the dog page shows a clearly labeled sample trend.

## How we used Cursor + Grok

The app was built in Cursor. `scripts/grok-bot.ts` asks xAI's chat-completions API (`XAI_MODEL`) for a short "ready for adoption today" post for each Green or Yellow dog whose trend is improving, then sends it to a Discord webhook. It skips when the keys are missing and refuses a post that mentions breed or uses a banned word.

## Challenges

Gemini's free tier is five requests a minute, and newer model names returned 404 or 503, so the default is `gemini-3.6-flash` and bias tests are cached. Supermemory search returned nothing until `searchMode` was set to hybrid. Next.js 16 cache components required Suspense around `usePathname`. With real pipeline dogs in the collection, the seed script had to stop wiping `dogs`. Two dogs share the name Luna, so the UI appends the id suffix.

## Accomplishments

One match considers every dog and family together. The latest run paired ten dogs and left Duke, approachability 25, in the behavior-team lane with a written reason. The bias test shows two different model writeups against identical behavior scores. Empty keys degrade to a fallback instead of crashing, and `/api/health` reports reachability without returning secrets.

## What's next

Server-side checks on the API routes, Cognito once a user pool exists, Tiger Data once trend rows are loaded, and Bedrock as the primary passport writer. Rentals for dogs other than Max. The Grok bot on a schedule once `XAI_API_KEY`, `XAI_MODEL`, and `DISCORD_WEBHOOK_URL` are set.
