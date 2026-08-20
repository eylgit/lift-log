# Lift Log

**One lift a day.** A free, offline-first, open-source strength training log.

Five exercises, one per day on a five-day rotation. Five reps per side, both sides back to back
as one set, three sets, five minutes rest between sets. Finish cleanly and the app adds weight
next time. Stall three sessions running and it walks you back four weeks so you can climb through
your old ceiling.

No account. No network required. No ads. Your log lives on your device and exports to a file you
can read.

> **Method credit.** The training system is *One Lift a Day* by Scott Chen — <https://onelift.org/>.
> Lift Log is an independent open-source implementation of that method, not affiliated with it.

> **Not medical advice.** This is a training log, not a doctor. Lift at your own risk, and see a
> professional if something hurts.

---

## Status

**Live at <https://lift-log.green-sun-5a13.workers.dev/>** — installable to a home screen and
works offline. There is no progression engine and no session runner yet: the Today screen renders
a fixed rotation.

Work is staged in ten parts. Each is self-contained and ends with a checklist to review before the
next one starts. The full plan, with numbered steps, is
**[`docs/lift-log-build-plan.md`](docs/lift-log-build-plan.md)**.

| | Part | State |
| --- | --- | --- |
| **A** | Repository and deployment | in progress |
| **B** | Progression engine — pure TypeScript, no UI | next |
| **C** | Persistence — IndexedDB, replay, export/import | |
| **D** | Session runner — *usable from here* | |
| **E** | History and progress | |
| **F** | Durability — persist, install nudge, backup nudge | |
| **G** | Onboarding and sample data | |
| **H** | Ship v1.0 | |
| **I** | Sync backup | optional |
| **J** | Native apps via Capacitor | optional |

The plan opens with **ten invariants** (INV-1 to INV-10) — decisions that are cheap to honour and
expensive to reverse. Read those before changing anything. The reasoning behind them is in
[`docs/lift-log-design.md`](docs/lift-log-design.md).

## Running it

Requires **Node 20 or newer** (Node 18 lacks a global `crypto`, which the PWA build needs).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the built app, service worker and all
```

> **If `npm install` fails with an `EPERM`/symlink error**, you are almost certainly working
> inside a VirtualBox shared folder, which cannot create the symlinks npm puts in
> `node_modules/.bin`. Clone the repo onto the VM's own filesystem (`~/lift-log`) and work there,
> or run `npm install --no-bin-links` and invoke tools directly
> (`node node_modules/vite/bin/vite.js build`).

## Deploying

The build output is a static folder — any static host will do, and the free tiers are permanent.

**Cloudflare Workers** (recommended: served from the root path, which keeps the PWA config simple).
`wrangler.jsonc` in the repository root describes an assets-only Worker that serves `dist/`.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | set in `wrangler.jsonc`, not in the dashboard |
| Node version | 20 or newer |

**GitHub Pages** serves from `/<repo>/`, so the base path has to match:

```bash
BASE=/lift-log/ npm run build
```

The `base` in `vite.config.ts` reads that environment variable and feeds it to the manifest's
`start_url` and `scope` as well. Getting this wrong is the single most common reason a PWA fails
to install.

> **The origin is part of your data.** Browser storage is scoped to the exact origin, so moving
> from the `workers.dev` URL to your own domain later strands every existing log on the old one.
> Pick the URL you intend to keep before there is data in it.

## Layout

```
src/
  plan.ts          the five-day rotation, the scheme, and the training-day rule
  App.tsx          the Today screen
  styles.css       the Blueprint palette — one theme, deliberately
public/            icons and the manifest's static assets
docs/
  lift-log-build-plan.md    the staged plan: parts, steps, exit criteria, invariants
  lift-log-design.md        the design: what it is, why, and how the engine works
```

## Invariants worth knowing before you read the code

The full list is in the [build plan](docs/lift-log-build-plan.md); these are the ones that will
bite you first.

- **The log is the truth.** Sessions and sets are append-only facts; the suggested weight is
  derived by replaying them, never stored as an opinion. Deleting a session writes a tombstone.
- **Kilograms everywhere**, in the database and in the export. Conversion happens at display only.
- **Training day is its own field** — a local date with a 3 a.m. cutoff — never derived from UTC.
- **Tap the value to change it.** A dotted underline means editable; the value becomes a stepper
  in place. Manual changes are logged as facts so the engine sees what you actually did.
- **One palette, no theme switching.** The app is used in one context and commits to it.

## Licence

MIT — see [LICENSE](LICENSE).
