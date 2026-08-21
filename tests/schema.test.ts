/**
 * C1 — the schema opens, versions itself, and seeds its defaults.
 *
 * There is no browser in the test environment, so `fake-indexeddb` provides the
 * IndexedDB implementation (see vitest.config.ts). It is the real algorithm in
 * memory rather than a stub, so a schema that works here works in Chrome.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  DEFAULT_EQUIPMENT,
  DEFAULT_SETTINGS,
  LiftLogDb,
  SCHEMA_VERSION,
  SINGLETON_ID,
  ensureDefaults,
} from "../src/db/schema";
import { DEFAULT_STEP_KG, STALLS_BEFORE_DELOAD } from "../src/engine";

/** A database per test, so nothing leaks between them. */
function freshDb(): LiftLogDb {
  // Replacing the factory wipes every database the previous test created.
  globalThis.indexedDB = new IDBFactory();
  return new LiftLogDb("lift-log-test");
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

  it("keeps the singleton tables to one row", async () => {
    await ensureDefaults(db);

    await expect(db.settings.add({ ...DEFAULT_SETTINGS })).rejects.toThrow();
    await expect(db.settings.count()).resolves.toBe(1);
  });
});
