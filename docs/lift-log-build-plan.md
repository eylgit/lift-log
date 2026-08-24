# Lift Log — Build Plan

A staged plan for building Lift Log, written to be handed to a developer who has not been part of
the design conversation.

**How to read this.** The plan is split into **parts** (A–K). Each part is self-contained, has
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

- **B1.1** Create `src/engine/` with `types.ts`, `weights.ts`, `progression.ts`, `stats.ts`,
  `index.ts`.
- **B1.2** Add Vitest and fast-check as dev dependencies; add `"test": "vitest run"` and
  `"test:watch": "vitest"` scripts.
- **B1.3** Add an ESLint rule or a test that fails if anything under `src/engine/` imports from
  `react`, `dexie`, or references `window`/`document`. The purity is the point; enforce it.
- **B1.4** Add `npm test` to `.github/workflows/ci.yml`.

## B2 — Types and the data model

- **B2.1** Define `Exercise` — id, name, movement pattern, `videoQuery`, `startKg`, `weakSide`. No
  per-exercise increment: the step is the increment (B3). The last two fields were added in C3.0 —
  they are onboarding's answers (G1.2, G1.3), and they live here rather than in `EngineState`
  because replay drops that table and neither value can be recomputed from the log. See C3.0.
- **B2.2** Define `Equipment` as `{ stepKg }` — one number: how much the athlete **intends** to add
  on a clean session. `DEFAULT_STEP_KG` is 1.
  - **B2.2.1** Not a union over dumbbell types, and not a plate inventory — a settings screen that
    buys nothing (G1.1, G3.2).
  - **B2.2.2** **The step is an aspiration, not a constraint.** It makes no claim about which
    weights can be loaded, and the engine never rounds a weight to fit it. An earlier draft had the
    reachable weights be the multiples of the step, anchored at zero, and snapped everything onto
    that grid. It does not survive contact with real kit: a fixed rack runs 5, 10, 12.5, 15, 17.5,
    20, 22.5 — gaps of 2.5 low down and 5 higher up — and no single number describes it. Snapping
    produced weights that *looked* loadable with no guarantee they were.
  - **B2.2.3** So the engine names a target and the athlete reconciles it with the rack. Every
    weight is tap-to-edit (INV-7) and progression is measured from what was actually lifted, so a
    correction is absorbed rather than fought.
  - **B2.2.4** The known cost is a plateau the engine cannot see: a 2.5 kg step against 5 kg plates
    means the target is never loadable, the athlete repeats a weight indefinitely, and the sets stay
    clean so the stall counter never moves. The grid did not solve this either — it named 37.5 just
    the same — it only hid it. **The fix is a warning, not a rule (K2.3).**
- **B2.3** Define `SetLog` — `{ id, sessionId, ordinal, side, targetReps, doneReps, loggedAt }`.
  `doneReps` is a **number** (INV-4).
- **B2.4** Define `Session` — `{ id, exerciseId, startedAt, finishedAt, trainingDay, prescribedKg,
  actualKg, status, note, deletedAt }`. `status` ∈ `planned | complete | abandoned`.
  `deletedAt` is the tombstone (INV-3).
- **B2.5** Define `Prescription` — `{ exercise, weightKg, repsPerSide, sets, restMinutes, weakSide }`.
- **B2.6** Define `EngineState` — `{ exerciseId, currentKg, stallCount }`. `currentKg` is
  the weight to prescribe next. (Not "a whole multiple of the step": B2.2.2 removed the grid, so it
  is a start weight or a lifted weight plus or minus whole steps.) Document in a comment that this
  is a **derived cache** and can always be rebuilt (INV-2). `weakSide` was here until C3.0 and moved
  to `Exercise`; nothing may join this type unless replay can produce it.

## B3 — The step is the increment

The engine has **one** weight number per exercise, and it moves in whole steps. There is no
separate "ideal" increment and no ladder to snap to. See `lift-log-design.md` §6.1 for the
version that was considered and rejected, and what rejecting it costs.

- **B3.1** In `weights.ts`, implement `roundKg(kg): number` — round to two decimals. Floating point
  is the whole difficulty in this file: `0.1 + 0.2 !== 0.3`, and a 2.5 kg step accumulated by
  repeated addition drifts until 17.5 stops comparing equal to 17.5. Every weight the engine
  returns goes through this.
- **B3.2** ~~`snapToStep`~~ — **dropped.** It rounded a weight down to a multiple of the step, and
  went with the grid (B2.2.2). Its two callers had nothing left to correct: a hand-typed start
  weight is the athlete's choice, and the deload fallback now moves in whole steps from where they
  already are (B5.4).
- **B3.3** Reject a `stepKg` that is zero, negative, or not finite, in both functions. A bad step
  is the one input that can produce nonsense or hang a loop.

## B4 — The prescription

- **B4.1** Implement `nextWeight(state, equipment): number` as `roundKg(state.currentKg + stepKg)`
  for a clean session, and `state.currentKg` unchanged otherwise. That is the whole progression
  rule; B5 decides which case applies.
- **B4.2** Implement `prescribe(state, exercise): Prescription` — the weight plus the hardcoded
  session shape (5 reps, 3 sets, 5 minutes) and the weak side. The prescribed weight is always
  already on the grid, so it needs no snapping.

## B5 — Session outcome rules

Implement `applyOutcome(state, session, sets, history): EngineState`.

- **B5.1** **All sets clean on both sides** → `currentKg += equipment.stepKg`; `stallCount = 0`.
  Clean means every `doneReps === targetReps`. **Binary, no tolerance.**
- **B5.2** **Any set short** → `currentKg` unchanged; `stallCount += 1`.
- **B5.3** **`stallCount` reaches 3** (fixed, not a setting) → **deload, there and then.**
  `stallCount = 0`. The engine drops the weight itself; there is no prompt.
  - **B5.3.1** An earlier draft had the engine *propose* and the UI ask. Dropped: three stalls is
    about a fortnight of being stuck, which is unambiguous enough that a confirmation is friction
    rather than control, and the weight is tap-to-edit anyway (INV-7) — anyone who disagrees with
    the drop taps it back. `lift-log-design.md` §6.3 still describes the prompt and should be
    corrected.
  - **B5.3.2** The engine still *reports* the drop alongside the new state, so Today can say the
    weight moved and why. Reporting is not asking.
- **B5.4** **The deload weight** → `currentKg` = the weight actually used **6 sessions of that
  exercise ago**, counted in sessions and not calendar days, over complete sessions only, and
  returned exactly as it was lifted. Rounding it would invent a constraint the engine does not have.
  - **B5.4.1** Fall back when there is less history than that, and also when the historical weight
    is not below the current one — which happens after a hand override downwards, and where a
    "deload" upwards would be nonsense.
  - **B5.4.2** The fallback backs off by ~15%, expressed as a **whole number of steps down from the
    current weight**, rounding the drop up so it is at least as deep as the percentage asks. Not
    `× 0.85` snapped to a grid: there is no grid, and moving in steps keeps the number on the
    athlete's own ladder. Start at 22 with a 2.5 step and the weights are 22, 24.5, 27 — a
    zero-anchored grid would drop them onto 27.5, which they have never lifted.
- **B5.6** **Manual weight override** → `currentKg` = the weight actually used. Not a branch:
  progression is measured from `actualKg` throughout, so an override is already accounted for and
  can never be silently discarded (INV-7).
- **B5.7** **Session abandoned** → the engine learns nothing. `currentKg` and `stallCount` both
  unchanged; the next session is the one this would have been. Not a stall: with the deload no
  longer behind a prompt (B5.3), counting walk-outs would silently take weight off the bar, and
  people abandon sessions for reasons that have nothing to do with strength.

## B6 — Derived statistics

Every function takes the log as an argument and returns numbers — no storage, and **no clock**.
Where today's date is needed it is a `TrainingDay` parameter, because a clock is I/O and the engine
has none. That is also what lets these be tested without freezing time.

Only **complete, undeleted** sessions count toward any statistic. Abandoned sessions stay in the log
and the export, but a walked-away-from session on the chart would put a spike at a weight that was
never really lifted.

- **B6.1** `estimated1RM(weightKg, reps)` using Epley: `w × (1 + reps/30)`.
  - **B6.1.1** A single rep returns the weight itself rather than going through the formula, which
    would turn a 40 kg single into a 41.33 kg max — more than the thing that was just done.
  - **B6.1.2** Every lift is single-sided, so this is a **per-hand** figure. Do not double it for
    display.
- **B6.2** `chartSeries(exerciseId, history, sets)` → one `ChartPoint` per session, oldest first:
  weight, estimated 1RM from the best set, and two flags.
  - **B6.2.1** Takes the exercise explicitly and filters. Two exercises on one line would look like
    a plausible chart rather than an obvious bug.
  - **B6.2.2** The drop flag is `weightDropped`, not `isDeload`. The log does not record *who*
    dropped the weight — the engine after three stalls, or the athlete by hand — so the honest
    statement is that it went down. E2.3 can still render it as a deload marker; telling the two
    apart needs the provenance work in K1.1.
- **B6.3** `streak(history, today)` and `sessionsThisMonth(history, today)`, both on `trainingDay`
  (INV-5).
  - **B6.3.1** The streak counts **days, not sessions**, across every exercise: the question is
    whether the athlete turned up.
  - **B6.3.2** Today not being trained yet does not break it — the count starts from yesterday.
    Otherwise every streak reads zero until training is finished, which is when the number is least
    useful and most discouraging.
  - **B6.3.3** It cannot express a debt, and must not learn to (INV-6).
  - **B6.3.4** Stepping back a day uses `Date.UTC` arithmetic. This does **not** breach INV-5, which
    forbids *deriving* a training day from an instant. The day here has already been decided and
    written down; UTC is what stops the arithmetic picking up a timezone, and it gets month ends and
    leap days right where string arithmetic would not.
- **B6.4** `personalBest(exerciseId, history)` → the heaviest weight completed, or null.
  - **B6.4.1** Heaviest weight, not best estimated 1RM — different questions, and the stat row
    (E2.4) shows both. This is the one an athlete means by "my best".
  - **B6.4.2** Rep quality is not required. Three of a target five at 40 kg is a stall and the engine
    treats it as one, but 40 kg still went up. Ties go to the day it was first reached.

## B7 — Tests

- **B7.1** Unit tests: every rule in B5, every edge case in B3, across a range of step sizes —
  1, 1.25, 2.5, 5, and something awkward like 0.75.
- **B7.2** Property tests with fast-check.
  - **B7.2.1** ~~Every weight is a whole multiple of the step.~~ **Dropped** with the grid
    (B2.2.2) — there is nothing for a weight to be a multiple of. B7.2.4 is the property that
    survived, and it is the one that mattered.
  - **B7.2.2** ~~`snapToStep(kg) <= kg`.~~ **Dropped** with the function (B3.2).
  - **B7.2.3** `currentKg` is monotonically non-decreasing except immediately after a deload.
  - **B7.2.4** Over N clean sessions, `final − initial` is **exactly** `N × step`. Not "converges
    on" — with one number and no rounding in the loop, the drift should be zero.
- **B7.3** A 365-day simulation: a virtual lifter whose capacity grows on a fixed curve, run through
  the real engine. Assert that deloads fire, each cycle's peak exceeds the previous cycle's peak,
  and the final weight beats the starting weight. Emit the series so it can be charted in the
  README.

### Exit criteria — Part B

- [x] `npm test` passes, including the property tests and the simulation.
- [x] Nothing under `src/engine/` imports React, Dexie, or touches `window`/`document`.
- [ ] A reader can follow `progression.ts` end to end in ten minutes.
- [x] The simulation output produces a recognisable sawtooth. *(`output/simulation.svg`, regenerated
      by every test run. Eight to eleven teeth per lift over the year, each taller than the last.)*

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

- **C3.0** *(added during C3.)* Give replay an opening balance. `rebuildState()` cannot start from
  nothing: an untrained lift has no log to replay, and the start weight it needs was being kept in
  `engineState` — the very table replay clears. `weakSide` had the same problem and a worse one, in
  that no session derives it at all. Move both onto `Exercise` (B2.1), drop `weakSide` from
  `EngineState` (B2.6) and have `prescribe` read it from the exercise it is already handed. Add
  `initialState(exercise)` to the engine as the seed. No schema version bump: neither field is
  indexed, and IndexedDB versions only the indexes (see C1.3 and the `order` field).
- **C3.1** Implement `rebuildState()`: clear `engineState`, seed each exercise with
  `initialState()`, read the whole log in order, feed it through the Part B engine, write the result
  back.
- **C3.2** Call it after every import and every migration. The migration half is
  `rebuildIfMigrated(repo, SCHEMA_VERSION)`, run by `openDexieRepo` on every open: if the stored
  `settings.schemaVersion` (C1.4) is behind, the cache was filled by an older version's rules, so
  it is rebuilt and the version is written **after** the rebuild succeeds — a failed rebuild must
  leave the database looking un-migrated so the next open retries. The trigger is the stored
  version rather than a Dexie `upgrade()` hook, because that survives the swap to SQLite (Part J)
  and also catches a database that arrived with data already in it. The import half is C4.3, which
  calls `rebuildState` unconditionally: it replaces every table, so there is nothing to check.
- **C3.3** Test: seed a log, snapshot `engineState`, drop the table, rebuild, assert identical.

## C4 — Export and import

- **C4.1** `exportJson()` produces a human-readable, self-describing document: `schemaVersion`, an
  ISO `exportedAt`, and every table including tombstones. *(During C4: every table that holds a
  fact. `engineState` is left out — it is the cache, C4.3 rebuilds it from the restored log, and
  carrying it would put a second answer in the file beside the rows it was computed from with no
  way for a later reader to tell which to believe. The tombstones are the point of the sentence
  and they do travel: `Repo.snapshot()` is the one read in the app that does not filter them.)*
- **C4.2** `exportCsv()` produces one row per logged set, for spreadsheets.
- **C4.3** `importJson(file)` validates `schemaVersion`, **replaces** all local data, then calls
  `rebuildState()`.
- **C4.4** Add the round-trip test to CI: export → wipe → import → rebuild → deep-equal.
- **C4.5** Write C4 **before** the app is useful. The day it is needed, nobody wants to be debugging
  it.

### Exit criteria — Part C

- [x] Data survives a reload and an app restart — exercised for real from D2 onwards, and
      `tests/session.test.ts` writes a session, throws the view away and reads it back.
- [x] Dropping `engineState` and calling `rebuildState()` reproduces it exactly — `tests/rebuild.test.ts`, over the simulated year.
- [x] The round-trip test runs in CI and passes — `tests/round-trip.test.ts`, over the simulated
      year. The wipe is a database that never existed rather than one emptied through the code
      under test, which is both stricter and what a new phone actually looks like.
- [x] `grep -r dexie src/ --exclude-dir=db` returns nothing — enforced by `tests/db-boundary.test.ts` (C2.3).

---

# Part D — The session runner

**Goal.** The app becomes usable. **The owner starts training on it at the end of this part** —
everything after is improvement, not enablement.
**Prerequisites.** Parts B and C.
**Effort.** One weekend.

## D1 — Today, wired to the engine

- **D1.1** Replace the hardcoded rotation in `src/App.tsx` with the engine's prescription.
- **D1.2** Render: day of rotation, exercise name, pattern, weight, `5 reps per side × 3 sets`,
  why the weight is what it is, last session's result, Start. *(This sub-step said "load
  breakdown", meaning which plates to put on. The app has no plate inventory to draw one from and
  will not get one — see `lift-log-design.md` §6.5 and §14.6, and the note now added to §5. The
  slot holds today's weight against the weight actually lifted last time: one step up from 30 kg,
  same again after a short session, down from 32.5 kg after a deload. The comparison is a
  subtraction rather than a re-reading of the progression rules, so it cannot drift out of step
  with the number above it.)*
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

- **D4.1** Clean → "Next time: 35 kg", and how that compares to what was just lifted. *(Was "with
  the load breakdown" — same correction as D1.2.)*
- **D4.2** Missed → "Next time: 32.5 kg again."
- **D4.3** Third stall → "Next time: 30 kg" and say why — stuck for three sessions, and where the
  new number came from (B5.4). A statement, not a prompt: the engine has already dropped it
  (B5.3.1), and the weight is tap-to-edit if the athlete disagrees.

## D5 — Tap-to-edit (INV-7)

- **D5.1** Build one `<TapValue>` component: renders as text with a dotted underline; on tap swaps
  itself for a stepper in place; tapping elsewhere collapses it.
- **D5.2** Build one `<Stepper>` component with ≥ 42 px targets, used everywhere.
- **D5.3** Binary values do not get a stepper — they flip on tap.
- **D5.4** **On Today**, editable: the lift, the weight, reps, rest, the weak side. *(This said
  "reps × sets". Reps are editable here and survive a force-quit, because the target rides on
  every `SetLog` row. **Sets moved to the session screen** — "one more set" once the last one is
  logged, and finishing early is simply finishing. The alternative was a planned-sets field on the
  session row, which is the only way a *plan* survives a force-quit, and it would have been a
  second answer sitting beside the sets themselves with the power to disagree with them: seven
  logged sides cannot mean three sets, but a stored `plannedSets: 3` could say they did. What you
  did is a fact; what you meant to do is not one, and this app stores facts (INV-2).)*
- **D5.5** **On the session screen**, editable: the weight, the reps, which side you are on, and
  whether there is another set. Nothing else — mid-set is not a planning moment.
- **D5.6** Every edit writes a fact to the log and feeds the engine (B5.6).
- **D5.7** A one-line hint on Today: "Dotted underline means you can tap it." Discoverability is the
  known weakness of this pattern; pay the one line.

### Exit criteria — Part D

- [x] A full session can be completed and the weight moves correctly afterwards —
      `tests/session.test.ts`, over clean, short, walked-out and third-stall sessions. *On a
      phone* is the owner's to confirm; nothing here has been run on one.
- [x] Force-quitting mid-session and reopening resumes on the right side — the same test file
      does it by discarding the view and rebuilding it from the database, which is what a
      force-quit is. There is no resume code path to check: how far through a session you are is
      read off the sets logged (see the header of `src/session.ts`).
- [x] The rest timer shows the correct remaining time after the phone has been locked — by
      construction. Nothing counts down; `restAt` subtracts two instants, and the test asserts the
      answer after a simulated ten-minute lock. A real lock is the owner's to confirm.
- [x] Every value listed in D5.4 and D5.5 is editable in one tap — with one deviation, recorded
      at D5.4: the number of sets is editable on the session screen rather than on Today.
- [ ] **The owner has trained at least one real session on it.**

---

# Part E — History and progress

**Goal.** The log becomes visible. This is the part that makes the habit stick.
**Prerequisites.** Part D.
**Effort.** One weekend.

## E1 — History
- **E1.1** Calendar heat map, one cell per day, driven by `trainingDay`. *(Done. Weeks are rows
  and weekdays are columns — a wall calendar rather than GitHub's fifty-column strip, which needs
  horizontal room this app does not have. Four outcomes and no scale of effort: rested, walked
  out, short, clean, with "clean" coming from the engine's own `isClean` so a square cannot
  disagree with the weight the card prescribes. The window opens on the week of the first logged
  session, is never shorter than four weeks and never longer than 270, that last being a guard
  against one mistyped date in an imported file asking for fifty thousand squares. Days after
  today are holes rather than empty squares. Reached from a new `HISTORY` row on the Today card.
  Nothing on the screen is a streak.)*
- **E1.2** Reverse-chronological session list, tappable through to every set. *(Done. The list
  sits under the calendar on the same screen and comes out of the same read of the log — one
  row per session: the day, the lift, what was actually on the dumbbell, and how it went, with
  the deficit beside "short" because the word alone does not say whether it was one rep or ten.
  The outcome carries the calendar's own square, so a row and its day are visibly the same fact.
  The year is written once where it changes rather than on every row. Every session is listed,
  including one too old for the grid's 270-week window. Tapping a row opens the session down to
  every set, which is the only screen that shows the prescription beside the weight lifted, and
  only when the two differ.)*
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

*Part of F1 and F3.1 were pulled forward at the end of Part D, at the owner's request and on this
plan's own standing instruction — "ship export in Part C, not Part F; from Part D the data is
real". The bytes had existed since C4 with no button attached, which meant a real log with no way
to get it out. What exists now: a Back up screen reached from the Today card, Download backup
(JSON) and Download a spreadsheet (CSV), and `lastExportedAt` written only when the full backup
actually left the app. The rest of F1 and all of F2/F3/F4 are untouched.*

## F1 — Persistence and honesty
- **F1.1** Call `navigator.storage.persist()` once during onboarding; store the result. *(Called on
  every open of the shell and again on the Back up screen. It is idempotent and returns the
  standing answer, so there is nothing to store — asking is cheaper than remembering. Onboarding is
  still G.)*
- **F1.2** Read `navigator.storage.estimate()` for usage and quota. *(Not done.)*
- **F1.3** Show a plain storage-status block: stored on this device, installed yes/no, persistent
  granted/best-effort, usage, last backup. Do not hide it. *(Partly: the Back up screen shows
  persistent/best-effort, last backup and how many sessions would be lost, and says plainly that a
  browser can throw the log away. Installed and usage are still missing.)*

## F2 — Install nudge
- **F2.1** Detect iOS Safari not running standalone.
- **F2.2** Show a real screen with Share → Add to Home Screen instructions and the honest reason:
  Safari deletes a site's data after seven days without a visit; a home-screen app is exempt.
- **F2.3** On Android, use the `beforeinstallprompt` event.

## F3 — Backup nudge
- **F3.1** Track `lastExportedAt` in settings. *(Done. Written only after the JSON backup has been
  handed over — a cancelled share sheet does not count, and a CSV never does, because a spreadsheet
  cannot restore anything.)*
- **F3.2** After ~14 days or ~10 sessions without a backup, interrupt once with a dismissible
  full-screen step: one sentence, one large Download button.
- **F3.3** This is the highest-leverage item in the whole data story. Do not skip it.

## F4 — Import
- **F4.1** File picker → validate → confirm → replace → `rebuildState()`. *(Still to do, and it is
  the other half of the backup that now exists: the file can be written but not yet read back in.)*
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
- **G1.1** Ask **one number**: the smallest jump you can make. That is everything the engine needs.
  Do not build a plate inventory UI, and do not ask for a lightest weight — the weights that exist
  are the multiples of the step (B2.2.2). Say plainly on this screen that it is also how fast you
  progress: one step per clean session.
- **G1.2** Default all five starting weights to one step behind one button. They are
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
- **G3.1** Step size, rest length, units display, export/import, about, reset.
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
  append-only, why the step *is* the increment and the virtual target was dropped, why IndexedDB
  over localStorage, why no accounts, why web before native, why tap-to-edit over the alternatives.
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

# Part K — Later, nice-to-have *(open list)*

**Goal.** A holding pen for improvements that should not happen now.
**Prerequisites.** Varies by item. **Effort.** Varies by item.

Nothing here blocks v1, and nothing here should be pulled forward without the project owner saying
so. **This list is expected to grow** — items get added as they come up during the build, and are
promoted out when they are worth doing.

A standing principle for this part: **prefer a warning to a mechanism.** A warning that turns out
to be wrong is deleted and nothing in the log changes. A mechanism that turns out to be wrong has
been silently reshaping numbers for months, and the damage is already in the history. The engine
should be right about the few things it can actually know; everything it is guessing at belongs on
screen as a sentence, not in the code as a rule.

## K1 — Explain the number

Today shows a weight. The engine always knows how that weight was arrived at, but currently throws
the reason away and shows only the result. A number you cannot account for is a number you stop
trusting.

- **K1.1** Have the engine return the *provenance* of `currentKg` alongside it. The cases are
  already the branches of `applyOutcome`:
  - the starting weight from onboarding, never yet moved;
  - one step up, because the last session was clean at the weight below;
  - held, because a set came up short — with how many stalls have accumulated;
  - dropped, because of three stalls — with where the number came from, a real session six back or
    the fallback (`Deload.basis` already carries this);
  - set by hand, because the weight was overridden.
- **K1.2** Render it as one line under the weight on Today: "up from 26.5 — last session was clean",
  "held at 27.5 — 2 sets short last time", "dropped from 35 — stuck for three sessions".
- **K1.3** Keep it derived. The reason is recomputed from the log like everything else (INV-2) and
  is never a stored string.
- **K1.4** The same provenance drives the session detail screen in E1.3, so build it once.

## K2 — The warning area

One place on Today where the app says something is off, without changing anything. Every edge case
that would otherwise need a rule in the engine should be considered for this first.

- **K2.1** **Below the intended step.** The athlete overrode downwards and the jump from last
  session is smaller than `stepKg`. Say so; do not correct it.
- **K2.2** **Above the intended step.** Same, upwards.
- **K2.3** **The silent plateau.** The same weight completed clean several sessions running, with
  the target never reached because it is not loadable. This is B2.2.4's known hole, and the only
  item here that catches something the engine genuinely cannot see. The warning should lead
  somewhere — "your step may be finer than your plates allow, set it to 5?" — so that acting on it
  makes it stop.
- **K2.4** **Warnings must resolve or expire.** A warning that fires every session and is dismissed
  every session is furniture: people stop seeing it within a week, and then it cannot do its job on
  the day it matters — including K2.3, the one that matters most. Each warning either leads to a
  one-tap fix or stops firing. Do not let this area become where known-unfixed things go to be
  quiet.

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
| K · Later, nice-to-have | varies | — |

## Standing instructions for whoever builds this

- **Do B before any UI.** It is the only genuinely hard part and the one most likely to change.
- **Ship export in Part C, not Part F.** From Part D the data is real.
- **Do not add a setting to resolve a disagreement.** Bring it to the project owner instead.
- **If an invariant is in the way, say so.** Do not quietly work around it — several of them are
  one-way doors and the cost of breaking one is not visible from inside the code.
