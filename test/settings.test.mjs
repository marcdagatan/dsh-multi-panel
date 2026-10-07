import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
const bootstrap = new JSDOM("<body></body>");
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const { createRoot } = await import("react-dom/client");
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
import {
  MultiPanelSettings,
  registerMultiPanelSettings,
} from "../client/settings.mjs";
import { createPreferencesSource } from "../client/preferences.mjs";

function fixture({ writable = true, accepted = true } = {}) {
  const dom = new JSDOM('<body><div id="root"></div></body>');
  const saved = Object.fromEntries(
    ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let snapshot = { status: "ready", writable, value: { busyEnter: "steer" } };
  const listeners = new Set();
  const writes = [];
  const form = {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async set(key, value) {
      writes.push([key, value]);
      if (!accepted) return false;
      snapshot = { ...snapshot, value: { ...snapshot.value, [key]: value } };
      for (const fn of listeners) fn();
      return true;
    },
    async mutate(ops) {
      writes.push(ops);
      const value = { ...snapshot.value };
      for (const op of ops) delete value[op.path[0]];
      snapshot = { ...snapshot, value };
      for (const fn of listeners) fn();
      return true;
    },
  };
  const root = createRoot(document.getElementById("root"));
  act(() =>
    root.render(
      React.createElement(MultiPanelSettings, {
        preferencesSource: createPreferencesSource(form),
      }),
    ),
  );
  return {
    dom,
    writes,
    form,
    field: (key) => document.getElementById(`dshMulti-setting-${key}`),
    cleanup() {
      act(() => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("native settings registration passes the renderer as the required second argument", () => {
  const source = {};
  const ctx = {
    slots: {
      inject(name, register) {
        assert.equal(name, "settings.section");
        return register();
      },
      register(options, renderer) {
        assert.equal(renderer, MultiPanelSettings);
        assert.equal(options.id, "multi-panel-settings");
        assert.equal(options.inject().preferencesSource, source);
        return () => {};
      },
    },
  };
  registerMultiPanelSettings(ctx, source);
});

function typeNumber(input, text) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, text);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("settings save booleans and commit numeric edits only after blur, not each digit", async () => {
  const f = fixture();
  try {
    await act(async () => f.field("focusHighlight").click());
    assert.deepEqual(f.writes, [["focusHighlight", true]]);
    const number = f.field("undoDuration");
    act(() => {
      number.focus();
      typeNumber(number, "12");
    });
    assert.equal(f.writes.length, 1);
    await act(async () => number.blur());
    assert.deepEqual(f.writes[1], ["undoDuration", 12]);
    assert.equal(number.value, "12");
    act(() => {
      number.focus();
      typeNumber(number, "99");
    });
    await act(async () => number.blur());
    assert.equal(f.writes.length, 2);
    assert.equal(number.value, "12");
    await act(async () =>
      document.querySelector(".dshMulti-resetSettings").click(),
    );
    assert.equal(f.field("focusHighlight").checked, false);
    assert.equal(f.field("undoDuration").value, "3");
    assert.equal(
      f.form.getSnapshot().value.busyEnter,
      "steer",
      "reset must not touch native conversation preferences",
    );
  } finally {
    f.cleanup();
  }
});

test("rejected writes preserve accepted preferences and show an error; read-only forms stay disabled", async () => {
  const rejected = fixture({ accepted: false });
  try {
    await act(async () => rejected.field("focusHighlight").click());
    assert.equal(rejected.field("focusHighlight").checked, false);
    assert.match(
      document.querySelector('[role="alert"]').textContent,
      /could not be saved/,
    );
    assert.equal(rejected.field("focusHighlight").disabled, false);
  } finally {
    rejected.cleanup();
  }
  const readonly = fixture({ writable: false });
  try {
    assert.equal(readonly.field("focusHighlight").disabled, true);
    await act(async () => readonly.field("focusHighlight").click());
    assert.deepEqual(readonly.writes, []);
  } finally {
    readonly.cleanup();
  }
});
