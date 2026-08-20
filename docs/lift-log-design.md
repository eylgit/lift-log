# Lift Log — Product & Engineering Design

> A free, offline-first, open-source strength training app that runs the "one lift a day"
> method end to end: it tells you today's lift and the exact weight, logs every set as you
> do it, and computes what you lift next time.

**Shape:** web app first (installable PWA, no app store). Native app later via the same codebase.
**Status:** design document, pre-code.
**Settled:** Blueprint palette, single, no theme switching · tap-to-edit interaction · remaining
open decisions live in the day-zero pre-flight list.
**Method credit:** *Soliday / One Lift a Day* by Scott Chen — <https://onelift.org/>. Lift Log is
an independent implementation. See [§16 Attribution](#16-attribution-and-honesty).

---

## 1. The method, in one page

**Five exercises, one per day, rotating.** Each covers one fundamental movement pattern.

| Day | Exercise | Pattern |
|-----|----------|---------|
| 1 | Bulgarian Split Squat | Squat |
| 2 | Single-Arm Shoulder Press | Vertical push |
| 3 | Single-Leg Deadlift | Hip hinge |
| 4 | Single-Arm Bench Press | Horizontal push |
| 5 | Single-Arm Row | Horizontal pull |

Day 6 goes back to Day 1.

**Each session: 5 reps per side, both sides back to back = one set, 3 sets, same weight
throughout.** Weak side first. **5 minutes rest between sets**, none between the two sides.
Fifteen to twenty minutes total.

> The source guide also rests 2–5 minutes *between the sides*. Grouping them gives each side the
> same ~10 minutes of recovery with fewer interruptions, so this project takes the grouped
> version. Hardcoded for v1; a setting later.

**Progression:** all three sets clean → add weight next time. Missed any set → repeat the
weight. Stuck for several sessions → **deload** to a weight from 3–6 weeks ago and climb
again; you come back through the old number and past it.

**Increment:** about **2.5 kg**, or **1.25 kg for the shoulder press**. If your plates can't
make that jump, skip increments so the *average* stays near 2.5 kg per session.

**Two hard rules:** never train by feel — the log decides the weight. Never train to failure —
every set ends with 1–2 reps in the tank.

Start absurdly light. Equipment is one loadable dumbbell and a chair. Outside the app's
scope but part of the method: sleep enough, eat 1.6–2.2 g protein per kg bodyweight.

---

## 2. What Lift Log is

Open it, and it tells you today's exercise and the exact weight. Tap after each set. It
works out next session's weight. No account, no network, no ads.

The product has exactly one job: **remove decisions.** That is the filter for every feature
request. If something adds a decision the user must make before or during a workout, it
needs an extremely good reason to exist.

### Design principles

1. **Zero decisions before training.** The home screen is one card: today's lift, today's
   weight, Start.
2. **The log is the truth.** Every set you tap is a permanent fact. The suggested weight is
   *derived* from those facts, never stored as an opinion.
3. **Local first, always.** Works in airplane mode in a basement.
4. **Your data is yours, and it survives.** See §9 — this is the hardest promise to keep on
   the web, and most of the engineering goes here.
5. **Boring on purpose.** The method works through monotony. Don't fight that with novelty.

### What it deliberately is not

Not an exercise library. Not a social feed. Not a volume/RPE tracker. Not a nutrition app.
Not an account service. Not exciting. Saying no to these is a feature — and it is what makes
the project finishable.

---

## 3. Why this actually solves the problem

The method's own diagnosis is that people don't quit training because they're lazy or
ignorant. They quit because **the total cost is too high**, and the cost has four parts. The
app's job is to attack the two the method can't fully solve on its own.

| The failure mode | What the *method* does about it | What the *app* does about it |
|---|---|---|
| **Time cost** — commute, changing, waiting for equipment, showering. Forty minutes of training costs two hours. | Train at home, one dumbbell, 15 minutes. | Nothing — but it must not *add* time back. No login, no splash, no loading spinner, no sync wait. Cold start straight to today's lift, offline, in under a second. This is a real performance requirement, not a nicety. |
| **Mental cost** — deciding what to train, how many sets, how heavy. Decision fatigue burns willpower before you've lifted anything. | Fix the exercise list and the rotation so there's nothing to choose. | Removes the *last* decisions the method leaves behind: which lift is today, how heavy, which side first, how long to rest. The home screen takes zero inputs. |
| **Fatigue cost** — people believe training must be gruelling, wreck themselves, dread the next session, stop. | 5 reps, never to failure, full rest, ~15 minutes. | Actively enforces restraint. Three sets and the session ends. There is no "add another set" button. The rest timer defaults long. The app is the thing that tells you to stop. |
| **No progressive overload** — grabbing a weight that "feels about right", never increasing it, mistaking sweat for progress. | +2.5 kg whenever the work was clean. | **This is the entire engine.** The weight goes up because the log says it should, not because you feel strong today. |

And underneath all four sits the real killer, which the guide names precisely:

> **Stagnation without awareness.** Not injury, not lack of time. You've been at the same
> weight for three months and you don't know it, because you're going by memory and feeling.

That is a *measurement* failure, and measurement is the one thing software is unambiguously
better at than a human. The log is the sensor; the chart makes self-deception impossible.

### Why an app and not a paper notebook

Be honest about this, because the answer constrains the scope. The method works fine with a
notebook. An app is worth building only if it beats paper at three specific things:

1. **It removes the arithmetic.** "Target is 27.5 but my plates only make 25 or 30, and the
   method wants an average of +2.5 per session" is genuinely fiddly to do in your head at
   6 a.m. before coffee. (See §6.2.)
2. **It makes logging automatic.** A notebook requires a separate act of will after every
   set. A tap during the rest you're taking anyway does not.
3. **It draws the chart.** The sawtooth curve of your own progress is the single most
   motivating object in the whole system, and nobody plots it by hand.

**Corollary, and it's a useful knife:** any feature that doesn't serve one of those three, or
reduce a decision, should be cut. That test kills most of what a fitness app would normally
accumulate.

---

## 4. The idea that shapes the whole build

The method is a **feedback control loop** — the guide says so outright.

```
                 replays all history
  ┌── Set log ─────────────────────────► Progression engine ──┐
  │  (append-only facts)                 (pure function)      │
  │                                                           │ applies rules
  │                                                           ▼
  └──── Today's session ◄──────────────────── Prescription
          (you train)         prescribes      (exercise + weight)
```

Sensor = the log. Controller = the engine. Actuator = the weight on the dumbbell.

Two consequences drive most technical decisions:

**Storage is an append-only log of facts.** A set was done or it wasn't. You never *update*
"current weight" — you compute it. Fix a bug in the engine and the whole history re-derives
correctly. That is not true if current weight is mutable state.

**The interesting logic is platform-free.** `(history, equipment) → prescription` contains no
database, no UI, no browser. It lives in its own folder, is tested in milliseconds, and can
be read end to end by a stranger in ten minutes. It also **never changes when you port to
native** — which is the whole reason the web-first plan in §8 works.

---

## 5. Features

### Onboarding — once, under two minutes
Units. Equipment (see §14.6 — ask two numbers, not a plate inventory). A starting weight per
exercise, with a hard push to start light. Weak side per exercise. Then: **install to home
screen**, which is a data-safety step, not a nicety (§9.2).

### Today — the home screen
One card: day of rotation, exercise name, weight, `5 reps per side × 3 sets`, the plate breakdown,
last session's result, a Start button, and which side goes first.

### How anything gets changed

One rule across the app: **a dotted underline means you can tap it, and tapping turns that value
into a stepper exactly where it sat.** Binary values (the weak side) skip the stepper and simply
flip. On Today that covers the lift, the weight, reps × sets, rest and the weak side. On the
session screen it is deliberately narrowed to the weight, the reps and which side you are on —
mid-set is not a planning moment. Every manual change is written to the log as a fact, so the
engine progresses from what you actually did rather than from what it prescribed.

### Session runner
One set on screen at a time. `Set 1 of 3 · LEFT · 5 reps @ 32.5 kg`, a single large **Done**
button, a smaller **Missed reps** behind which sits a 0–4 picker, three progress bars. The
session persists continuously — close the tab mid-workout, come back, resume on the exact set.

### Rest timer
Starts on its own when a set is logged. 2–5 minutes, configurable. "Rest longer" is a
first-class button, not a failure state. **Compute remaining time from a stored timestamp,
never a running interval** — see §10.2 for why this is more constrained on the web than it
looks, and why it matters less than you'd think.

### Session summary
All clean → "Next time: 35 kg" with the plate breakdown. Missed something → "Next time:
32.5 kg again." Third stall → the deload prompt: *"You've been stuck at 32.5 kg for three
sessions. Drop to 25 kg and climb back — you'll come through this number."*

### History and progress
Calendar heat map, one square per day. Chronological list down to every set. Manual backfill.
The **per-exercise sawtooth chart** — the most motivating screen in the app. An estimated-1RM
line under it (Epley: `weight × (1 + reps/30)`). Personal-best markers.

### Data
Export to JSON and CSV. Import to restore. A visible, honest storage-status readout. All of
§9.

### Habit support, kept minimal
Streak, sessions this month. **Missing a day creates no debt** — the rotation is a position
pointer, not a calendar. Skip Tuesday and Wednesday's workout is simply the next lift. There
is no "you owe 2 sessions" screen, ever. Guilt is friction, and friction is the enemy.

### Explicitly not v1
Pull-up plan · three-lift days · barbell plans · daily reminder notifications (§10.1) ·
watch apps · Apple Health · localisation.

---

## 6. The progression engine

Roughly 300 lines, and effectively the entire product. Build it before any UI.

### 6.1 The problem discrete plates create
The method wants +2.5 kg per session. Your plates might only make 5 kg jumps. Rounding up
progresses you twice as fast as intended; rounding down never progresses you at all.

### 6.2 The fix: a virtual target, clamped to reality

Two numbers per exercise:
- **`target`** — a real number. The ideal cumulative load. Rises by the full increment after
  every clean session, regardless of what your plates can do.
- **`prescribed`** — the heaviest weight your equipment can actually build that is ≤ `target`.

Rungs at 20, 25, 30, 35, 40 kg; increment 2.5 kg:

| Session | target | prescribed | what you experience |
|--------:|-------:|-----------:|---------------------|
| 1 | 20.0 | 20 | |
| 2 | 22.5 | 20 | same weight again |
| 3 | 25.0 | 25 | +5 kg |
| 4 | 27.5 | 25 | same weight again |
| 5 | 30.0 | 30 | +5 kg |

Average: exactly 2.5 kg per session. The user never sees the arithmetic, never gets a
suggestion they can't load, never decides anything. Buying 1.25 kg micro-plates then pays off
immediately, with no code change.

### 6.3 The rules

| Outcome of a session | Engine's response |
|---|---|
| All 3 sets clean on both sides | `target += increment`; `stall = 0` |
| Any set short of 5 reps | `target` unchanged; `stall += 1` |
| `stall` reaches 3 (fixed) | Propose deload → on accept, `target =` the target from **6 sessions of this exercise ago**; `stall = 0` |
| User overrides the weight by hand | Record it as a fact; `target =` what they actually used |

The deload rule *reads the log* rather than doing arithmetic — "go back four weeks" resolves to
a weight you actually used, which is what the method prescribes and is more honest than a
percentage. Count it in **sessions of that exercise, not calendar days**: after a two-week break,
28 calendar days back might be only two sessions, which makes the deload far too shallow. Six
sessions is roughly four weeks when you are consistent, and still correct when you are not. Fall
back to `target × 0.85` when there is less history than that.

Each exercise comes round every five days, so three consecutive stalls is about a fortnight
of being stuck — the right amount of patience.

### 6.4 The weak side governs
Set order: weak → strong → weak → strong → weak → strong. If the weak side misses and the
strong side doesn't, **the session counts as incomplete.** Correcting that imbalance is the
whole reason for training unilaterally.

### 6.5 Weight ladders
Everything downstream consumes a **ladder**: a sorted list of achievable weights. Where it
comes from depends on equipment:

- **Simple (v1 default):** `min` and `step` → `min, min+step, min+2·step, …`. Two numbers.
- **Adjustable dumbbell:** `min`, `max`, `step`.
- **Fixed dumbbells:** an explicit list.
- **Loadable bar (v2):** `B + 2C + 2 × (any sub-multiset sum of your one-side plates)` — a
  bounded subset-sum. Inventories are tiny (≈8 masses, ≤6 pairs), so one dynamic-programming
  pass builds the whole ladder instantly. Cache it, and store one canonical plate combination
  per rung so you can render "per side: 10 + 2.5" with a picture.

Same interface either way, so nothing downstream cares which kind of equipment you own.

### 6.6 Edge cases that must be handled
- Target below the lightest rung → prescribe the lightest, don't error.
- Empty history → prescribe the onboarding start weight.
- Session abandoned halfway → mark abandoned, count incomplete, don't advance the target.
- Pounds: store kg internally, convert only for display, and give lb users lb-native
  increments (5 lb / 2.5 lb) rather than the ugly conversion of 2.5 kg.
- "What day is it": local date with a 3 a.m. cutoff, so a midnight session counts for the day
  it felt like. Never derive the training day from UTC.
- Two-dumbbell variants: track load *per hand*, display the total. A per-exercise flag.

---

## 7. Data model

Three stores. In the browser these are IndexedDB tables (§9.1); in the native app they're
SQLite tables. Same shape, same code above them.

```
exercise      id, name, pattern, incrementKg, videoQuery
equipment     kind, minKg, stepKg, maxKg, platesJson
settings      units, restTargetS, stallThreshold, lastExportedAt, schemaVersion

session       id, exerciseId, startedAt, finishedAt, trainingDay,
              prescribedKg, actualKg, status, note
setLog        id, sessionId, ordinal, side, targetReps, doneReps, loggedAt

engineState   exerciseId, targetKg, stallCount, weakSide     ← CACHE ONLY
```

`session` and `setLog` are append-only and are the truth. `engineState` is a derived cache
with a `rebuildState()` that drops it and replays the entire log through the engine. Call it
after every import and every migration, and exercise it in tests.

**The architectural test:** if you can delete a table and rebuild it exactly from the log, the
architecture is honest. A few hundred sessions a year replays in under a millisecond — no
snapshots, no incremental anything.

**Size, so you stop worrying about the wrong thing:** 5 sessions/week × 6 logged sides × ~80 bytes ≈
**125 KB per year**. You will never approach a storage quota. The risk is deletion, not size.

---

## 8. Tech stack — web first, native later

### 8.1 The one rule that makes this work

Everything hinges on keeping browser-specific code in two small folders:

```
src/
  engine/     pure TypeScript. no browser APIs, no I/O.       ← never changes when you port
  db/         a repository interface + a Dexie implementation ← swap for SQLite natively
  platform/   notifications, wake lock, file save, share      ← swap per platform
  ui/         screens and components                          ← unchanged
```

Only `db/` and `platform/` know they're in a browser. That is the difference between "wrap it
in Capacitor over a weekend" and "rewrite it."

### 8.2 The stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | one language everywhere, and the engine is worth typing properly |
| Build | Vite | instant dev server, trivial config, first-class PWA plugin |
| UI | React | you'll know it; keeps a later React Native option open even though Capacitor makes it unnecessary |
| Routing | React Router | four screens; nothing exotic needed |
| Storage | **Dexie** over IndexedDB | pleasant API, and **versioned migrations built in** — see §14.3 |
| PWA | `vite-plugin-pwa` (Workbox) | offline app shell + install manifest in ~10 lines of config |
| State | Zustand | the in-progress workout is the only real client state |
| Charts | hand-written SVG | a sawtooth line and a heat map. A charting library is more code than the chart. |
| Styling | plain CSS with custom properties | it's four screens; a design system is overhead |
| Tests | Vitest + fast-check; Playwright for one E2E | fast property-based engine tests, thin UI tests |
| Hosting | Cloudflare Workers (static assets) or GitHub Pages | free, HTTPS (required for service workers), matches the open-source story |
| **Later: native** | **Capacitor** | wraps the *same web build* for iOS and Android. Not a rewrite. |

### 8.3 Considered and deferred

- **SQLite in the browser** (wa-sqlite / SQLocal over OPFS). Elegant — the same SQL would run
  in the browser and later in native SQLite. But it's heavier, newer, and Safari's OPFS
  support is recent. **Choose boring for v1.** The repository interface means you can switch
  later without touching the engine or the UI.
- **Expo / React Native.** Better native feel and real local notifications, but it's an app-
  store-first path and you explicitly want a web app now. Capacitor gets you to the store
  later from the code you've already written.
- **Svelte / SvelteKit.** Genuinely a better fit for something this small. Pick it if you'd
  enjoy it; React is the safer portfolio signal.

### 8.4 The path to the App Store, when you want it

1. `npm i @capacitor/core @capacitor/cli && npx cap init && npx cap add ios android`
2. Swap the `db/` implementation for `@capacitor-community/sqlite`. The interface doesn't
   change; the engine and UI don't know.
3. Swap `platform/` notifications for `@capacitor/local-notifications` — and **now you get
   real scheduled reminders**, which the web version can't do (§10.1).
4. Ship. Data now lives in the app sandbox, backed up to iCloud / Google Drive automatically,
   with no browser eviction rules at all (§9.2).

Realistic effort if `db/` and `platform/` were kept clean: a weekend or two, mostly spent on
store listings and screenshots rather than code.

---

## 9. Saving the data — and not losing it

This is the part of a web app that most people get wrong, and for a training log it's
existential. A log's value grows with its age. Losing year two doesn't cost you a file; it
costs you the habit.

### 9.1 Where the data actually lives

| Option | Verdict |
|---|---|
| **`localStorage`** | Only for tiny preferences. It's synchronous (blocks the UI thread), capped around 5 MB, strings only, and has no indexes. Never put the log in it. |
| **IndexedDB** | **Yes.** Asynchronous, structured, indexed, hundreds of MB of quota, works offline, supported everywhere. Use Dexie so you get a sane API and versioned migrations. |
| **OPFS + SQLite** | Real SQL in the browser. Powerful, and the natural upgrade path — but newer. Deferred (§8.3). |
| **A server** | Not for storage. For *backup* — see level 4 below. |

### 9.2 Three different things can delete your data

They need three different answers. Don't conflate them.

**Threat 1 — the browser evicts you to reclaim disk space.**
Fix: `navigator.storage.persist()`. It asks the browser to mark your data as persistent so
it won't be cleared under storage pressure. Chrome grants it silently based on heuristics
(installed as an app, bookmarked, high engagement, notification permission granted); Firefox
prompts; Safari's behaviour differs and has changed between versions. So: feature-detect it,
call it once during onboarding, **store whether it was granted, and show that state to the
user honestly.** Never assume it succeeded.

```js
const persisted = navigator.storage?.persist
  ? await navigator.storage.persist()
  : false;
// also useful, and reassuring: navigator.storage.estimate() → {usage, quota}
```

**Threat 2 — Safari's seven-day rule.** This is the one that catches people out. iOS and
macOS Safari cap *all script-writable storage* — IndexedDB included — at seven days without
first-party interaction. Don't open the site for a week and it's gone. For a daily habit app
the counter usually keeps resetting, but a two-week holiday would wipe a year of training.

The mitigation is that **web apps installed to the Home Screen are outside Safari's counter.**
That single fact reshapes the onboarding: "Add to Home Screen" is not a nicety or an
engagement tactic, it is **the data-safety step**, and it deserves a real screen with real
instructions (iOS gives you no install prompt — you have to draw the Share → Add to Home
Screen flow yourself).

Treat Apple's behaviour as *probably true and fine to rely on for convenience, never for
safety*. Verify on your own device, and re-verify when iOS majors ship. Which leads to:

**Threat 3 — the user, or the OS, clears site data.** "Clear History and Website Data", a
privacy cleaner, a new phone, a reinstalled browser, a wiped profile. **Nothing you can do in
a browser survives this.** There is no API that prevents it and there shouldn't be.

So state the conclusion plainly:

> **Browser storage cannot be the only copy of a log you intend to keep for years.**

The interesting design question isn't how to make IndexedDB indestructible — it isn't. It's
how to get a second copy without building an account system.

### 9.3 The durability ladder

Build these in order. Each one is cheap and each one meaningfully reduces the chance you lose
your training history.

**Level 0 — an export button, from day one.** JSON download, always available, ten lines of
code. Necessary, and by itself insufficient, because nobody ever clicks it.

**Level 1 — request persistence and push the install.** Call `persist()`. Teach Add to Home
Screen properly. Then show an honest little status block instead of hiding it:
`Stored on this device · persistent storage: granted · last backup: 3 days ago`.

**Level 2 — a backup nudge with teeth.** Track `lastExportedAt`. After ~14 days or ~10
sessions without a backup, interrupt once with a full-screen, dismissible step: one sentence
and one big Download button. **This is the highest-leverage thing you will build in the whole
data story,** and it's an afternoon's work.

**Level 3 — automatic file backup where the platform allows.** On desktop Chrome and Edge,
the File System Access API can hold a handle to a real file and rewrite it after every
session with a single one-time permission. Not available on iOS. Treat as a bonus, not a plan.

**Level 4 — a tiny sync server, when you want one.** This is the real answer, and it does not
require an account system:

- One table: `(syncId, blob, updatedAt)`.
- `syncId` is a random 128-bit key generated on the device, shown to the user once as a
  recovery phrase or QR code. That's the whole "auth" story.
- Push the entire document after each session; last-write-wins on the whole blob. For a
  single-user log of a few hundred KB, that is genuinely sufficient — **do not build CRDTs.**
- Encrypt the blob client-side with a key derived from the phrase if you want the
  "we literally cannot read your data" property. It's a nice line in a README.
- Cloudflare Workers + D1, or Supabase. Free tier. Maybe 150 lines.

**Level 5 — go native.** Once wrapped in Capacitor, data lives in the app's sandbox: iOS backs
it up to iCloud, Android to Google Drive, automatically, and no browser eviction rule applies.
**This is the strongest argument for the native path beyond distribution** — it's the point at
which "don't lose my data" stops being your problem and becomes the OS's.

### 9.4 Two rules about the export format

Write the exporter **before the app is even useful**, and add a round-trip test (export →
wipe → import → `rebuildState()` → identical) to CI. The day you need it, you will be
panicking and you will not want to be debugging it. Make the JSON human-readable and
self-describing — include a `schemaVersion` and an ISO timestamp at the top — because in five
years the most likely reader is a script you haven't written yet.

---

## 10. What the web version genuinely can't do well

Be honest about these up front; two of them should change your v1 scope.

### 10.1 Scheduled local notifications — don't build them
There's no reliable way to make a web app buzz at 7 a.m. tomorrow without a push server, and
on iOS, Web Push requires the PWA be installed and the OS be recent. The Notification Triggers
API that would have solved this never shipped broadly.

**Recommendation: cut daily reminders from v1 entirely.** Put one line in onboarding — "set a
recurring alarm on your phone for the time you want to train" — and save yourself a backend, a
push service, VAPID keys, and a permission prompt that most users decline anyway. Real
reminders arrive free when you wrap in Capacitor (§8.4).

### 10.2 The rest timer while backgrounded
If the phone locks, your JavaScript stops. Three mitigations, in order of usefulness:

1. **Always compute elapsed time from a stored timestamp,** so whenever the page wakes up the
   number is correct rather than frozen. Do this regardless of platform.
2. **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) keeps the screen on
   during a session. Well supported now, and it's the right behaviour anyway.
3. An audible alarm works if the tab is alive and audio was unlocked by a user gesture.

And then the relieving part: **the method doesn't actually need a timer.** Because you
alternate sides, each side naturally gets four to five minutes of rest, and the guide says
outright that you don't need to time anything. So demote the timer from "core feature" to
"helpful readout" and the web platform's weakest area stops mattering.

### 10.3 iOS install friction
No install prompt exists on iOS; you must detect iOS Safari and draw the Share → Add to Home
Screen instructions yourself. Since install is what protects the data (§9.2), this unglamorous
screen matters far more than it looks.

### 10.4 What the web does *better*
Worth saying, because it's why this is the right first move: no review queue, no developer
account, no build signing, no update lag. You can ship a fix between sets. A recruiter clicks
a link instead of installing something. And you can be using it on yourself the same week you
start.

---

## 11. Testing strategy

Tests go where the logic is. UI tests stay thin on purpose.

**Unit** — every rule in §6.3, every edge case in §6.6, every ladder kind.

**Property-based** (fast-check) — the ones worth showing off:
- For any equipment config, `prescribe(target)` is always in the ladder and always ≤ target,
  unless target is below the minimum.
- `target` is monotonically non-decreasing except immediately after a deload.
- Over N clean sessions, `(final − initial) / N` converges on the increment.
- Every rung's plate combination actually sums to that rung.

**Simulation** — model a virtual lifter whose capacity grows on a fixed curve, run 365
simulated days through the real engine, assert that deloads fire, each cycle's peak exceeds
the last, and the final weight beats the start. Render it as a chart and put it in the README:
it is a test *and* the best explanation of the method you could paste into a repo.

**Round trip** — export → wipe → import → `rebuildState()` → identical. In CI (§9.4).

---

## 12. The repository as a deliverable

The code being good is necessary and not sufficient. The repo has to be legible to someone
who gives it ninety seconds.

- **README:** a ten-second GIF of a real session in the first screenful. Then the method in
  five lines, what the app does, the simulation chart, and **a link to the live app** — which
  the web-first choice gives you for free.
- **`docs/adr/`** — short architecture decision records: why append-only, why the virtual
  target, why IndexedDB over localStorage, why no accounts, why web before native. Four or
  five paragraphs each. The cheapest, highest-signal way to show engineering *judgement*
  rather than just output.
- MIT licence, CONTRIBUTING, issue templates, Conventional Commits, a real CHANGELOG, tagged
  releases, screenshots, and a plain health disclaimer.

---

## 13. Build order

Ordered so you're using it on yourself as early as possible. Dogfooding is what will make you
finish — and "I've trained with this for eight months, here's my curve" beats any code sample.

| Milestone | What lands | Effort |
|---|---|---|
| **M0** Skeleton | Vite + TS + PWA manifest + service worker, deployed to Pages, **installed on your own phone's home screen day one** | an evening |
| **M1** Engine | Types, ladder, progression, deload, full test suite. No UI at all. | a weekend |
| **M2** Session runner | Today card, set logging, Dexie persistence, **and the export button** — then start training on it | a weekend |
| **M3** History | Calendar heat map, session detail, the sawtooth chart | a weekend |
| **M4** Equipment | Ladder settings, kg/lb, manual override | a few evenings |
| **M5** Durability | `persist()`, install nudge, storage status, backup reminder, import + round-trip test | a weekend |
| **M6** Ship | README + GIF, ADRs, licence, v1.0 tag | a weekend |
| **M7** *(later)* Sync | The 150-line backup endpoint from §9.3 level 4 | a weekend |
| **M8** *(later)* Native | Capacitor wrap, SQLite, real notifications, store listings | a weekend or two |

**Do M1 before any UI.** It de-risks the only genuinely hard part, it's what you'll most want
to change your mind about, and it makes everything after it wiring.

Note that **export moves into M2**, earlier than feels necessary. That's deliberate: from the
moment you start training on it, the data is real.

---

## 14. Before you write a line — the concerns list

Roughly ordered by what actually kills projects, not by what's technically interesting.

**14.1 Scope is the whole game.** The failure mode is not "the algorithm was hard." It's a
beautiful settings screen, three theme options, and no working session runner in month four.
**The "not doing" list in §2 is the plan.** Re-read it whenever you're tempted.

**14.2 Data loss is existential, not a bug.** Covered in §9. The one-line version: build the
export in week one, and never let browser storage be the only copy.

**14.3 Schema migrations from day one.** By week three your own real training data is in
there and you will absolutely refuse to wipe it to change a field name. Dexie versions make
this nearly free; not having them makes it agony. Put a `schemaVersion` in the export too.

**14.4 Decide units now.** Kilograms internally, always, everywhere, including in the export.
Convert only at the moment of display. Retrofitting this is miserable.

**14.5 Decide time handling now.** Store a UTC ISO timestamp *and* a separate `trainingDay`
string like `2026-08-19`, computed from local time with a 3 a.m. cutoff. Never derive the day
from the UTC date — you will get a bug that only appears for people who train late, or who
travel, and it will be confusing.

**14.6 The equipment screen is where onboarding goes to die.** Plate inventory is the most
complex UI in the app and it's the *first* thing a new user meets. **For v1, ask two numbers:
the lightest weight you can load, and the smallest jump you can make.** That's a complete,
correct ladder (§6.5) and it's two text fields. Plate pictures are a v2 luxury.

**14.7 You are one user, and you'll build for imaginary ones.** Every setting you add is a
decision you've handed back to the user — which is precisely the thing the app exists to
remove. When in doubt, hard-code it and see if it ever bothers you.

**14.8 Decide now what happens when the suggestion is wrong.** Sooner or later you'll be ill,
or travelling, or the dumbbell won't go that low. You need a manual override that is easy,
explicit, and feeds back into the engine *as a recorded fact* rather than quietly corrupting
the target. Design it deliberately — an override bolted on later is where the engine's
invariants go to die.

**14.9 The physical context is the real design constraint.** You'll be sweaty, breathing hard,
phone on the floor at arm's length, possibly one-handed, possibly in a dim room, definitely
not wearing reading glasses. Huge tap targets, huge numerals, high contrast, no small text, no
precise gestures, nothing that needs two hands. Most fitness apps are designed at a desk and
you can tell.

**14.10 Offline from day one, not later.** Service worker in M0. Bolting caching on afterwards
is where the genuinely maddening bugs live — and a PWA that shows a network error mid-workout
has failed at the one thing it promised.

**14.11 Don't build auth. Don't build analytics.** Both contradict the promise in §2, both eat
weeks, and neither makes the app better at its job. If you eventually want usage numbers, say
so in the README and make it opt-in.

**14.12 Performance is a feature here, not a vanity metric.** §3 says the app must not add
time cost back. Set yourself a real budget — cold start to Today screen in under a second on
your own phone, offline — and check it occasionally. It's easy to hit and easy to lose.

**14.13 Train with pen and paper for two weeks first.** Genuinely. It costs nothing, you'll
start getting stronger immediately instead of in six weeks, and you'll discover the real
requirements — how often you actually miss reps, whether you care about the timer, what you
want to see afterwards — before you encode guesses about them.

**14.14 A half-finished ambitious repo reads worse than a finished modest one.** For the
portfolio half of this project, scope discipline *is* the signal. A small app that's clearly
complete, tested, documented and actually used says far more than an impressive skeleton.

**14.15 Housekeeping.** Check the name is free (App Store, Play Store, GitHub, npm). Add a
plain health disclaimer. Credit Scott Chen — §16.

---

## 15. Why this works as a portfolio piece

- **It has a real algorithmic core.** Most portfolio apps are CRUD with a nice theme. This one
  has a control loop, a bounded subset-sum, and derived-state-from-an-event-log — all small
  enough to read, all genuinely necessary rather than bolted on.
- **The hard problem is one most web developers duck.** "Where does the data live and how do I
  stop losing it" (§9) is a question with real depth, and having a considered, written answer
  to it is unusual and immediately legible to a senior reviewer.
- **It's testable in a way you can show.** Property-based tests and a year-long simulation are
  rare in a personal project.
- **A reviewer can click a link.** Web-first means the demo is the app.
- **It has a real user with real requirements: you.** Every decision above has a "because
  otherwise I'd stop using it" behind it, and that shows in a way invented requirements never do.
- **It proves itself.** Eight months in, your own progress chart is the demo.

---

## 16. Attribution and honesty

The training method belongs to Scott Chen, published at <https://onelift.org/>, and he has his
own app for it (**Soliday**).

- **Methods, facts and ideas aren't copyrightable — his article text, his app name and his
  branding are.** Implement the method; write every word of your own copy; design your own
  interface; don't reuse the name Soliday or anything resembling it.
- **Credit prominently** in the README and an in-app About screen, both linking to onelift.org:
  *"Lift Log is an independent open-source implementation of the One Lift a Day method by
  Scott Chen."*
- **Tell him.** Worst case he ignores it; best case you get feedback from someone who has
  studied this for twenty years.
- **Check the name** before committing to it.
- **Add a health disclaimer** — "this is a training log, not a doctor; lift at your own risk;
  see a professional if something hurts" — in the README and in About.
