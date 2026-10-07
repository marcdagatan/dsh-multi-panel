import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkspaceTabs,
  TABS_STORAGE_KEY,
} from "../client/workspace-tabs.mjs";
import { STORAGE_KEY } from "../client/workspace-state.mjs";

function fixture({ saved = {}, restore = true, shown = {} } = {}) {
  const values = { ...saved };
  const storage = {
    getItem: (key) => values[key] ?? null,
    setItem(key, value) {
      values[key] = value;
    },
    removeItem(key) {
      delete values[key];
    },
  };
  const created = [];
  let nextId = 0;
  const tabs = createWorkspaceTabs({
    storage,
    restore,
    id: () => `tab-${++nextId}`,
    createWorkspace(options) {
      const listeners = new Set();
      const workspace = {
        options,
        sessions: [...(shown[options.storageKey] ?? [])],
        released: [],
        activations: 0,
        disposed: false,
        getSnapshot() {
          return {
            tree: {
              type: "split",
              first: { type: "leaf", sessionId: this.sessions[0] ?? null },
              second: { type: "leaf", sessionId: this.sessions[1] ?? null },
            },
          };
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        show(...sessionIds) {
          this.sessions.push(...sessionIds);
          for (const listener of [...listeners]) listener();
        },
        release(sessionIds) {
          this.released.push(...sessionIds);
          this.sessions = this.sessions.filter(
            (id) => !sessionIds.includes(id),
          );
          for (const listener of [...listeners]) listener();
        },
        activate() {
          this.activations += 1;
        },
        dispose() {
          this.disposed = true;
        },
      };
      created.push(workspace);
      return workspace;
    },
  });
  const ids = () => tabs.getSnapshot().tabs.map((tab) => tab.id);
  const index = () => JSON.parse(values[TABS_STORAGE_KEY]);
  return { tabs, created, values, ids, index };
}

describe("workspace tabs", () => {
  it("starts with one default tab that keeps the existing layout key", () => {
    const f = fixture();
    assert.deepEqual(f.ids(), ["default"]);
    assert.equal(f.tabs.getSnapshot().activeId, "default");
    assert.equal(f.created[0].options.storageKey, STORAGE_KEY);
    assert.equal(f.created[0].options.adoptMainView, true);
    assert.equal(f.created[0].options.isActive(), true);
  });

  it("adds a blank active tab with its own layout key", () => {
    const f = fixture();
    const added = f.tabs.add();
    assert.equal(added, "tab-1");
    assert.deepEqual(f.ids(), ["default", "tab-1"]);
    assert.equal(f.tabs.getSnapshot().activeId, "tab-1");
    const [first, second] = f.created;
    assert.equal(second.options.storageKey, `${STORAGE_KEY}:tab-1`);
    assert.equal(second.options.adoptMainView, false);
    assert.equal(second.options.isActive(), true);
    assert.equal(first.options.isActive(), false);
    assert.equal(second.activations, 1);
    assert.deepEqual(f.index(), {
      tabs: ["default", "tab-1"],
      activeId: "tab-1",
      names: {},
    });
  });

  it("switching keeps every workspace alive and activates the target", () => {
    const f = fixture();
    f.tabs.add();
    f.tabs.select("default");
    assert.equal(f.tabs.getSnapshot().activeId, "default");
    assert.equal(f.tabs.active(), f.created[0]);
    assert.equal(f.created[0].activations, 1);
    assert.ok(f.created.every((workspace) => !workspace.disposed));
    assert.equal(f.index().activeId, "default");
    f.tabs.select("default");
    f.tabs.select("missing");
    assert.equal(f.created[0].activations, 1);
  });

  it("closing a tab disposes it, forgets its layout and activates a neighbour", () => {
    const f = fixture();
    f.tabs.add();
    f.tabs.add();
    f.values[`${STORAGE_KEY}:tab-2`] = "{}";
    f.tabs.close("tab-2");
    assert.deepEqual(f.ids(), ["default", "tab-1"]);
    assert.equal(f.created[2].disposed, true);
    assert.equal(f.values[`${STORAGE_KEY}:tab-2`], undefined);
    assert.equal(f.tabs.getSnapshot().activeId, "tab-1");
    assert.equal(f.created[1].activations, 2);
    f.tabs.close("default");
    assert.deepEqual(f.ids(), ["tab-1"]);
    f.tabs.close("tab-1");
    assert.deepEqual(f.ids(), ["tab-1"]);
    assert.equal(f.created[1].disposed, false);
  });

  it("restores saved tabs in order with the saved active tab", () => {
    const f = fixture({
      saved: {
        [TABS_STORAGE_KEY]: JSON.stringify({
          tabs: ["default", "x", "y"],
          activeId: "x",
        }),
      },
    });
    assert.deepEqual(f.ids(), ["default", "x", "y"]);
    assert.equal(f.tabs.getSnapshot().activeId, "x");
    assert.deepEqual(
      f.created.map((workspace) => workspace.options.adoptMainView),
      [false, true, false],
    );
    assert.equal(f.created[2].options.storageKey, `${STORAGE_KEY}:y`);
  });

  it("falls back to one default tab for invalid or disabled restores", () => {
    for (const saved of ["nope", '{"tabs":[],"activeId":null}', '{"tabs":[1]}'])
      assert.deepEqual(
        fixture({ saved: { [TABS_STORAGE_KEY]: saved } }).ids(),
        ["default"],
      );
    const disabled = fixture({
      restore: false,
      saved: {
        [TABS_STORAGE_KEY]: JSON.stringify({ tabs: ["x"], activeId: "x" }),
      },
    });
    assert.deepEqual(disabled.ids(), ["default"]);
  });

  it("renames tabs, persists trimmed names and clears them when blank", () => {
    const f = fixture();
    const added = f.tabs.add();
    f.tabs.rename(added, "  Research  ");
    assert.equal(f.tabs.getSnapshot().tabs[1].name, "Research");
    assert.deepEqual(f.index().names, { [added]: "Research" });
    f.tabs.rename(added, "x".repeat(200));
    assert.equal(f.tabs.getSnapshot().tabs[1].name.length, 60);
    f.tabs.rename(added, "   ");
    assert.equal(f.tabs.getSnapshot().tabs[1].name, undefined);
    assert.deepEqual(f.index().names, {});
    f.tabs.rename("missing", "Nope");
    assert.deepEqual(f.index().names, {});
  });

  it("restores valid saved names and forgets a closed tab's name", () => {
    const f = fixture({
      saved: {
        [TABS_STORAGE_KEY]: JSON.stringify({
          tabs: ["default", "x"],
          activeId: "x",
          names: { default: "Main", x: 5, gone: "Old" },
        }),
      },
    });
    assert.deepEqual(
      f.tabs.getSnapshot().tabs.map((tab) => tab.name),
      ["Main", undefined],
    );
    f.tabs.close("default");
    assert.deepEqual(f.index().names, {});
  });

  it("notifies subscribers and disposes every workspace", () => {
    const f = fixture();
    let calls = 0;
    const off = f.tabs.subscribe(() => calls++);
    f.tabs.add();
    off();
    f.tabs.select("default");
    assert.equal(calls, 1);
    f.tabs.dispose();
    assert.ok(f.created.every((workspace) => workspace.disposed));
  });
});

describe("one chat per app across tabs", () => {
  it("showing a chat in one tab releases it from every other tab", () => {
    const f = fixture();
    const [first] = f.created;
    first.show("x", "y");
    f.tabs.add();
    const second = f.created[1];
    second.show("x");
    assert.deepEqual(first.released, ["x"]);
    assert.deepEqual(first.sessions, ["y"]);
    assert.deepEqual(second.sessions, ["x"]);
    assert.deepEqual(second.released, []);
  });

  it("restored duplicates stay in the active tab and leave the others", () => {
    const f = fixture({
      saved: {
        [TABS_STORAGE_KEY]: JSON.stringify({
          tabs: ["default", "games"],
          activeId: "games",
        }),
      },
      shown: {
        [STORAGE_KEY]: ["x", "y"],
        [`${STORAGE_KEY}:games`]: ["x"],
      },
    });
    const [projects, games] = f.created;
    assert.deepEqual(projects.sessions, ["y"]);
    assert.deepEqual(games.sessions, ["x"]);
  });

  it("closing a tab stops watching it", () => {
    const f = fixture();
    f.tabs.add();
    const [first, second] = f.created;
    f.tabs.close("tab-1");
    second.show("x");
    first.show("x");
    assert.deepEqual(second.released, []);
  });
});
