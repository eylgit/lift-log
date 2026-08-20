# Lift Log — Build Plan

A staged plan for building Lift Log, written to be handed to a developer who has not been part of
the design conversation.

**How to read this.** The plan is split into **parts** (A–J). Each part is self-contained, has
explicit prerequisites, and ends with **exit criteria** — a checklist the project owner reviews
before the next part starts. Numbering is `Part` → `step` → `sub-step` → `sub-sub-step`, so
`A1.2.3` is Part A, step 1, sub-step 2, sub-sub-step 3.

**Read these first:** [`lift-log-design.md`](lift-log-design.md) is the full design and the source
of truth for *why*. This document is the *what and in what order*. Where the two disagree, the
design document wins and this plan should be corrected.

---

## Current state (as of the first commit)

Do not redo this work.

| | |
| --- | --- |
| Repository | `github.com/<user>/lift-log`, branch `main`, one commit `M0: deployable PWA skeleton`. **Private** until H3.3 — see *Visibility* below. |
| Stack | Vite 5 · React 18 · TypeScript 5 · `vite-plugin-pwa` 0.21 |
| Build | Verified green: `npm run typecheck && npm run build` produces `dist/` with a service worker |
| Existing source | `src/plan.ts` (rotation, scheme, training-day rule), `src/App.tsx` (Today screen shell), `src/styles.css` (Blueprint palette), `public/` (PWA icons) |
| CI | `.github/workflows/ci.yml` — typecheck + build on push and PR, Node 20 |
| Deploy | `wrangler.jsonc` — assets-only Cloudflare Worker serving `dist/` from the root path |
| Tooling | `gh` CLI installed at `/usr/local/bin/gh`, authenticated. Node 20 at `/opt/node20/bin` |

### Two environment facts that will waste an afternoon if unknown

- **Node 20 or newer is required.** Node 18 has no global `crypto`, which the PWA build needs.
- **`npm install` fails inside the VirtualBox shared folder** with an `EPERM` symlink error, because
  the share cannot create the symlinks npm puts in `node_modules/.bin`. Clone the repo onto the
  VM's own filesystem (e.g. `~/lift-log`) and develop there. Use the share for syncing only.

### Visibility

The repository is **private for the whole build and goes public as the last step of H3**. Nothing
in Parts A–G depends on it being public:

- **Cloudflare does not care.** Workers Builds installs a Cloudflare GitHub App with
  per-repository access and builds on Cloudflare's own runners. Private repositories build and
  deploy exactly the same way, and changing visibility later does not disturb the installation.
- **GitHub Actions does not care.** CI runs on private repositories too; the only difference is that
  the minutes are metered against the free-tier quota instead of being unlimited. At two steps per
  push this is negligible.
- **GitHub Pages (A5) is the exception.** Pages from a private repository requires a paid plan, so
  A5 is unavailable while the repository is private. This is not a problem: A4 (Cloudflare) is the
  recommended route anyway, and A4 and A5 are alternatives — you only do one.

Because everything committed becomes world-readable at H3.3, the privacy rules in the project
instructions apply from the first commit, not from the moment the switch is flipped. Do not treat
the private window as a place to park things you would not publish.

---

## Invariants

These are settled decisions. They are cheap to honour and expensive to reverse. Cite them by
number in code review. **Do not change one without asking the project owner.**

| # | Invariant |
| --- | --- |
| **INV-1** | **Kilograms are the only stored unit** — in the database and in the export. Convert at display only. |
| **INV-2** | **The log is the truth.** Sessions and sets are append-only facts. The prescribed weight is *derived* by replaying them, never stored as an opinion. |
| **INV-3** | **Deletes are tombstones.** Mark deleted, filter on read, keep in the export. Never remove a fact. |
| **INV-4** | **A logged set stores the rep count**, not a pass/fail boolean. `doneReps: 3`, not `completed: false`. |
| **INV-5** | **`trainingDay` is its own field** — a local date string with a 3 a.m. cutoff. Never derive the day from a UTC timestamp. |
| **INV-6** | **The rotation is a position pointer, not a calendar.** Missing days creates no debt and no catch-up UI. |
| **INV-7** | **Tap the value to change it.** A dotted underline means editable; tapping turns the value into a stepper in place. Binary values (weak side) flip instead. Every manual change is written to the log as a fact. |
| **INV-8** | **One palette (Blueprint), no theme switching.** No dark mode toggle, ever. |
| **INV-9** | **No account, no analytics, no backend** in v1. Nothing may require the network. |
| **INV-10** | **Never swap code mid-session.** The service worker uses `registerType: "prompt"` and only offers the update on the Today screen. |

### Session structure (hardcoded for v1)

5 reps per side → both sides back to back = **one set** → **3 sets** → **5 minutes rest between
sets**, none between the two sides. Weak side first. This differs from the source guide, which also
rests between sides; the grouping is deliberate. See `lift-log-design.md` §1.

---

# Part A — Repository and deployment

**Goal.** A live, installable URL that redeploys on every push, before any real code exists.
**Prerequisites.** None.
**Effort.** One evening.
**Owner note.** A1, A4 and A5 need the project owner's accounts. A developer cannot do them alone.

## A1 — Authenticate with GitHub

- **A1.1** Confirm the GitHub account exists and you can sign in at github.com.
  - **A1.1.1** If there is no account: sign up at <https://github.com/signup>, verify the email
    address, and enable two-factor authentication (GitHub requires it for contributors).
- **A1.2** Authenticate the CLI from the project machine.
  - **A1.2.1** Run `gh auth login --hostname github.com --git-protocol https --web`.
  - **A1.2.2** Copy the one-time code it prints, open the URL it gives in a browser, paste the code,
    approve.
  - **A1.2.3** Verify with `gh auth status` — it must report the account and `protocol: https`.
- **A1.3** Configure git to use the CLI's credentials: `gh auth setup-git`.
- **A1.4** Set the commit identity if it is not already set:
  `git config user.name "<name>"` and `git config user.email "<email>"`.

## A2 — Create the remote and push

- **A2.1** Confirm the working tree is clean and on `main`: `git status`, `git branch --show-current`.
- **A2.2** Create the repository and push in one step:
  `gh repo create lift-log --private --source=. --remote=origin --push`
  - **A2.2.1** If `lift-log` is taken on the account, pick another name and record it — it becomes
    the GitHub Pages base path in A5 and appears in the README.
  - **A2.2.2** Private for now. It goes public at H3.3, once the README, screenshots and ADRs are
    in place and the repository reads the way you want a stranger to find it. The commit history is
    part of the portfolio, so it is published in full — just not yet.
- **A2.3** Verify: `gh repo view --web` opens the repository and the README renders.

## A3 — Confirm CI

Leave `.github/workflows/ci.yml` as it is. It already does the right thing, and nothing later in
the plan needs it changed.

- **A3.1** Open the Actions tab; the `CI` workflow should have run on the push.
- **A3.2** Confirm both steps pass: `npm run typecheck` and `npm run build`.

> **Reading CI from the CLI.** `gh run list` needs a token with the `actions: read` scope. A
> fine-grained personal access token without it returns `HTTP 403: Resource not accessible by
> personal access token`, which says nothing about whether the run passed. Either add the scope or
> read the Actions tab in a browser — do not treat the 403 as a failing build.

## A4 — Deploy to Cloudflare Workers *(recommended)*

Chosen over GitHub Pages because it serves from the **root path**, which keeps the PWA manifest
`start_url` and service-worker `scope` trivially correct.

**Workers, not Pages.** Cloudflare's guidance is that new projects should use Workers: Pages keeps
working and existing projects are unaffected, but all new investment goes to Workers, and the
dashboard no longer offers a Pages option when creating a project. Workers serves static assets
natively, so nothing here needs a server — the Worker is assets-only, with no script at all.

- **A4.1** Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up> and verify
  the email address.
- **A4.2** Commit `wrangler.jsonc` **before** connecting the repository. The deploy step runs
  `npx wrangler deploy`, which reads this file; without it the first build fails.
  - **A4.2.1** `name` must be **identical** to the Worker name in the dashboard, or the build fails
    with a name mismatch. Both are `lift-log`.
  - **A4.2.2** `assets.directory` is `./dist` — where `vite build` writes. `dist/` stays gitignored;
    Cloudflare builds it, it is never committed.
  - **A4.2.3** `not_found_handling: "single-page-application"` returns `index.html` with a 200 for
    unknown paths, so client-side routing works.
- **A4.3** In the dashboard: **Workers & Pages → Create application → Connect to Git**.
  - **A4.3.1** Authorise the Cloudflare GitHub app and grant it access to the `lift-log` repository
    only, not the whole account. A private repository is fine — the app has explicit access.
  - **A4.3.2** Select `lift-log` and choose the `main` branch as production.
  - **A4.3.3** Let Cloudflare create the API token it offers. It is scoped to deploying this Worker.
- **A4.4** Set the build configuration.
  - **A4.4.1** Project / Worker name: `lift-log` — must match `name` in `wrangler.jsonc`.
  - **A4.4.2** Build command: `npm run build`.
  - **A4.4.3** Deploy command: `npx wrangler deploy` (the default — leave it).
  - **A4.4.4** Root directory: `/`.
  - **A4.4.5** There is **no build-output-directory field** in this flow. That is not an omission;
    `wrangler.jsonc` already says where the output is. Setting it in two places is what Pages did.
  - **A4.4.6** Node version: the build image defaults to Node 24 and preinstalls 22 and 24. The
    repository's `.nvmrc` says `20`, which is honoured but is not preinstalled. If the build fails
    at the Node step, set the build variable `NODE_VERSION` = `22` and rerun. Do **not** pin below
    20 — Node 18 has no global `crypto` and the PWA build needs it.
- **A4.5** Save and deploy. Note the resulting URL, e.g. `lift-log.<subdomain>.workers.dev`.
- **A4.6** Record the URL in `README.md` and in the repository's About field
  (`gh repo edit --homepage "<url>"`).
- **A4.7** Push a trivial commit and confirm it redeploys automatically.

> **Origin warning.** Browser storage is scoped to the exact origin. Moving from the `workers.dev`
> URL to a custom domain later strands every existing log on the old origin; the only route across
> is export-then-import. Decide the final URL before there is real data in it.

## A5 — Deploy to GitHub Pages *(alternative to A4 — do one, not both)*

> **Not available while the repository is private** — Pages from a private repository needs a paid
> plan. Take A4. This section is kept for the case where Cloudflare is ruled out and you are willing
> to publish the repository early.

- **A5.1** Repository **Settings → Pages → Source: GitHub Actions**.
- **A5.2** Add `.github/workflows/pages.yml`:
  - **A5.2.1** Trigger on push to `main`; permissions `contents: read`, `pages: write`,
    `id-token: write`.
  - **A5.2.2** Build with `BASE=/lift-log/ npm run build` — the repo name must match, with leading
    and trailing slashes. `vite.config.ts` already reads `BASE` and feeds it to `base`, the
    manifest `start_url` and `scope`.
  - **A5.2.3** Upload `dist` with `actions/upload-pages-artifact@v3` and deploy with
    `actions/deploy-pages@v4`.
- **A5.3** Verify the app loads at `https://<user>.github.io/lift-log/` **and** that the manifest
  install prompt appears. A wrong base path is the most common cause of a PWA that silently
  refuses to install.

## A6 — Install on a real phone

- **A6.1** Open the deployed URL on the phone that will actually be used for training.
- **A6.2** iOS: Share → Add to Home Screen. Android: the install prompt, or menu → Install app.
- **A6.3** Launch from the home-screen icon and confirm it opens without browser chrome.
- **A6.4** Enable airplane mode, relaunch, and confirm the Today screen still renders.

### Exit criteria — Part A

- [x] Private repository exists with the M0 commit, and CI passes on it.
- [x] A public URL serves the app, and pushing to `main` redeploys it.
- [x] The app is installed on the owner's phone and opens offline.
- [ ] The final URL is recorded in the README (done) and the repo homepage field (outstanding —
      needs a token with `metadata: write`, or set it by hand in the repository's About panel).

---

# Part B — The progression engine

**Goal.** A pure TypeScript module that answers *what should I lift today* from a history and an
equipment description. **No React, no browser APIs, no I/O.** This is the hardest and most valuable
part; build it before any UI.
**Prerequisites.** Part A.
**Effort.** One weekend.

## B1 — Set up the engine module and its test runner

- **B1.1** Create `src/engine/` with `types.ts`, `ladder.ts`, `progression.ts`, `stats.ts`,
  `index.ts`.
- **B1.2** Add Vitest and fast-check as dev dependencies; add `"test": "vitest run"` and
  `"test:watch": "vitest"` scripts.
- **B1.3** Add an ESLint rule or a test that fails if anything under `src/engine/` imports from
  `react`, `dexie`, or references `window`/`document`. The purity is the point; enforce it.
- **B1.4** Add `npm test` to `.github/workflows/ci.yml`.

## B2 — Types and the data model

- **B2.1** Define `Exercise` — id, name, movement pattern, `incrementKg`, `videoQuery`.
- **B2.2** Define `Equipment` as a discriminated union.
  - **B2.2.1** `{ kind: "simple", minKg, stepKg }` — the v1 default, two numbers.
  - **B2.2.2** `{ kind: "adjustable", minKg, maxKg, stepKg }`.
  - **B2.2.3** `{ kind: "fixed", weightsKg: number[] }`.
  - **B2.2.4** `{ kind: "loadable", barKg, collarKg, plates: {massKg, pairs}[] }` — defer the
    implementation to a later part, but define the type now so nothing downstream has to change.
- **B2.3** Define `SetLog` — `{ id, sessionId, ordinal, side, targetReps, doneReps, loggedAt }`.
  `doneReps` is a **number** (INV-4).
- **B2.4** Define `Session` — `{ id, exerciseId, startedAt, finishedAt, trainingDay, prescribedKg,
  actualKg, status, note, deletedAt }`. `status` ∈ `planned | complete | abandoned`.
  `deletedAt` is the tombstone (INV-3).
- **B2.5** Define `Prescription` — `{ exercise, weightKg, repsPerSide, sets, restMinutes, weakSide }`.
- **B2.6** Define `EngineState` — `{ exerciseId, targetKg, stallCount, weakSide }`. Document in a
  comment that this is a **derived cache** and can always be rebuilt (INV-2).

## B3 — The weight ladder

- **B3.1** Implement `buildLadder(equipment): number[]` returning a sorted, deduplicated ascending
  list of achievable weights.
  - **B3.1.1** `simple` → `min, min+step, min+2·step, …` up to a sane ceiling.
  - **B3.1.2** `adjustable` → the same, bounded by `maxKg`.
  - **B3.1.3** `fixed` → the given list, sorted and deduplicated.
  - **B3.1.4** `loadable` → `bar + 2·collar + 2 × (any sub-multiset sum of one-side plates)`, via a
    dynamic-programming pass over reachable sums. Store one canonical combination per rung
    (greedy, largest first) for the "per side: 10 + 2.5" display.
- **B3.2** Implement `snapDown(ladder, targetKg): number` — the largest rung at or below the target,
  or the smallest rung if the target is below the whole ladder. Never throw.

## B4 — The prescription

- **B4.1** Implement `prescribe(state, equipment): number` as `snapDown(ladder, state.targetKg)`.
- **B4.2** Document the virtual-target mechanism in a comment: `targetKg` is a real number that
  rises by the full increment on every clean session regardless of what the plates can do; the
  prescription is the reality-clamped view of it. This is what keeps the *average* rate correct
  when the plates are coarser than the increment.

## B5 — Session outcome rules

Implement `applyOutcome(state, session, sets, history): EngineState`.

- **B5.1** **All sets clean on both sides** → `targetKg += exercise.incrementKg`; `stallCount = 0`.
  Clean means every `doneReps === targetReps`. **Binary, no tolerance.**
- **B5.2** **Any set short** → `targetKg` unchanged; `stallCount += 1`.
- **B5.3** **`stallCount` reaches 3** (fixed, not a setting) → return a deload *proposal*, not a
  mutation. The UI asks; the engine never deloads silently.
- **B5.4** **Deload accepted** → `targetKg` = the prescribed weight from **6 sessions of that
  exercise ago**, counted in sessions and not calendar days. Fall back to `targetKg × 0.85` when
  there is less history. `stallCount = 0`.
- **B5.5** **Deload declined** → `stallCount = 0`, weight holds. Record the decline as a fact.
- **B5.6** **Manual weight override** → `targetKg` = the weight actually used. A hand change is
  recorded, never silently discarded (INV-7).
- **B5.7** **Session abandoned** → counts as incomplete; do not advance `targetKg`.

## B6 — Derived statistics

- **B6.1** `estimated1RM(weightKg, reps)` using Epley: `w × (1 + reps/30)`.
- **B6.2** `chartSeries(history)` → the points for the sawtooth, plus deload markers.
- **B6.3** `streak(history)` and `sessionsThisMonth(history)`, both using `trainingDay` (INV-5).
- **B6.4** `personalBest(history)` per exercise.

## B7 — Tests

- **B7.1** Unit tests: every rule in B5, every edge case in B3, every equipment kind.
- **B7.2** Property tests with fast-check.
  - **B7.2.1** For any equipment, `prescribe(...)` is always a member of the ladder.
  - **B7.2.2** `prescribe(...) <= targetKg`, unless the target is below the smallest rung.
  - **B7.2.3** `targetKg` is monotonically non-decreasing except immediately after a deload.
  - **B7.2.4** Over N clean sessions, `(final − initial) / N` converges on the increment.
  - **B7.2.5** Every stored plate combination sums to its rung.
- **B7.3** A 365-day simulation: a virtual lifter whose capacity grows on a fixed curve, run through
  the real engine. Assert that deloads fire, each cycle's peak exceeds the previous cycle's peak,
  and the final weight beats the starting weight. Emit the series so it can be charted in the
  README.

### Exit criteria — Part B

- [ ] `npm test` passes, including the property tests and the simulation.
- [ ] Nothing under `src/engine/` imports React, Dexie, or touches `window`/`document`.
- [ ] A reader can follow `progression.ts` end to end in ten minutes.
- [ ] The simulation output produces a recognisable sawtooth.

---

# Part C — Persistence

**Goal.** The log lives in IndexedDB, survives reloads, and can be rebuilt from scratch by replay.
**Prerequisites.** Part B.
**Effort.** One weekend.

## C1 — Schema and migrations

- **C1.1** Add Dexie. Create `src/db/schema.ts`.
- **C1.2** Declare version 1 with tables `exercise`, `equipment`, `settings`, `session`, `setLog`,
  `engineState`. Index `session` by `exerciseId` and `trainingDay`; index `setLog` by `sessionId`.
- **C1.3** **Use Dexie's versioning from the first schema**, even though there is nothing to migrate
  yet. Adding it later, once real training data exists, is the painful path.
- **C1.4** Store `schemaVersion` in `settings`.

## C2 — The repository interface

- **C2.1** Define `src/db/repo.ts` as an interface — `listSessions`, `appendSession`, `appendSets`,
  `softDeleteSession`, `getEquipment`, `getSettings`, and so on. No Dexie types in the signatures.
- **C2.2** Implement `src/db/dexie-repo.ts` against that interface.
- **C2.3** Nothing outside `src/db/` may import Dexie. This is what makes the later swap to native
  SQLite (Part J) a day rather than a rewrite.
- **C2.4** `softDeleteSession` sets `deletedAt`; every read filters it out (INV-3).

## C3 — Replay

- **C3.1** Implement `rebuildState()`: clear `engineState`, read the whole log in order, feed it
  through the Part B engine, write the result back.
- **C3.2** Call it after every import and every migration.
- **C3.3** Test: seed a log, snapshot `engineState`, drop the table, rebuild, assert identical.

## C4 — Export and import

- **C4.1** `exportJson()` produces a human-readable, self-describing document: `schemaVersion`, an
  ISO `exportedAt`, and every table including tombstones.
- **C4.2** `exportCsv()` produces one row per logged set, for spreadsheets.
- **C4.3** `importJson(file)` validates `schemaVersion`, **replaces** all local data, then calls
  `rebuildState()`.
- **C4.4** Add the round-trip test to CI: export → wipe → import → rebuild → deep-equal.
- **C4.5** Write C4 **before** the app is useful. The day it is needed, nobody wants to be debugging
  it.

### Exit criteria — Part C

- [ ] Data survives a reload and an app restart.
- [ ] Dropping `engineState` and calling `rebuildState()` reproduces it exactly.
- [ ] The round-trip test runs in CI and passes.
- [ ] `grep -r dexie src/ --exclude-dir=db` returns nothing.

---

# Part D — The session runner

**Goal.** The app becomes usable. **The owner starts training on it at the end of this part** —
everything after is improvement, not enablement.
**Prerequisites.** Parts B and C.
**Effort.** One weekend.

## D1 — Today, wired to the engine

- **D1.1** Replace the hardcoded rotation in `src/App.tsx` with the engine's prescription.
- **D1.2** Render: day of rotation, exercise name, pattern, weight, `5 reps per side × 3 sets`,
  load breakdown, last session's result, Start.
- **D1.3** Advance the rotation by **position, not date** (INV-6). No catch-up, no debt, no
  "you missed 2 sessions" UI anywhere.

## D2 — The session flow

- **D2.1** One side on screen at a time: `Set 1 of 3 · LEFT · 5 reps @ 32.5 kg`.
- **D2.2** A single large **Done** button (≥ 88 px tall) and a smaller **I missed some reps**.
  - **D2.2.1** The miss path opens a 0–4 picker and stores the integer (INV-4).
- **D2.3** Three progress bars, half-filled after the first side of a set.
- **D2.4** Order: weak → other, weak → other, weak → other. **Rest only between sets**, never
  between the two sides of one set.
- **D2.5** Persist after every side. Killing the app mid-session and reopening resumes on the exact
  side.
- **D2.6** The weak side governs: if the weak side misses and the other does not, the session is
  still incomplete.

## D3 — The rest timer

- **D3.1** Store `restStartedAt` and compute the remaining time from the wall clock on every render.
  **Never** count down with a `setInterval` that the OS can suspend.
- **D3.2** Request a Screen Wake Lock during a session; release it on exit.
- **D3.3** "Rest longer" is a first-class button, not a failure state.
- **D3.4** Do **not** build scheduled notifications. They are unreliable on iOS web and are
  explicitly out of v1 scope; onboarding tells the user to set a phone alarm instead.

## D4 — Summary and deload

- **D4.1** Clean → "Next time: 35 kg" with the load breakdown.
- **D4.2** Missed → "Next time: 32.5 kg again."
- **D4.3** Third stall → the deload prompt, with the explanation and the climb-back preview.
  Accepting and declining are both recorded (B5.4, B5.5).

## D5 — Tap-to-edit (INV-7)

- **D5.1** Build one `<TapValue>` component: renders as text with a dotted underline; on tap swaps
  itself for a stepper in place; tapping elsewhere collapses it.
- **D5.2** Build one `<Stepper>` component with ≥ 42 px targets, used everywhere.
- **D5.3** Binary values do not get a stepper — they flip on tap.
- **D5.4** **On Today**, editable: the lift, the weight, reps × sets, rest, the weak side.
- **D5.5** **On the session screen**, editable: the weight, the reps, which side you are on. Nothing
  else — mid-set is not a planning moment.
- **D5.6** Every edit writes a fact to the log and feeds the engine (B5.6).
- **D5.7** A one-line hint on Today: "Dotted underline means you can tap it." Discoverability is the
  known weakness of this pattern; pay the one line.

### Exit criteria — Part D

- [ ] A full session can be completed on a phone, and the weight moves correctly afterwards.
- [ ] Force-quitting mid-session and reopening resumes on the right side.
- [ ] The rest timer shows the correct remaining time after the phone has been locked.
- [ ] Every value listed in D5.4 and D5.5 is editable in one tap.
- [ ] **The owner has trained at least one real session on it.**

---

# Part E — History and progress

**Goal.** The log becomes visible. This is the part that makes the habit stick.
**Prerequisites.** Part D.
**Effort.** One weekend.

## E1 — History
- **E1.1** Calendar heat map, one cell per day, driven by `trainingDay`.
- **E1.2** Reverse-chronological session list, tappable through to every set.
- **E1.3** Session detail with a soft-delete action (INV-3) behind a confirm.

## E2 — Progress
- **E2.1** Per-exercise sawtooth chart of working weight, hand-written SVG. No chart library.
- **E2.2** The estimated-1RM line beneath it (B6.1), visually distinct.
- **E2.3** Deload markers on the chart.
- **E2.4** Stat row: current, best, estimated 1RM, total gain, deload cycles.
- **E2.5** Exercise switcher.

## E3 — Backfill
- **E3.1** Manual entry for a session done away from the phone: exercise, date, weight, reps per
  side per set.
- **E3.2** Backfilled sessions go through the same engine path as live ones.

### Exit criteria — Part E
- [ ] The chart renders correctly with 1, 2 and 200 sessions, and with a gap in the middle.
- [ ] Soft-deleting a session removes it from the views and from the chart, and `rebuildState()`
      still produces the right current weight.

---

# Part F — Durability

**Goal.** The log cannot be lost by accident. Read `lift-log-design.md` §9 before starting.
**Prerequisites.** Part C. Can run in parallel with E.
**Effort.** One weekend.

## F1 — Persistence and honesty
- **F1.1** Call `navigator.storage.persist()` once during onboarding; store the result.
- **F1.2** Read `navigator.storage.estimate()` for usage and quota.
- **F1.3** Show a plain storage-status block: stored on this device, installed yes/no, persistent
  granted/best-effort, usage, last backup. Do not hide it.

## F2 — Install nudge
- **F2.1** Detect iOS Safari not running standalone.
- **F2.2** Show a real screen with Share → Add to Home Screen instructions and the honest reason:
  Safari deletes a site's data after seven days without a visit; a home-screen app is exempt.
- **F2.3** On Android, use the `beforeinstallprompt` event.

## F3 — Backup nudge
- **F3.1** Track `lastExportedAt` in settings.
- **F3.2** After ~14 days or ~10 sessions without a backup, interrupt once with a dismissible
  full-screen step: one sentence, one large Download button.
- **F3.3** This is the highest-leverage item in the whole data story. Do not skip it.

## F4 — Import
- **F4.1** File picker → validate → confirm → replace → `rebuildState()`.
- **F4.2** The confirm must state plainly that import **replaces** the log on this device.
- **F4.3** Place Import beside Download, visually secondary.

### Exit criteria — Part F
- [ ] Storage status renders truthfully on iOS Safari, installed iOS, and Android Chrome.
- [ ] The backup nudge fires at the right time and stops after a download.
- [ ] A file exported on one device imports cleanly on another.

---

# Part G — Onboarding and first-run

**Goal.** A stranger can start in under two minutes; a recruiter can see the app without signing up.
**Prerequisites.** Parts D and F.
**Effort.** A few evenings.

## G1 — Onboarding
- **G1.1** Ask **two numbers only**: the lightest weight you can load, and the smallest jump you can
  make. That is a complete ladder (B3.1.1). Do not build a plate inventory UI in v1.
- **G1.2** Default all five starting weights to the lightest rung behind one button. They are
  tap-editable afterwards, and the method says start absurdly light.
- **G1.3** Ask the weak side per exercise, with an "I don't know" default.
- **G1.4** One line: "Set a recurring alarm on your phone for when you want to train" — the app does
  not do reminders (D3.4).
- **G1.5** Finish on the install step (F2).

## G2 — Sample data
- **G2.1** A "try it with sample data" switch that seeds ~14 weeks of plausible history, including
  two deload cycles.
- **G2.2** A clearly visible banner while sample mode is on, and one tap to wipe it and start real.
- **G2.3** Cheap to build and the single highest-value item for the portfolio half — without it, a
  first-time visitor lands on empty charts and a form.

## G3 — Settings
- **G3.1** Equipment, rest length, units display, export/import, about, reset.
- **G3.2** Resist adding settings. Each one is a decision handed back to the user, which is the
  thing the app exists to remove.
- **G3.3** About: credit Scott Chen with a link to onelift.org, plus the health disclaimer.

### Exit criteria — Part G
- [ ] A fresh install reaches the first session in under two minutes.
- [ ] Sample mode is one tap from the landing state, and one tap to leave.

---

# Part H — Ship v1.0

**Goal.** The repository reads well to someone who spends ninety seconds on it.
**Prerequisites.** Parts A–G.
**Effort.** One weekend.

## H1 — Quality passes
- **H1.1** Accessibility: keyboard operable, visible focus, tap targets ≥ 44 px, no colour-only
  meaning, sensible labels on every icon button.
- **H1.2** Performance: cold start to Today under one second, offline, on a real phone. Measure it.
- **H1.3** Empty states for every screen: no history, no chart, first session.
- **H1.4** Error states: import of a bad file, storage quota refused, corrupt record.

## H2 — Documentation
- **H2.1** `docs/adr/` — short architecture decision records, four or five paragraphs each: why
  append-only, why the virtual target, why IndexedDB over localStorage, why no accounts, why web
  before native, why tap-to-edit over the alternatives.
- **H2.2** README: a ten-second GIF of a real session in the first screenful, the method in five
  lines, the simulation chart from B7.3, the live link, install instructions.
- **H2.3** Screenshots of every screen.
- **H2.4** CONTRIBUTING, issue and PR templates, CHANGELOG.

## H3 — Release
- **H3.1** Tag `v1.0.0` and write release notes.
- **H3.2** Confirm the licence, the method credit and the health disclaimer appear in both the
  README and the in-app About screen.
- **H3.3** **Go public.** This is the last irreversible step, and it is deliberately last.
  - **H3.3.1** Before flipping: read the full history as a stranger would.
    `git log --stat` and `git diff <first-commit> HEAD` — check for host paths, home-lab or network
    detail, container names, credential filenames, tokens, keys and real email addresses. Publishing
    exposes **every commit**, not just the current tree; a secret deleted in a later commit is still
    there in the one that added it.
  - **H3.3.2** Confirm `git log --format='%ae%n%ce' | sort -u` shows only the intended noreply
    address.
  - **H3.3.3** Flip it:
    `gh repo edit <user>/lift-log --visibility public --accept-visibility-change-consequences`.
  - **H3.3.4** Confirm the Cloudflare deploy still works: push a trivial commit and watch it
    build. It should be untouched — the GitHub App installation survives a visibility change — but
    verify rather than assume.

### Exit criteria — Part H
- [ ] A stranger can understand what the app is and try it within ninety seconds of landing on the
      repository.
- [ ] `v1.0.0` is tagged and the live URL runs that build.
- [ ] The repository is public and the history has been read end to end for anything that should
      not be.

---

# Part I — Sync backup *(optional, later)*

**Goal.** A second copy of the log that does not depend on the user remembering to export.
**Prerequisites.** Part F. **Effort.** One weekend.

- **I1.1** One table: `(syncId, blob, updatedAt)`. Cloudflare Workers + D1, or Supabase. Free tier.
- **I1.2** `syncId` is a random 128-bit key generated on the device and shown once as a recovery
  phrase or QR code. **This is not an account system** — no email, no password, no profile.
- **I1.3** Push the whole document after each session. Last-write-wins on the blob.
  **Do not build CRDTs**; the data is a few hundred kilobytes and has one writer.
- **I1.4** Optionally encrypt client-side with a key derived from the phrase.
- **I1.5** Sync is opt-in and off by default. INV-9 still holds: nothing may *require* the network.

---

# Part J — Native apps via Capacitor *(optional, later)*

**Goal.** iOS and Android builds from the same code, and the OS takes over the durability problem.
**Prerequisites.** Part H. **Effort.** One to two weekends, mostly store paperwork.

- **J1.1** `npx cap init && npx cap add ios android`.
- **J1.2** Swap the `src/db/` implementation for `@capacitor-community/sqlite`. The interface from
  C2.1 does not change; the engine and the UI never find out.
- **J1.3** Swap the platform layer for `@capacitor/local-notifications` — **real scheduled reminders
  become possible here**, which they are not on the web (D3.4).
- **J1.4** Data now lives in the app sandbox, backed up to iCloud and Google Drive automatically.
- **J1.5** Store listings, screenshots, privacy declarations. Budget more time for this than for the
  code.

---

## Sequencing summary

```
A ──► B ──► C ──► D ──► E ──► G ──► H ──► I (optional)
                   │     ▲            └──► J (optional)
                   └► F ─┘
```

| Part | Effort | Blocks |
| --- | --- | --- |
| A · Repository and deployment | one evening | everything |
| B · Progression engine | one weekend | C, D |
| C · Persistence | one weekend | D, F |
| D · Session runner | one weekend | E — **usable from here** |
| E · History and progress | one weekend | G |
| F · Durability | one weekend | G |
| G · Onboarding | a few evenings | H |
| H · Ship v1.0 | one weekend | I, J |
| I · Sync backup | one weekend | — |
| J · Native apps | one to two weekends | — |

## Standing instructions for whoever builds this

- **Do B before any UI.** It is the only genuinely hard part and the one most likely to change.
- **Ship export in Part C, not Part F.** From Part D the data is real.
- **Do not add a setting to resolve a disagreement.** Bring it to the project owner instead.
- **If an invariant is in the way, say so.** Do not quietly work around it — several of them are
  one-way doors and the cost of breaking one is not visible from inside the code.
