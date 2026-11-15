# Bone-a-find

**Behavior intelligence for animal shelters. Replacing labels with evidence.**

[Live app](https://bone-a-find.us) · [Pipeline API health](https://api.bone-a-find.us/health)

---

## Have you ever wondered what happens to a dog that gets returned?

A family adopts a dog. Everyone is excited. A few weeks later, the energy is too much for their apartment, or the dog doesn't get along with the cat, and the dog goes back to the shelter.

Nobody did anything wrong. The family and the dog were just never a good fit, and nobody could see it in a short shelter visit.

For the dog, it means losing a home, going back into a loud kennel and starting over. For the family, it often means giving up on adopting at all.

Meet Lola. She doesn't know what a computer vision model is. She just knows she's waiting for someone who actually fits her.

## The problem

- **Behavior mismatch is the top reason dogs come back.** In a study of about 24,000 adoption records, behavioral issues and incompatibility with existing pets were the most common return reasons, and dogs were the most returned species ([Powell et al., 2021](https://doi.org/10.1038/s41598-021-87649-2)). About 35% of returns were for behavioral incompatibility and another 18% because the dog didn't get along with pets at home ([AAWA summary of that research](https://theaawa.org/?p=13795)).
- **A return hurts the dog.** Dogs returned for behavior issues were more likely to be euthanized after coming back ([Powell et al., 2021](https://doi.org/10.1038/s41598-021-87649-2)).
- **A return hurts the family too.** Only about 1 in 10 people who returned a pet adopted again within a year, and behavioral returns made adopting again less likely ([Powell et al., 2022](https://doi.org/10.1038/s41598-022-05101-5)).
- **Matching is based on very little.** Shelters usually go on a short visit, a questionnaire and a guessed breed label. The ASPCA and follow-up research caution that a single shelter assessment doesn't reliably predict how a dog behaves in a home, and recommend watching behavior across the whole stay ([ASPCA](https://www.aspca.org/about-us/aspca-policy-and-position-statements/position-statement-shelter-dog-behavior-assessments), [Clay et al., 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7401658/)).
- **Breed labels make it worse.** Staff visual breed guesses fully matched both DNA-identified breeds only about 10% of the time in a study of 919 shelter dogs ([Gunter et al., 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6107223/)), and breed explains only about 9% of behavioral variation in individual dogs ([Morrill et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9675396/)).
- **Staff are stretched thin.** Behavior notes, care, food, volunteers and matching often live in separate notebooks and spreadsheets.

## The idea

**Match families with how a dog actually behaves, before the adoption, not after the return.**

Bone-a-find watches ordinary kennel video and builds every dog an evidence-backed behavior record over time. It matches that real behavior against what families tell us about their actual lives, across the whole shelter at once, and it helps clear the real-world barriers (housing, food, vet access) that break otherwise good placements.

Breed is never an input. Every score links to the exact second of video that produced it, and people stay in charge of every decision.

> Behavior isn't a permanent label. It's a time series.

## What it does

**One behavior record powers everything.** The same video-derived evidence decides which families fit a dog, which volunteers can safely handle it, which dogs make good playmates, when staff should step in on welfare, and what goes on the public passport. A dog showing high stress or arousal gets a handling level that steers it toward experienced handlers and families, not first-time owners.

| Feature | What staff, families and adopters get |
|---|---|
| **Behavior from video** | Energy, stress-associated behavior, approachability and arousal spikes from kennel video, plus a handling level (Green to Red) |
| **Every score has receipts** | Timestamped events like "Jumped up at the fence" or "Calm and settled." Click one and the video jumps to that second |
| **Behavior over time** | Each session stored as a time series. If stress climbs across recent sessions, staff get a welfare alert (Lola: +32 over her last 3 sessions, so the app suggests a quieter kennel or foster priority) |
| **Human review** | Staff confirm, reject or correct any machine observation. Both the original and the correction are kept |
| **Interventions** | Log what staff changed and compare later sessions. We say "observed change after," never "caused" |
| **Staff memory** | Notes like "settles after a slow sniff walk" stored per dog. "Ask about this dog" answers only from those notes and shows which ones it used |
| **Whole-shelter matching** | Families describe their life in plain words. We turn that into structured needs and match all dogs with all families at once, with "why" lines from real evidence and "not a fit for" lines from rules |
| **Behavior Passport** | A public page with a QR code for adopters and landlords. Behavior evidence only. Never breed, never staff or vet notes |
| **Clearing real-world barriers** | Live web search for pet-friendly rentals, pet food assistance and nearby vets, because a good match still fails if the landlord says no |
| **Shelter operations** | Care, food, playgroups, volunteers matched by handling level, vet Q&A, alumni, all on the same dog record |
| **Live upload** | Staff upload a kennel clip. It goes straight to S3, the pipeline runs and the dog gets a level, scores, a timeline and its top 3 families |

## What makes it different

Shelter software, behavior matching and dog computer vision all exist separately:

| Category | Examples | What already works | The gap |
|---|---|---|---|
| Shelter management | Shelterluv, PetPoint, 24PetShelter | Intake, medical, adoptions, reporting, behavior notes | Records are human-entered. No video-derived evidence, timestamps or behavior trajectories |
| Behavior and lifestyle matching | How I Met My Dog, quiz-style matchers | Matching on behavior and lifestyle over breed | Dog profiles come from surveys, not observed behavior over time |
| Standardized assessments | SAFER, Match-Up II | Structured, repeatable evaluations | Episodic, and shelter stress limits what one session can predict |
| Academic dog computer vision | Research pipelines | Tracking and quantifying dog behavior from video | Not built into shelter workflows, human review or placement |

**We don't claim to be the first to care about behavior.** Our contribution is the connected loop:

**Video → evidence → trend → human review → intervention → match → passport → outcome**

The twist: matching starts from **measured behavior over time**, not a questionnaire or a breed guess. And instead of trying to remove breed bias after it gets into a model, **we designed breed out of the behavioral decision.** The pipeline rejects breed fields at ingest, so breed cannot affect a score.

We also see Bone-a-find as a **behavior layer that plugs into existing shelter software**, not a replacement for it.

## Why it matters to people

- **Dogs** go to homes that fit how they actually behave, so fewer come back. A dog that's struggling in the kennel gets flagged early.
- **Families** describe their real lives and get matches with reasons they can understand, so they're less likely to face the heartbreak of a return.
- **Shelter staff** get evidence they can check, alerts instead of guesswork, and hours back from scattered notes.
- **Landlords and adopters** get a passport with real evidence instead of a breed guess.
- **Volunteers** are assigned dogs they can safely handle.

## Responsible AI

- **Automate observation, not judgment.** Computer vision measures, the language model explains, and humans decide.
- **Decision support, not a diagnosis.** No temperament certification, no safety guarantees, no causal claims.
- **No invented numbers.** Where the pipeline doesn't record a value (like per-event confidence), the app says "not recorded."
- **Working isn't the same as validated.** Pose estimation is benchmarked but gated. It doesn't touch matching, handling levels or any decision until it's validated against human labels.
- **Privacy by allowlist.** The public passport only shows approved fields.

## How it works

```
Kennel video
  → S3 (direct browser upload, presigned)
  → FastAPI pipeline on EC2
      YOLO11 detection + ByteTrack tracking
      camera-motion compensation (optical flow + affine)
      blur filtering, deadbands, temporal smoothing
      event extraction (jumps, pacing, acceleration, calm)
      scores, handling level, needs, H.264 transcode
  → MongoDB Atlas (dog record, events, reviews, jobs)
  → Tiger Data (behavior time series + dog_daily continuous aggregate)
  → Next.js app on AWS Amplify (staff dashboard, matching, passport)
```

**Each tool answers a different question:**

| Tool | Question it answers |
|---|---|
| YOLO11 + ByteTrack | What did the dog physically do? |
| Tiger Data | How is that behavior changing over time? |
| Supermemory | What have staff learned that a camera can't see? |
| Gemini API | What is this family telling us about their life? (Gemini structures the intake. It never picks the dog.) |
| MongoDB Atlas | How do machine evidence, human review and operations stay connected to one dog? |
| TinyFish | What real-world barrier could stop this adoption? |
| Amazon Bedrock (Nova Lite) | How do we explain measured facts in plain language? |
| Amazon S3, EC2, Amplify | Media storage, the vision pipeline, the web app |
| SuperAnimal (pose) | Body-posture signal, benchmarked and gated |

No single model makes the decision. Each one contributes what it's actually good at, and humans stay in control.

**Domain:** bone-a-find.us, a .us domain from GoDaddy Registry. "Bone-a-find" is a play on "bona fide": a real, evidence-backed match.

## Evaluation (stated carefully)

- **86.7% agreement** (13 of 15) between pipeline outputs and our team's written expected behavior bands, on a small evaluation set. This is agreement, not accuracy.
- **Determinism:** scores varied by at most 1 point across repeated runs.
- **Camera-compensation ablation:** turning compensation off changed some scores substantially, so we kept it.
- **Breed robustness:** we sent the same video to Gemini with only the supplied breed label changed. Its ratings moved by up to about 6.7 points, within its own run-to-run spread. Bone-a-find's scores were identical, because breed never enters the pipeline.
- **Pose:** SuperAnimal ran on all 9 test videos, with model confidence of about 0.65 to 0.78 on 6 of them. That's model confidence, not validated accuracy.

**What we built vs. what we used:** YOLO11 and SuperAnimal are pretrained models. We didn't train a model from scratch. Our work is the engineering around them: motion compensation, filtering, event extraction, longitudinal scoring, configurable rules, matching, and the evidence and review workflow.

## Repository layout

```
app/        Next.js web app (AWS Amplify)
pipeline/   Python computer vision pipeline + FastAPI service (EC2)
landing/    Standalone marketing site
```

Configuration is read from environment variables (never committed). The app uses `MONGODB_URI`, `TIGER_URL`, `GEMINI_*`, `BEDROCK_*`, `SUPERMEMORY_*`, `TINYFISH_*`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `NEXT_PUBLIC_PIPELINE_URL`. Pipeline evaluation details are in `pipeline/EVAL.md`.

## What's next

- Pilot with one or two shelters using fixed cameras and clear consent.
- Build a human-labeled benchmark for events and pose, with more than one reviewer.
- Follow up after adoption at 2 weeks, 1 month and 3 months to test whether shelter observations predict good placements.
- Integrate with Shelterluv and PetPoint so staff don't keep duplicate records.
- Test fairness beyond breed: coat color, lighting, body size, age, mobility and camera angle.

## Team

- **Sumedha Gupta**: product, frontend, design
- **Aditya**: AWS deployment, pipeline infrastructure, pose estimation

---

Breed is never stored or shown. Decision support, not a diagnosis.
