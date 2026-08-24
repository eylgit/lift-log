/**
 * C1 — the schema opens, versions itself, and seeds its defaults.
 *
 * There is no browser in the test environment, so `fake-indexeddb` provides the
 * IndexedDB implementation (see vitest.config.ts). It is the real algorithm in
 * memory rather than a stub, so a schema that works here works in Chrome.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EQUIPMENT,
  DEFAULT_ROTATION,
  DEFAULT_SETTINGS,
  LiftLogDb,
  SCHEMA_VERSION,
  SINGLETON_ID,
  ensureDefaults,
} from "../src/db/schema";
import { DEFAULT_STEP_KG, STALLS_BEFORE_DELOAD } from "../src/engine";

/**
 * A database per test, under a name no other test uses.
 *
 * Assigning a fresh `IDBFactory` to `globalThis.indexedDB` looks like the
 * cleaner way to do this and does not work: Dexie reads that global once, at
 * import, so every test would go on sharing the first factory and would start
 * with whatever the previous test wrote.
 */
let dbCount = 0;

function freshDb(): LiftLogDb {
  return new LiftLogDb(`lift-log-test-${(dbCount += 1)}`);
}

let db: LiftLogDb;

beforeEach(() => {
  db = freshDb();
});

describe("schema", () => {
  it("opens at the declared version", async () => {
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
  });

  it("declares all six tables", async () => {
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      "engineState",
      "equipment",
      "exercise",
      "session",
      "setLog",
      "settings",
    ]);
  });

  it("indexes sessions by exercise and training day", async () => {
    await db.open();
    const indexes = db.session.schema.indexes.map((i) => i.name);
    expect(indexes).toContain("exerciseId");
    expect(indexes).toContain("trainingDay");
    expect(db.setLog.schema.indexes.map((i) => i.name)).toContain("sessionId");
  });
});

describe("ensureDefaults", () => {
  it("seeds equipment and settings on a fresh database", async () => {
    await ensureDefaults(db);

    await expect(db.equipment.get(SINGLETON_ID)).resolves.toEqual(DEFAULT_EQUIPMENT);
    await expect(db.settings.get(SINGLETON_ID)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("takes its defaults from the engine, not from a second opinion", async () => {
    await ensureDefaults(db);

    const equipment = await db.equipment.get(SINGLETON_ID);
    const settings = await db.settings.get(SINGLETON_ID);
    expect(equipment?.stepKg).toBe(DEFAULT_STEP_KG);
    expect(settings?.stallThreshold).toBe(STALLS_BEFORE_DELOAD);
    expect(settings?.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("leaves existing rows alone when called again", async () => {
    await ensureDefaults(db);
    await db.equipment.update(SINGLETON_ID, { stepKg: 2.5 });
    await db.settings.update(SINGLETON_ID, { units: "lb" });

    await ensureDefaults(db);

    const equipment = await db.equipment.get(SINGLETON_ID);
    const settings = await db.settings.get(SINGLETON_ID);
    expect(equipment?.stepKg).toBe(2.5);
    expect(settings?.units).toBe("lb");
    await expect(db.equipment.count()).resolves.toBe(1);
    await expect(db.settings.count()).resolves.toBe(1);
  });

  it("seeds the rotation, in order, on a fresh database", async () => {
    await ensureDefaults(db);

    const rows = (await db.exercise.toArray()).sort((a, b) => a.order - b.order);
    expect(rows).toEqual([...DEFAULT_ROTATION]);
  });

  it("starts every lift at one step — onboarding's default, and the safe one", async () => {
    await ensureDefaults(db);

    const rows = await db.exercise.toArray();
    expect(rows.every((row) => row.startKg === DEFAULT_STEP_KG)).toBe(true);
  });

  it("does not put back a lift the athlete removed from the rotation", async () => {
    // The rotation is seeded whole or not at all. Merging row by row would
    // undo `saveRotation` on the next open, and there would be no way to
    // refuse — see the note on `ensureDefaults`.
    await ensureDefaults(db);
    await db.exercise.delete("bench");

    await ensureDefaults(db);

    await expect(db.exercise.count()).resolves.toBe(DEFAULT_ROTATION.length - 1);
    await expect(db.exercise.get("bench")).resolves.toBeUndefined();
  });

  it("keeps the singleton tables to one row", async () => {
    await ensureDefaults(db);

    await expect(db.settings.add({ ...DEFAULT_SETTINGS })).rejects.toThrow();
    await expect(db.settings.count()).resolves.toBe(1);
  });
});
