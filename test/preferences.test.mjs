import test from "node:test";
import assert from "node:assert/strict";
import Schema from "@deepseek-ai/schemastery";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_FIELDS,
  preferenceSchemaFields,
  normalizePreferences,
  createPreferencesSource,
  whenPreferencesReady,
} from "../client/preferences.mjs";

function formFixture(value, status = "ready") {
  let snapshot = { value, status, writable: true };
  const listeners = new Set();
  const form = {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    form,
    set(value, status = "ready") {
      snapshot = { ...snapshot, value, status };
      for (const listener of listeners) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

test("settings defaults are validated by the same native schema as custom values", () => {
  const fields = preferenceSchemaFields(Schema);
  for (const [key, field] of Object.entries(fields)) {
    assert.equal(
      field.meta.volatile,
      true,
      `${key} must update live without plugin reload`,
    );
    // Volatile Config fields resolve into loader-owned tokens; validate their inner scalar contract here.
    field.meta.volatile = false;
  }
  const parse = Schema.object(fields);
  assert.deepEqual(parse({}), DEFAULT_PREFERENCES);
  assert.equal(parse({ splitRatio: 0.3 }).splitRatio, 0.3);
  assert.throws(() => parse({ maxPanes: 65 }));
  assert.throws(() => parse({ undoDuration: 0 }));
  assert.throws(() => parse({ focusColor: "red;display:none" }));
  assert.throws(() => parse({ splitDirection: "diagonal" }));
  assert.equal(
    PREFERENCE_FIELDS.length,
    new Set(PREFERENCE_FIELDS.map((field) => field.key)).size,
  );
});

test("bad, unknown and inherited settings cannot replace safe defaults", () => {
  const inherited = Object.create({ focusHighlight: true });
  inherited.undoDuration = NaN;
  inherited.splitRatio = Infinity;
  inherited.maxPanes = 2.5;
  inherited.focusColor = "red";
  assert.deepEqual(normalizePreferences(inherited), DEFAULT_PREFERENCES);
  assert.equal(
    normalizePreferences({ focusHighlight: true, unknown: "x" }).focusHighlight,
    true,
  );
  assert.equal(
    Object.hasOwn(normalizePreferences({ unknown: "x" }), "unknown"),
    false,
  );
});

test("preference snapshots are stable until a form value changes and subscriptions dispose", () => {
  const f = formFixture(undefined);
  const source = createPreferencesSource(f.form);
  assert.equal(source.getSnapshot(), source.getSnapshot());
  let changes = 0;
  const off = source.subscribe(() => changes++);
  f.set({ undoDuration: 5 });
  const value = source.getSnapshot();
  assert.equal(value.undoDuration, 5);
  assert.equal(value, source.getSnapshot());
  assert.equal(changes, 1);
  off();
  assert.equal(f.listeners, 0);
});

test("startup waits for persisted restore preferences, starts once and cancels if disposed", () => {
  const f = formFixture(undefined, "loading");
  const source = createPreferencesSource(f.form);
  const starts = [];
  const off = whenPreferencesReady(source, () =>
    starts.push(source.getSnapshot().restoreLayout),
  );
  assert.deepEqual(starts, []);
  f.set({ restoreLayout: false });
  f.set({ restoreLayout: true });
  assert.deepEqual(starts, [false]);
  off();
  assert.equal(f.listeners, 0);
  const waiting = formFixture(undefined, "loading");
  let started = false;
  const cancel = whenPreferencesReady(
    createPreferencesSource(waiting.form),
    () => {
      started = true;
    },
  );
  cancel();
  waiting.set({});
  assert.equal(started, false);
});
