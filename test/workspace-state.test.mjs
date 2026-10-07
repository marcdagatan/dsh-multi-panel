import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorkspaceState } from "../client/workspace-state.mjs";
import { findLeaf, leaves } from "../client/split-model.mjs";

const STORAGE_KEY = "dsh.multi-panel.layout.v1";
const leaf = (id, sessionId = null) => ({ type: "leaf", id, sessionId });
const split = (id, first, second, axis = "horizontal", ratio = 0.5) => ({
  type: "split",
  id,
  axis,
  ratio,
  first,
  second,
});

/** Real session-list notifications can occur synchronously inside retain/release. */
function fixture({
  saved = null,
  main = "a",
  phase = "ready",
  notifyReferences = true,
  readError = null,
  writeError = null,
  retainError = null,
  readyError = null,
  createSession,
  getPreferences,
  storageKey,
  isActive,
  adoptMainView,
} = {}) {
  const listeners = new Set();
  const records = [];
  const retainCalls = [];
  const createCalls = [];
  const navigationCalls = [];
  const writes = [];
  const rows = Object.fromEntries(
    ["a", "b", "c", "d"].map((sessionId) => [
      sessionId,
      {
        id: sessionId,
        title: `Chat ${sessionId}`,
        blank: false,
        retainedBy: { mainView: sessionId === main ? 1 : 0, multiPanel: 0 },
      },
    ]),
  );
  const visibleIds = new Set(Object.keys(rows));
  let list = { phase, ids: Object.keys(rows), byId: rows };
  let savedValue =
    saved === null
      ? null
      : typeof saved === "string"
        ? saved
        : JSON.stringify(saved);
  let nextId = 0;

  function emit() {
    const byId = Object.fromEntries(
      Object.entries(rows).filter(([sessionId]) => visibleIds.has(sessionId)),
    );
    list = { ...list, ids: Object.keys(byId), byId };
    for (const listener of [...listeners]) listener();
  }

  const sessions = {
    list: {
      getSnapshot: () => list,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    retain(sessionId, options) {
      retainCalls.push(sessionId);
      if (retainError) throw retainError;
      if (!Object.hasOwn(rows, sessionId) || !visibleIds.has(sessionId))
        throw new Error(`Unknown session ${sessionId}`);
      const record = {
        sessionId,
        source: options.source,
        binding: {
          sessionId,
          acquisition: records.length,
          draft: rows[sessionId].blank ? "" : `draft-${sessionId}`,
        },
        ready: readyError ? Promise.reject(readyError) : Promise.resolve(),
        releases: 0,
        release() {
          record.releases += 1;
          rows[sessionId] = {
            ...rows[sessionId],
            retainedBy: {
              ...rows[sessionId].retainedBy,
              multiPanel: rows[sessionId].retainedBy.multiPanel - 1,
            },
          };
          if (notifyReferences) emit();
        },
      };
      records.push(record);
      rows[sessionId] = {
        ...rows[sessionId],
        retainedBy: {
          ...rows[sessionId].retainedBy,
          multiPanel: rows[sessionId].retainedBy.multiPanel + 1,
        },
      };
      if (notifyReferences) emit();
      return record;
    },
  };
  const navigation = {
    openSession(sessionId) {
      navigationCalls.push(sessionId);
      for (const [key, row] of Object.entries(rows)) {
        rows[key] = {
          ...row,
          retainedBy: {
            ...row.retainedBy,
            mainView: key === sessionId ? 1 : 0,
          },
        };
      }
      emit();
    },
  };
  const storage = {
    getItem(key) {
      assert.equal(key, storageKey ?? STORAGE_KEY);
      if (readError) throw readError;
      return savedValue;
    },
    setItem(key, value) {
      assert.equal(key, storageKey ?? STORAGE_KEY);
      if (writeError) throw writeError;
      writes.push(JSON.parse(value));
      savedValue = value;
    },
  };
  const state = createWorkspaceState({
    sessions,
    navigation,
    storage,
    getPreferences,
    storageKey,
    isActive,
    adoptMainView,
    createSession:
      typeof createSession === "function"
        ? async (originSessionId) => {
            createCalls.push(originSessionId);
            const sessionId = await createSession(originSessionId);
            if (
              typeof sessionId === "string" &&
              sessionId.trim() &&
              !Object.hasOwn(rows, sessionId)
            ) {
              rows[sessionId] = {
                id: sessionId,
                title: "New chat",
                blank: true,
                retainedBy: { mainView: 0, multiPanel: 0 },
              };
              visibleIds.add(sessionId);
              emit();
            }
            return sessionId;
          }
        : undefined,
    id: () => `generated-${++nextId}`,
  });

  return {
    state,
    sessions,
    navigation,
    records,
    retainCalls,
    createCalls,
    navigationCalls,
    writes,
    emit,
    retained: (sessionId) =>
      records.filter(
        (record) => record.sessionId === sessionId && record.releases === 0,
      ),
    saved: () => savedValue,
    metadata(sessionId, patch) {
      rows[sessionId] = { ...rows[sessionId], ...patch };
      emit();
    },
    phase(value) {
      list = { ...list, phase: value };
      emit();
    },
    removeSession(sessionId) {
      visibleIds.delete(sessionId);
      emit();
    },
  };
}

const paneFor = (state, sessionId) =>
  leaves(state.getSnapshot().tree).find((pane) => pane.sessionId === sessionId);
const sessionsIn = (state) =>
  leaves(state.getSnapshot().tree).map((pane) => pane.sessionId);

function assertReferenceOwnership(f) {
  const expected = new Set(sessionsIn(f.state).filter(Boolean));
  const sessionIds = new Set([
    "a",
    "b",
    "c",
    "d",
    ...expected,
    ...f.records.map((record) => record.sessionId),
  ]);
  for (const sessionId of sessionIds) {
    const retained = f.retained(sessionId);
    assert.equal(
      retained.length,
      expected.has(sessionId) ? 1 : 0,
      `live references for ${sessionId}`,
    );
    assert.equal(
      f.state.reference(sessionId),
      expected.has(sessionId) ? retained[0] : undefined,
    );
  }
  assert.ok(f.records.every((record) => record.source === "multiPanel"));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("workspace native new chats", () => {
  it("creates a distinct blank native session before splitting, preserving the origin draft", async () => {
    const creation = deferred();
    const f = fixture({ createSession: () => creation.promise });
    try {
      const a = paneFor(f.state, "a");
      const originReference = f.state.reference("a");
      originReference.binding.draft = "Unsent origin draft";
      const before = f.state.getSnapshot();
      const pending = f.state.newChat(a.id, "right");
      assert.deepEqual(f.createCalls, ["a"]);
      assert.equal(f.state.getSnapshot(), before);
      assert.deepEqual(f.retainCalls, ["a"]);
      creation.resolve("new-1");
      assert.equal(await pending, "new-1");
      assert.deepEqual(sessionsIn(f.state), ["a", "new-1"]);
      const createdPane = paneFor(f.state, "new-1");
      assert.notEqual(createdPane.id, a.id);
      assert.equal(paneFor(f.state, "a"), a);
      assert.equal(f.state.getSnapshot().activeId, createdPane.id);
      assert.equal(f.navigationCalls.at(-1), "new-1");
      assert.equal(f.state.reference("a"), originReference);
      assert.equal(originReference.releases, 0);
      assert.equal(originReference.binding.draft, "Unsent origin draft");
      assert.equal(f.state.reference("new-1").binding.draft, "");
      assert.notEqual(
        f.state.reference("new-1").binding,
        originReference.binding,
      );
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("replacement preserves the pane ID and does not destroy the previous chat draft", async () => {
    const f = fixture({ createSession: async () => "new-1" });
    try {
      const a = paneFor(f.state, "a");
      const previousReference = f.state.reference("a");
      previousReference.binding.draft = "Saved unsent draft";
      assert.equal(await f.state.newChat(a.id), "new-1");
      assert.deepEqual(sessionsIn(f.state), ["new-1"]);
      assert.equal(paneFor(f.state, "new-1").id, a.id);
      assert.equal(f.state.getSnapshot().activeId, a.id);
      assert.equal(previousReference.releases, 1);
      assert.equal(previousReference.binding.draft, "Saved unsent draft");
      assert.ok(f.sessions.list.getSnapshot().ids.includes("a"));
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("two new blank panes have different native identities and composer bindings", async () => {
    let nextSession = 0;
    const f = fixture({ createSession: async () => `blank-${++nextSession}` });
    try {
      const a = paneFor(f.state, "a");
      await f.state.newChat(a.id, "bottom");
      await f.state.newChat(a.id, "right");
      assert.deepEqual(
        new Set(sessionsIn(f.state)),
        new Set(["a", "blank-1", "blank-2"]),
      );
      assert.notEqual(
        paneFor(f.state, "blank-1").id,
        paneFor(f.state, "blank-2").id,
      );
      const first = f.state.reference("blank-1").binding;
      const second = f.state.reference("blank-2").binding;
      assert.notEqual(first, second);
      first.draft = "Draft for the first blank only";
      assert.equal(second.draft, "");
      assert.equal(
        f.state.getSnapshot().activeId,
        paneFor(f.state, "blank-2").id,
      );
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("uses the target session, then focused/first live session fallbacks, then native defaults", async () => {
    let nextSession = 0;
    const f = fixture({ createSession: async () => `new-${++nextSession}` });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      await f.state.newChat(a.id, "top");
      assert.equal(f.createCalls.at(-1), "a");
      f.state.split(b.id, null, "bottom");
      const empty = paneFor(f.state, null);
      f.state.focus(b.id);
      await f.state.newChat(empty.id);
      assert.equal(f.createCalls.at(-1), "b");
      f.state.split(b.id, null, "bottom");
      const anotherEmpty = paneFor(f.state, null);
      await f.state.newChat(anotherEmpty.id);
      assert.equal(f.createCalls.at(-1), "new-1");
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
    const empty = fixture({
      main: null,
      createSession: async () => "first-native",
    });
    try {
      await empty.state.newChat(empty.state.getSnapshot().activeId);
      assert.deepEqual(empty.createCalls, [null]);
      assert.deepEqual(sessionsIn(empty.state), ["first-native"]);
      assertReferenceOwnership(empty);
    } finally {
      empty.state.dispose();
    }
  });

  it("missing adapters and failed creation warn without altering the tree or sharing null shells", async () => {
    const noAdapter = fixture();
    try {
      const before = noAdapter.state.getSnapshot();
      assert.equal(
        await noAdapter.state.newChat(before.activeId, "right"),
        null,
      );
      assert.equal(noAdapter.state.getSnapshot().tree, before.tree);
      assert.equal(noAdapter.state.getSnapshot().activeId, before.activeId);
      assert.match(noAdapter.state.getSnapshot().warning, /unavailable/);
      assertReferenceOwnership(noAdapter);
    } finally {
      noAdapter.state.dispose();
    }
    const creation = deferred();
    const failed = fixture({ createSession: () => creation.promise });
    try {
      const before = failed.state.getSnapshot();
      const pending = failed.state.newChat(before.activeId, "top");
      creation.reject(new Error("Native creation failed"));
      assert.equal(await pending, null);
      assert.equal(failed.state.getSnapshot().tree, before.tree);
      assert.equal(failed.state.getSnapshot().activeId, before.activeId);
      assert.match(
        failed.state.getSnapshot().warning,
        /Native creation failed/,
      );
      assert.deepEqual(
        failed.records.map((record) => record.sessionId),
        ["a"],
      );
      assertReferenceOwnership(failed);
    } finally {
      failed.state.dispose();
    }
  });

  it("rejects malformed or already-visible session IDs returned by an adapter", async () => {
    for (const result of [null, undefined, "", "   ", 42, "a", "b"]) {
      const f = fixture({ createSession: async () => result });
      try {
        const a = paneFor(f.state, "a");
        f.state.split(a.id, "b", "right");
        const before = f.state.getSnapshot();
        assert.equal(await f.state.newChat(a.id, "top"), null);
        assert.equal(f.state.getSnapshot().tree, before.tree);
        assert.equal(f.state.getSnapshot().activeId, before.activeId);
        assert.match(f.state.getSnapshot().warning, /unique session/);
        assertReferenceOwnership(f);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("does not commit to a target closed while creation is pending, even if undo restores it", async () => {
    const creation = deferred();
    const f = fixture({ createSession: () => creation.promise });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const pending = f.state.newChat(b.id, "bottom");
      f.state.close(b.id);
      f.state.undo();
      const before = f.state.getSnapshot();
      creation.resolve("cancelled-new");
      assert.equal(await pending, null);
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.state.reference("cancelled-new"), undefined);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("disposal cancels late success/failure without retaining, navigating or publishing", async () => {
    for (const fail of [false, true]) {
      const creation = deferred();
      const f = fixture({ createSession: () => creation.promise });
      const pending = f.state.newChat(f.state.getSnapshot().activeId, "right");
      const before = f.state.getSnapshot();
      f.state.dispose();
      const calls = f.navigationCalls.length;
      if (fail) creation.reject(new Error("Failure after disposal"));
      else creation.resolve("late-new");
      assert.equal(await pending, null);
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.navigationCalls.length, calls);
      assert.equal(f.state.reference("late-new"), undefined);
      assert.ok(f.records.every((record) => record.releases === 1));
      assert.deepEqual(f.retainCalls, ["a"]);
    }
  });

  it("a newer target selection cancels replacement without clobbering that choice", async () => {
    const creation = deferred();
    const f = fixture({ createSession: () => creation.promise });
    try {
      const a = paneFor(f.state, "a");
      const pending = f.state.newChat(a.id);
      f.state.select(a.id, "b");
      const before = f.state.getSnapshot();
      creation.resolve("cancelled-new");
      assert.equal(await pending, null);
      assert.equal(f.state.getSnapshot(), before);
      assert.deepEqual(sessionsIn(f.state), ["b"]);
      assert.equal(f.state.reference("cancelled-new"), undefined);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("a pending split preserves a newer target selection and focuses the created adjacent pane", async () => {
    const creation = deferred();
    const f = fixture({ createSession: () => creation.promise });
    try {
      const a = paneFor(f.state, "a");
      const pending = f.state.newChat(a.id, "right");
      f.state.select(a.id, "b");
      creation.resolve("new-1");
      assert.equal(await pending, "new-1");
      assert.deepEqual(sessionsIn(f.state), ["b", "new-1"]);
      assert.equal(paneFor(f.state, "b").id, a.id);
      assert.equal(
        f.state.getSnapshot().activeId,
        paneFor(f.state, "new-1").id,
      );
      assert.deepEqual(f.createCalls, ["a"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("focus changes during creation do not redirect replacement to another pane", async () => {
    const creation = deferred();
    const f = fixture({ createSession: () => creation.promise });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const pending = f.state.newChat(a.id);
      f.state.focus(b.id);
      const bReference = f.state.reference("b");
      creation.resolve("new-1");
      assert.equal(await pending, "new-1");
      assert.equal(paneFor(f.state, "new-1").id, a.id);
      assert.equal(paneFor(f.state, "b"), b);
      assert.equal(f.state.getSnapshot().activeId, a.id);
      assert.equal(f.state.reference("b"), bReference);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace configurable split behavior", () => {
  it("equalize evens the divider's same-axis panes in one layout change", () => {
    const tree = split(
      "root",
      leaf("first", "a"),
      split(
        "nested",
        leaf("second", "b"),
        leaf("third", "c"),
        "horizontal",
        0.8,
      ),
      "horizontal",
      0.7,
    );
    const f = fixture({ saved: { tree, activeId: "first" } });
    try {
      let publishes = 0;
      f.state.subscribe(() => publishes++);
      f.state.equalize("nested");
      const next = f.state.getSnapshot().tree;
      assert.equal(next.ratio, 1 / 3);
      assert.equal(next.second.ratio, 0.5);
      assert.equal(publishes, 1);
      f.state.equalize("nested");
      f.state.equalize("missing");
      assert.equal(publishes, 1);
    } finally {
      f.state.dispose();
    }
  });

  it("defaults retain flexible resize bounds without requiring viewport measurements", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b");
      const root = f.state.getSnapshot().tree;
      assert.equal(root.axis, "horizontal");
      assert.equal(root.ratio, 0.5);
      assert.deepEqual(f.state.getResizeBounds(root.id), {
        min: 0.15,
        max: 0.85,
      });
      assert.equal(f.state.getResizeBounds(a.id), null);
      assert.equal(f.state.getResizeBounds("missing"), null);
      assert.equal(f.state.getSnapshot().activeId, paneFor(f.state, "b").id);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("interprets configured ratios as the incoming share for every directional edge", () => {
    for (const edge of ["left", "right", "top", "bottom"]) {
      const f = fixture({ getPreferences: () => ({ splitRatio: 0.3 }) });
      try {
        const a = paneFor(f.state, "a");
        f.state.split(a.id, "b", edge);
        const root = f.state.getSnapshot().tree;
        const before = edge === "left" || edge === "top";
        assert.equal(root.ratio, before ? 0.3 : 0.7);
        assert.equal(
          root.axis,
          edge === "left" || edge === "right" ? "horizontal" : "vertical",
        );
        assert.equal((before ? root.first : root.second).sessionId, "b");
        assert.equal(paneFor(f.state, "a"), a);
        assertReferenceOwnership(f);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("uses live default direction/ratio for menu/drop and allows existing-pane moves at the count limit", () => {
    let settings = { splitDirection: "top", splitRatio: 0.3, maxPanes: 2 };
    const f = fixture({ getPreferences: () => settings });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b");
      const b = paneFor(f.state, "b");
      assert.equal(f.state.getSnapshot().tree.axis, "vertical");
      assert.equal(f.state.getSnapshot().tree.ratio, 0.3);
      settings = {
        ...settings,
        splitDirection: "left",
        splitRatio: 0.4,
        maxPanes: 1,
      };
      f.state.split(a.id, "b");
      assert.equal(f.state.getSnapshot().tree.axis, "horizontal");
      assert.equal(f.state.getSnapshot().tree.ratio, 0.4);
      assert.equal(f.state.getSnapshot().tree.first, b);
      assert.equal(f.records.length, 2);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("focusNewPane=false preserves focus/navigation for direct and native splits", async () => {
    const f = fixture({
      getPreferences: () => ({ focusNewPane: false, splitRatio: 0.3 }),
      createSession: async () => "new-1",
    });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      assert.equal(f.state.getSnapshot().activeId, a.id);
      assert.equal(f.navigationCalls.length, 0);
      const b = paneFor(f.state, "b");
      f.state.focus(b.id);
      const calls = [...f.navigationCalls];
      assert.equal(await f.state.newChat(a.id, "top"), "new-1");
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assert.deepEqual(f.navigationCalls, calls);
      assert.equal(f.state.getSnapshot().tree.first.ratio, 0.3);
      assert.equal(f.state.getSnapshot().tree.first.first.sessionId, "new-1");
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("rejects over-limit splits before native creation but permits replacing a chat at capacity", async () => {
    const f = fixture({
      getPreferences: () => ({ maxPanes: 1 }),
      createSession: async () => "new-1",
    });
    try {
      const before = f.state.getSnapshot();
      f.state.split(before.activeId, "b", "right");
      assert.equal(f.state.getSnapshot().tree, before.tree);
      assert.match(f.state.getSnapshot().warning, /Pane limit/);
      assert.equal(await f.state.newChat(before.activeId, "bottom"), null);
      assert.deepEqual(f.createCalls, []);
      assert.deepEqual(f.retainCalls, ["a"]);
      assert.equal(await f.state.newChat(before.activeId), "new-1");
      assert.deepEqual(sessionsIn(f.state), ["new-1"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("rechecks count limits after asynchronous native creation without replacing intervening layout changes", async () => {
    const creation = deferred();
    const f = fixture({
      getPreferences: () => ({ maxPanes: 2 }),
      createSession: () => creation.promise,
    });
    try {
      const a = paneFor(f.state, "a");
      const pending = f.state.newChat(a.id, "right");
      f.state.split(a.id, "b", "bottom");
      const before = f.state.getSnapshot();
      creation.resolve("uncommitted-new");
      assert.equal(await pending, null);
      assert.equal(f.state.getSnapshot().tree, before.tree);
      assert.equal(f.state.getSnapshot().activeId, before.activeId);
      assert.equal(f.state.getSnapshot().undo, before.undo);
      assert.equal(f.state.reference("uncommitted-new"), undefined);
      assert.match(f.state.getSnapshot().warning, /Pane limit/);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("restoreLayout=false skips persisted data without deleting namespaces or sessions", () => {
    const saved = {
      tree: split("saved-root", leaf("saved-a", "a"), leaf("saved-b", "b")),
      activeId: "saved-b",
    };
    const f = fixture({
      saved,
      main: null,
      readError: new Error("Should not read"),
      getPreferences: () => ({ restoreLayout: false }),
    });
    try {
      assert.deepEqual(sessionsIn(f.state), [null]);
      assert.equal(f.state.getSnapshot().warning, null);
      assert.deepEqual(JSON.parse(f.saved()), saved);
      assert.deepEqual(f.retainCalls, []);
      assert.ok(f.sessions.list.getSnapshot().ids.includes("a"));
      assert.ok(f.sessions.list.getSnapshot().ids.includes("b"));
    } finally {
      f.state.dispose();
    }
  });

  it("lowered limits do not trim a restored layout or rewrite it on measurement", () => {
    const saved = {
      tree: split(
        "root",
        leaf("a-pane", "a"),
        leaf("b-pane", "b"),
        "horizontal",
        0.6,
      ),
      activeId: "a-pane",
    };
    const f = fixture({
      saved,
      main: null,
      getPreferences: () => ({
        maxPanes: 1,
        minPaneWidth: 400,
        minPaneHeight: 300,
      }),
    });
    try {
      const before = f.state.getSnapshot();
      const writes = f.writes.length;
      f.state.setViewport(100, 100);
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.writes.length, writes);
      assert.deepEqual(f.state.getResizeBounds("root"), { min: 0.6, max: 0.6 });
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace minimum pane sizes", () => {
  it("clamps initial horizontal/vertical splits to minimum dimensions", () => {
    for (const edge of ["right", "bottom"]) {
      const f = fixture({
        getPreferences: () => ({
          minPaneWidth: 200,
          minPaneHeight: 150,
          splitRatio: 0.15,
        }),
      });
      try {
        f.state.setViewport(600, 400);
        const a = paneFor(f.state, "a");
        f.state.split(a.id, "b", edge);
        const root = f.state.getSnapshot().tree;
        const expected = edge === "right" ? 2 / 3 : 0.625;
        assert.ok(Math.abs(root.ratio - expected) < 1e-12);
        assert.equal(paneFor(f.state, "a"), a);
        assertReferenceOwnership(f);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("rejects splits before native creation when unmeasured, below pair minimums, or below cross-axis minimums", async () => {
    for (const viewport of [null, [399, 300], [800, 99]]) {
      const f = fixture({
        getPreferences: () => ({ minPaneWidth: 200, minPaneHeight: 100 }),
        createSession: async () => "new-1",
      });
      try {
        if (viewport) f.state.setViewport(...viewport);
        const before = f.state.getSnapshot();
        assert.equal(await f.state.newChat(before.activeId, "right"), null);
        assert.equal(f.state.getSnapshot().tree, before.tree);
        assert.equal(f.state.getSnapshot().activeId, before.activeId);
        assert.match(f.state.getSnapshot().warning, /minimum pane size/);
        assert.deepEqual(f.createCalls, []);
        assertReferenceOwnership(f);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("rechecks viewport minimums after asynchronous creation and leaves all existing chats mounted", async () => {
    const creation = deferred();
    const f = fixture({
      getPreferences: () => ({ minPaneWidth: 200 }),
      createSession: () => creation.promise,
    });
    try {
      f.state.setViewport(800, 400);
      const before = f.state.getSnapshot();
      const pending = f.state.newChat(before.activeId, "right");
      f.state.setViewport(300, 400);
      assert.equal(f.state.getSnapshot(), before);
      creation.resolve("uncommitted-new");
      assert.equal(await pending, null);
      assert.equal(f.state.getSnapshot().tree, before.tree);
      assert.equal(f.state.reference("uncommitted-new"), undefined);
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("ancestor resize bounds account for asymmetric descendant ratios, and resize works as an unbound callback", () => {
    const saved = {
      tree: split(
        "root",
        split(
          "inner",
          leaf("a-pane", "a"),
          leaf("b-pane", "b"),
          "horizontal",
          0.25,
        ),
        leaf("c-pane", "c"),
        "horizontal",
        0.6,
      ),
      activeId: "a-pane",
    };
    const f = fixture({
      saved,
      main: null,
      getPreferences: () => ({ minPaneWidth: 100 }),
    });
    try {
      f.state.setViewport(1000, 600);
      assert.deepEqual(f.state.getResizeBounds("root"), {
        min: 0.4,
        max: 0.85,
      });
      const inner = f.state.getResizeBounds("inner");
      assert.ok(Math.abs(inner.min - 1 / 6) < 1e-12);
      assert.ok(Math.abs(inner.max - 5 / 6) < 1e-12);
      const resize = f.state.resize;
      resize("root", 0.15);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.4);
      assert.deepEqual(f.state.getResizeBounds("inner"), {
        min: 0.25,
        max: 0.75,
      });
      assert.equal(f.state.getSnapshot().tree.first.ratio, 0.25);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("cross-axis infeasibility locks only the affected divider until a user fixes the inner ratio", () => {
    const saved = {
      tree: split(
        "root",
        split(
          "inner",
          leaf("a-pane", "a"),
          leaf("b-pane", "b"),
          "vertical",
          0.3,
        ),
        leaf("c-pane", "c"),
        "horizontal",
        0.6,
      ),
      activeId: "a-pane",
    };
    const f = fixture({
      saved,
      main: null,
      getPreferences: () => ({ minPaneWidth: 100, minPaneHeight: 120 }),
    });
    try {
      f.state.setViewport(900, 600);
      assert.deepEqual(f.state.getResizeBounds("root"), {
        min: 0.15,
        max: 0.85,
      });
      f.state.setViewport(900, 300);
      const before = f.state.getSnapshot();
      assert.deepEqual(f.state.getResizeBounds("root"), { min: 0.6, max: 0.6 });
      f.state.resize("root", 0.8);
      assert.equal(f.state.getSnapshot(), before);
      assert.deepEqual(f.state.getResizeBounds("inner"), {
        min: 0.4,
        max: 0.6,
      });
      f.state.resize("inner", 0.5);
      assert.deepEqual(f.state.getResizeBounds("root"), {
        min: 0.15,
        max: 0.85,
      });
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("render measurement overrides are pure and never replace the viewport used by actions", () => {
    const f = fixture({
      getPreferences: () => ({ minPaneWidth: 200, minPaneHeight: 100 }),
    });
    try {
      f.state.setViewport(800, 400);
      f.state.split(f.state.getSnapshot().activeId, "b", "right");
      const before = f.state.getSnapshot();
      const rootId = before.tree.id;
      const writes = f.writes.length;
      assert.deepEqual(f.state.getResizeBounds(rootId, 1000, 200), {
        min: 0.2,
        max: 0.8,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId, NaN, Infinity), {
        min: 0.25,
        max: 0.75,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId, -1, -1), {
        min: 0.25,
        max: 0.75,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId, 1000, NaN), {
        min: 0.2,
        max: 0.8,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId, NaN, 50), {
        min: 0.5,
        max: 0.5,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId, 0, 400), {
        min: 0.5,
        max: 0.5,
      });
      assert.deepEqual(f.state.getResizeBounds(rootId), {
        min: 0.25,
        max: 0.75,
      });
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.writes.length, writes);
      f.state.resize(rootId, 0.95);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.75);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("shrinking/growing viewports and live preference changes never auto-rewrite ratios or drop references", () => {
    let settings = { minPaneWidth: 200 };
    const f = fixture({ getPreferences: () => settings });
    try {
      f.state.setViewport(800, 400);
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const before = f.state.getSnapshot();
      const references = [...f.records];
      const writes = f.writes.length;
      const rootId = before.tree.id;
      f.state.setViewport(300, 400);
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.writes.length, writes);
      assert.deepEqual(f.state.getResizeBounds(rootId), { min: 0.5, max: 0.5 });
      f.state.resize(rootId, 0.8);
      assert.equal(f.state.getSnapshot(), before);
      f.state.setViewport(1000, 400);
      settings = { minPaneWidth: 400 };
      assert.deepEqual(f.state.getResizeBounds(rootId), { min: 0.4, max: 0.6 });
      assert.equal(f.state.getSnapshot(), before);
      f.state.setViewport(NaN, 400);
      f.state.setViewport(1000, -1);
      assert.deepEqual(f.state.getResizeBounds(rootId), { min: 0.4, max: 0.6 });
      f.state.resize(rootId, 0.15);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.4);
      f.state.resize(rootId, 0.99);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.6);
      const resized = f.state.getSnapshot();
      f.state.resize(rootId, NaN);
      f.state.resize("missing", 0.5);
      assert.equal(f.state.getSnapshot(), resized);
      assert.deepEqual(f.records, references);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace undo toast identity", () => {
  it("refreshes monotonic undo IDs without consuming pane IDs or refreshing on unrelated publishes", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const firstUndo = f.state.getSnapshot().undo;
      assert.equal(firstUndo.id, 1);
      assert.equal(b.id, "generated-2");
      assert.equal(f.state.getSnapshot().tree.id, "generated-3");
      f.state.resize(f.state.getSnapshot().tree.id, 0.6);
      assert.equal(f.state.getSnapshot().undo, firstUndo);
      f.state.move(b.id, a.id, "top");
      const secondUndo = f.state.getSnapshot().undo;
      assert.equal(secondUndo.id, 2);
      assert.notEqual(secondUndo, firstUndo);
      assert.equal(f.state.getSnapshot().tree.id, "generated-4");
      f.state.dismissUndo(secondUndo);
      f.state.split(a.id, "c", "right");
      assert.equal(f.state.getSnapshot().undo.id, 3);
      assert.equal(paneFor(f.state, "c").id, "generated-5");
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("dismisses only the current undo reference and leaves layout, focus and references intact", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const stale = f.state.getSnapshot().undo;
      f.state.split(a.id, "c", "bottom");
      const before = f.state.getSnapshot();
      const current = before.undo;
      const references = [...f.records];
      const navigationCount = f.navigationCalls.length;
      let notifications = 0;
      const unsubscribe = f.state.subscribe(() => {
        notifications += 1;
      });
      for (const expected of [stale, { ...current }, null, undefined]) {
        f.state.dismissUndo(expected);
        assert.equal(f.state.getSnapshot(), before);
      }
      assert.equal(notifications, 0);
      f.state.dismissUndo(current);
      assert.equal(f.state.getSnapshot().undo, null);
      assert.equal(f.state.getSnapshot().tree, before.tree);
      assert.equal(f.state.getSnapshot().activeId, before.activeId);
      assert.equal(f.state.getSnapshot().maximizedId, before.maximizedId);
      assert.equal(f.navigationCalls.length, navigationCount);
      assert.deepEqual(f.records, references);
      assert.equal(notifications, 1);
      const dismissed = f.state.getSnapshot();
      f.state.dismissUndo(current);
      f.state.dismissUndo(null);
      f.state.undo();
      assert.equal(f.state.getSnapshot(), dismissed);
      assert.equal(notifications, 1);
      unsubscribe();
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("restores tree/focus without leaking undo metadata into the root snapshot", () => {
    const f = fixture();
    try {
      const initial = f.state.getSnapshot();
      f.state.split(initial.activeId, "b", "right");
      const firstUndo = f.state.getSnapshot().undo;
      assert.equal(firstUndo.id, 1);
      f.state.maximize(paneFor(f.state, "b").id);
      f.state.undo();
      const restored = f.state.getSnapshot();
      assert.equal(restored.tree, initial.tree);
      assert.equal(restored.activeId, initial.activeId);
      assert.equal(restored.maximizedId, null);
      assert.equal(restored.undo, null);
      assert.equal(Object.hasOwn(restored, "id"), false);
      assert.deepEqual(
        Object.keys(restored).sort(),
        Object.keys(initial).sort(),
      );
      f.state.split(initial.activeId, "b", "right");
      assert.equal(f.state.getSnapshot().undo.id, 2);
      f.state.dismissUndo(firstUndo);
      assert.equal(f.state.getSnapshot().undo.id, 2);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace reference ownership", () => {
  it("retains the initial chat once, and split/move never release sessions still shown", () => {
    const f = fixture();
    try {
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assertReferenceOwnership(f);
      const a = paneFor(f.state, "a");
      const aReference = f.state.reference("a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const bReference = f.state.reference("b");
      assert.notEqual(aReference.binding, bReference.binding);
      assertReferenceOwnership(f);
      f.state.move(b.id, a.id, "top");
      assert.deepEqual(sessionsIn(f.state), ["b", "a"]);
      assert.equal(f.state.reference("a"), aReference);
      assert.equal(f.state.reference("b"), bReference);
      assert.equal(f.records.length, 2);
      assert.ok(f.records.every((record) => record.releases === 0));
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("close releases only the removed chat and undo reacquires it without duplicating survivors", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const aReference = f.state.reference("a");
      const bReference = f.state.reference("b");
      f.state.close(b.id);
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assert.equal(bReference.releases, 1);
      assert.equal(aReference.releases, 0);
      assert.equal(f.state.getSnapshot().activeId, a.id);
      assertReferenceOwnership(f);
      f.state.undo();
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assert.equal(f.state.getSnapshot().undo, null);
      assert.equal(f.state.reference("a"), aReference);
      assert.notEqual(f.state.reference("b"), bReference);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("cannot close the last pane and one-shot undo removes a newly split pane", () => {
    const f = fixture();
    try {
      const initial = f.state.getSnapshot();
      f.state.close(initial.activeId);
      assert.equal(f.state.getSnapshot(), initial);
      f.state.split(initial.activeId, null, "bottom");
      assert.deepEqual(sessionsIn(f.state), ["a", null]);
      assertReferenceOwnership(f);
      f.state.undo();
      assert.equal(f.state.getSnapshot().tree, initial.tree);
      assert.equal(f.state.getSnapshot().activeId, initial.activeId);
      const restored = f.state.getSnapshot();
      f.state.undo();
      assert.equal(f.state.getSnapshot(), restored);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("restoration acquires every chat exactly once even when retain publishes synchronously", () => {
    const saved = {
      tree: split("root", leaf("first", "a"), leaf("second", "b")),
      activeId: "second",
    };
    const f = fixture({ saved });
    try {
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assert.equal(f.records.length, 2);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
    assert.ok(
      f.records.every((record) => record.releases === 1),
      "dispose must release every acquisition",
    );
  });
});

describe("workspace selection and navigation", () => {
  it("selecting an already visible chat focuses its existing pane instead of sharing bindings", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const before = f.state.getSnapshot().tree;
      f.state.select(a.id, "b");
      assert.equal(f.state.getSnapshot().tree, before);
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("dropping an existing chat moves its pane rather than creating a second composer", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const beforeReferences = [...f.records];
      f.state.split(a.id, "b", "top");
      assert.deepEqual(sessionsIn(f.state), ["b", "a"]);
      assert.equal(paneFor(f.state, "b").id, b.id);
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assert.deepEqual(f.records, beforeReferences);
      const beforeSelf = f.state.getSnapshot();
      f.state.split(b.id, "b", "right");
      assert.equal(f.state.getSnapshot(), beforeSelf);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("external mainView navigation replaces only the focused pane and releases its previous chat", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, null, "right");
      const empty = paneFor(f.state, null);
      const aReference = f.state.reference("a");
      f.navigation.openSession("c");
      assert.equal(paneFor(f.state, "c").id, empty.id);
      assert.equal(paneFor(f.state, "a"), a);
      assert.equal(f.state.getSnapshot().activeId, empty.id);
      assert.equal(f.state.reference("a"), aReference);
      const cReference = f.state.reference("c");
      f.navigation.openSession("d");
      assert.deepEqual(sessionsIn(f.state), ["a", "d"]);
      assert.equal(paneFor(f.state, "d").id, empty.id);
      assert.equal(cReference.releases, 1);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("external navigation to a visible session changes focus without replacing an empty pane", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      f.state.split(b.id, null, "bottom");
      const empty = paneFor(f.state, null);
      const tree = f.state.getSnapshot().tree;
      f.navigation.openSession("a");
      assert.equal(f.state.getSnapshot().activeId, a.id);
      assert.equal(f.state.getSnapshot().tree, tree);
      assert.equal(
        findLeaf(f.state.getSnapshot().tree, empty.id).sessionId,
        null,
      );
      assert.deepEqual(sessionsIn(f.state), ["a", "b", null]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("metadata updates after plugin navigation cannot steal focus from an empty pane", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.select(a.id, "b");
      f.state.split(a.id, null, "right");
      const empty = paneFor(f.state, null);
      assert.equal(f.state.getSnapshot().activeId, empty.id);
      const before = f.state.getSnapshot();
      f.metadata("b", { title: "Renamed chat", blank: true });
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.state.getSnapshot().activeId, empty.id);
      assert.equal(
        findLeaf(f.state.getSnapshot().tree, empty.id).sessionId,
        null,
      );
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("a new session retain notification cannot undo focus chosen by a nested split", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      f.state.split(b.id, "c", "bottom");
      const c = paneFor(f.state, "c");
      assert.equal(f.state.getSnapshot().activeId, c.id);
      assert.equal(f.navigationCalls.at(-1), "c");
      assert.deepEqual(sessionsIn(f.state), ["a", "b", "c"]);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("plugin navigation from an initially empty mainView establishes a metadata baseline", () => {
    const f = fixture({ main: null });
    try {
      const firstId = f.state.getSnapshot().activeId;
      f.state.select(firstId, "b");
      f.state.split(firstId, null, "right");
      const empty = paneFor(f.state, null);
      const before = f.state.getSnapshot();
      assert.equal(before.activeId, empty.id);
      f.metadata("b", { title: "Renamed after first selection" });
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(f.state.getSnapshot().activeId, empty.id);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("loading lists defer navigation, and steady-state metadata leaves a focused empty pane alone", () => {
    const f = fixture({ phase: "loading" });
    try {
      assert.deepEqual(sessionsIn(f.state), [null]);
      assert.equal(f.records.length, 0);
      f.phase("ready");
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      const a = paneFor(f.state, "a");
      f.state.split(a.id, null, "left");
      const before = f.state.getSnapshot();
      f.metadata("a", { title: "A different title" });
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(paneFor(f.state, null).id, before.activeId);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace recovery", () => {
  it("defers restored-session retention until the catalog is ready", () => {
    const saved = {
      tree: split("restored-root", leaf("first", "a"), leaf("second", "b")),
      activeId: "second",
    };
    const f = fixture({ saved, phase: "loading" });
    try {
      assert.deepEqual(f.state.getSnapshot().tree, saved.tree);
      assert.equal(f.state.getSnapshot().activeId, "second");
      assert.equal(f.records.length, 0);
      assert.equal(f.state.reference("a"), undefined);
      f.metadata("a", { title: "Catalog still loading" });
      assert.equal(f.records.length, 0);
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      f.phase("ready");
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assert.equal(f.state.getSnapshot().activeId, "first");
      assert.equal(f.records.length, 2);
      assertReferenceOwnership(f);
      f.emit();
      assert.equal(f.records.length, 2);
    } finally {
      f.state.dispose();
    }
  });

  for (const missingId of ["missing", "__proto__", "toString", "constructor"]) {
    it(`clears unavailable restored session ${missingId} without acquiring it`, () => {
      const saved = {
        tree: split(
          "restored-root",
          leaf("first", "a"),
          leaf("second", missingId),
          "vertical",
          0.7,
        ),
        activeId: "second",
      };
      const f = fixture({ saved, main: null, phase: "loading" });
      try {
        assert.deepEqual(sessionsIn(f.state), ["a", missingId]);
        assert.equal(f.records.length, 0);
        f.phase("ready");
        assert.deepEqual(sessionsIn(f.state), ["a", null]);
        const recovered = f.state.getSnapshot();
        assert.equal(recovered.activeId, "second");
        assert.equal(recovered.tree.id, "restored-root");
        assert.equal(recovered.tree.axis, "vertical");
        assert.equal(recovered.tree.ratio, 0.7);
        assert.equal(findLeaf(recovered.tree, "second").id, "second");
        assert.equal(recovered.warning, null);
        assert.equal(f.state.reference(missingId), undefined);
        assert.deepEqual(
          f.records.map((record) => record.sessionId),
          ["a"],
        );
        assert.deepEqual(f.retainCalls, ["a"]);
        assertReferenceOwnership(f);
        assert.deepEqual(JSON.parse(f.saved()).tree, recovered.tree);
      } finally {
        f.state.dispose();
      }
    });
  }

  it("starts an already-ready catalog with unknown persisted IDs as empty panes without retain attempts", () => {
    const saved = {
      tree: leaf("persisted-pane", "missing"),
      activeId: "persisted-pane",
    };
    const f = fixture({ saved, main: null });
    try {
      assert.deepEqual(
        f.state.getSnapshot().tree,
        leaf("persisted-pane", null),
      );
      assert.equal(f.state.getSnapshot().activeId, "persisted-pane");
      assert.equal(f.state.getSnapshot().warning, null);
      assert.deepEqual(f.retainCalls, []);
      assert.deepEqual(
        JSON.parse(f.saved()).tree,
        leaf("persisted-pane", null),
      );
    } finally {
      f.state.dispose();
    }
  });

  it("clears a removed live session without losing pane identity or replacing another chat", () => {
    const f = fixture();
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      const b = paneFor(f.state, "b");
      const aReference = f.state.reference("a");
      const bReference = f.state.reference("b");
      f.removeSession("b");
      assert.deepEqual(sessionsIn(f.state), ["a", null]);
      assert.equal(findLeaf(f.state.getSnapshot().tree, b.id).sessionId, null);
      assert.equal(f.state.getSnapshot().activeId, b.id);
      assert.equal(f.state.reference("a"), aReference);
      assert.equal(bReference.releases, 1);
      assertReferenceOwnership(f);
      f.navigation.openSession("c");
      assert.equal(paneFor(f.state, "c").id, b.id);
      assert.equal(paneFor(f.state, "a"), a);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("ready transitions with no main chat retain restored panes without treating metadata as navigation", () => {
    const saved = {
      tree: split("root", leaf("first", "a"), leaf("second", null)),
      activeId: "second",
    };
    const f = fixture({ saved, main: null, phase: "loading" });
    try {
      f.phase("ready");
      const before = f.state.getSnapshot();
      f.metadata("a", { title: "Restored metadata" });
      assert.equal(f.state.getSnapshot(), before);
      assert.equal(before.activeId, "second");
      assertReferenceOwnership(f);
      f.navigation.openSession("b");
      assert.equal(paneFor(f.state, "b").id, "second");
      assert.equal(paneFor(f.state, "a").id, "first");
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });
});

describe("workspace persistence and lifecycle", () => {
  it("restores a valid layout and active pane with no mainView chat, then persists changes", () => {
    const saved = {
      tree: split(
        "root",
        leaf("first", "a"),
        leaf("second", null),
        "vertical",
        0.6,
      ),
      activeId: "second",
    };
    const f = fixture({ saved, main: null });
    try {
      assert.deepEqual(f.state.getSnapshot().tree, saved.tree);
      assert.equal(f.state.getSnapshot().activeId, "second");
      assertReferenceOwnership(f);
      f.state.resize("root", 0.7);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.7);
      const persisted = JSON.parse(f.saved());
      assert.deepEqual(persisted, {
        tree: f.state.getSnapshot().tree,
        activeId: "second",
      });
      f.state.maximize("second");
      assert.equal(f.state.getSnapshot().maximizedId, "second");
      assert.equal(JSON.parse(f.saved()).maximizedId, undefined);
      f.state.maximize("second");
      assert.equal(f.state.getSnapshot().maximizedId, null);
    } finally {
      f.state.dispose();
    }
  });

  it("falls back to a safe initial pane for malformed layouts and duplicate session restoration", () => {
    for (const saved of [
      { tree: { type: "leaf", id: "bad", sessionId: 42 }, activeId: "bad" },
      { tree: split("root", leaf("a", "a"), leaf("b", "a")), activeId: "b" },
      {
        tree: split("root", leaf("same", "a"), leaf("same", "b")),
        activeId: "same",
      },
      {
        tree: split("root", leaf("a", "a"), leaf("b", "b"), "diagonal"),
        activeId: "a",
      },
    ]) {
      const f = fixture({ saved, main: null });
      try {
        assert.deepEqual(sessionsIn(f.state), [null]);
        assert.equal(leaves(f.state.getSnapshot().tree).length, 1);
        assert.equal(f.records.length, 0);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("invalid persisted active IDs fall back to the first pane; multiple empty panes are allowed", () => {
    const tree = split("root", leaf("first"), leaf("second"));
    const f = fixture({ saved: { tree, activeId: "missing" }, main: null });
    try {
      assert.deepEqual(f.state.getSnapshot().tree, tree);
      assert.equal(f.state.getSnapshot().activeId, "first");
      assert.equal(f.records.length, 0);
    } finally {
      f.state.dispose();
    }
  });

  it("storage read/parse failures report a warning without preventing the initial chat", (t) => {
    t.mock.method(console, "warn", () => {});
    for (const options of [
      { readError: new Error("blocked") },
      { saved: "{bad json" },
    ]) {
      const f = fixture(options);
      try {
        assert.deepEqual(sessionsIn(f.state), ["a"]);
        assert.match(f.state.getSnapshot().warning, /could not be restored/);
        assertReferenceOwnership(f);
      } finally {
        f.state.dispose();
      }
    }
  });

  it("storage write failures preserve layout, references and subscriber notifications", (t) => {
    t.mock.method(console, "warn", () => {});
    const f = fixture({ writeError: new Error("quota") });
    let notifications = 0;
    const unsubscribe = f.state.subscribe(() => {
      notifications += 1;
    });
    try {
      const a = paneFor(f.state, "a");
      f.state.split(a.id, "b", "right");
      assert.deepEqual(sessionsIn(f.state), ["a", "b"]);
      assert.match(f.state.getSnapshot().warning, /could not be saved/);
      assert.ok(notifications > 0);
      assertReferenceOwnership(f);
      unsubscribe();
      const before = notifications;
      f.state.resize(f.state.getSnapshot().tree.id, 0.6);
      assert.equal(notifications, before);
      assert.equal(f.state.getSnapshot().tree.ratio, 0.6);
    } finally {
      unsubscribe();
      f.state.dispose();
    }
  });

  it("retain failures keep pane layout available and expose an actionable warning", () => {
    const f = fixture({ retainError: new Error("Session unavailable") });
    try {
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assert.match(f.state.getSnapshot().warning, /Session unavailable/);
      assert.equal(f.state.reference("a"), undefined);
      f.state.split(f.state.getSnapshot().activeId, null, "right");
      assert.deepEqual(sessionsIn(f.state), ["a", null]);
    } finally {
      f.state.dispose();
    }
  });

  it("ready promise rejection is surfaced without sleep or dropping the pane", async () => {
    const f = fixture({ readyError: new Error("History unavailable") });
    try {
      await f.records[0].ready.catch(() => {});
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assert.match(f.state.getSnapshot().warning, /History unavailable/);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("pending ready failures do not publish after disposal", async () => {
    const f = fixture({ readyError: new Error("Late failure") });
    const before = f.state.getSnapshot();
    let notifications = 0;
    f.state.subscribe(() => {
      notifications += 1;
    });
    f.state.dispose();
    await f.records[0].ready.catch(() => {});
    assert.equal(f.state.getSnapshot(), before);
    assert.equal(f.state.getSnapshot().warning, null);
    assert.equal(notifications, 0);
    assert.equal(f.records[0].releases, 1);
  });

  it("dispose releases each acquisition once and detaches navigation/subscribers", () => {
    const f = fixture();
    const a = paneFor(f.state, "a");
    f.state.split(a.id, "b", "right");
    let notifications = 0;
    f.state.subscribe(() => {
      notifications += 1;
    });
    const before = f.state.getSnapshot();
    f.state.dispose();
    assert.ok(f.records.every((record) => record.releases === 1));
    assert.equal(f.state.reference("a"), undefined);
    assert.equal(f.state.reference("b"), undefined);
    f.navigation.openSession("c");
    f.metadata("a", { title: "After disposal" });
    assert.equal(f.state.getSnapshot(), before);
    assert.equal(notifications, 0);
    f.state.dispose();
    assert.ok(f.records.every((record) => record.releases === 1));
  });
});

describe("workspace tab activation", () => {
  const saved = {
    tree: split("s", leaf("p1", "b"), leaf("p2", "c")),
    activeId: "p1",
  };

  it("persists under a per-tab storage key", () => {
    const f = fixture({ storageKey: `${STORAGE_KEY}:tab-2`, saved, main: "b" });
    assert.deepEqual(sessionsIn(f.state), ["b", "c"]);
    f.state.focus("p2");
    assert.equal(JSON.parse(f.saved()).activeId, "p2");
  });

  it("keeps inactive chats retained without following main-view navigation", () => {
    const f = fixture({ saved, isActive: () => false });
    assert.deepEqual(sessionsIn(f.state), ["b", "c"]);
    f.navigation.openSession("d");
    assert.deepEqual(sessionsIn(f.state), ["b", "c"]);
    assert.equal(f.retained("b").length, 1);
    assert.equal(f.retained("c").length, 1);
    f.state.focus("p2");
    assert.deepEqual(f.navigationCalls, ["d"]);
  });

  it("still drops deleted chats while inactive", () => {
    const f = fixture({ saved, isActive: () => false });
    f.removeSession("c");
    assert.deepEqual(sessionsIn(f.state), ["b", null]);
  });

  it("starts blank when not adopting the open main chat", () => {
    const f = fixture({ adoptMainView: false });
    assert.deepEqual(sessionsIn(f.state), [null]);
    assert.deepEqual(f.navigationCalls, []);
    f.navigation.openSession("b");
    assert.deepEqual(sessionsIn(f.state), ["b"]);
  });

  it("activate re-opens the focused chat instead of adopting a stale main chat", () => {
    let active = false;
    const f = fixture({ saved, isActive: () => active });
    f.navigation.openSession("d");
    active = true;
    f.state.activate();
    assert.deepEqual(f.navigationCalls, ["d", "b"]);
    assert.deepEqual(sessionsIn(f.state), ["b", "c"]);
    f.navigation.openSession("a");
    assert.deepEqual(sessionsIn(f.state), ["a", "c"]);
  });

  it("activating a blank tab leaves the previous main chat out of it", () => {
    let active = false;
    const f = fixture({ isActive: () => active, adoptMainView: false });
    active = true;
    f.state.activate();
    assert.deepEqual(sessionsIn(f.state), [null]);
    assert.deepEqual(f.navigationCalls, []);
  });
});

describe("workspace background chats with keep-mounted tabs", () => {
  it("keeps a replaced chat retained behind its pane and restores it there without reacquiring", () => {
    const f = fixture();
    try {
      const pane = paneFor(f.state, "a");
      const aReference = f.state.reference("a");
      f.state.retainTab("a", new AbortController().signal);
      f.navigation.openSession("b");
      assert.deepEqual(sessionsIn(f.state), ["b"]);
      assert.deepEqual(f.state.getSnapshot().background, { a: pane.id });
      assert.equal(f.state.reference("a"), aReference);
      assert.equal(aReference.releases, 0);
      f.navigation.openSession("a");
      assert.deepEqual(sessionsIn(f.state), ["a"]);
      assert.equal(paneFor(f.state, "a").id, pane.id);
      assert.deepEqual(f.state.getSnapshot().background, {});
      assert.equal(f.state.reference("a"), aReference);
      assert.equal(f.retained("a").length, 1);
      assert.equal(f.records.filter((r) => r.sessionId === "a").length, 1);
    } finally {
      f.state.dispose();
    }
  });

  it("releases a background chat when its last held tab is released or closed", () => {
    const f = fixture();
    try {
      const pane = paneFor(f.state, "a");
      const aReference = f.state.reference("a");
      const release = f.state.retainTab("a", new AbortController().signal);
      const closing = new AbortController();
      f.state.retainTab("a", closing.signal);
      f.state.select(pane.id, "b");
      release();
      release();
      assert.deepEqual(f.state.getSnapshot().background, { a: pane.id });
      assert.equal(aReference.releases, 0);
      closing.abort();
      assert.deepEqual(f.state.getSnapshot().background, {});
      assert.equal(aReference.releases, 1);
      assert.equal(f.state.reference("a"), undefined);
    } finally {
      f.state.dispose();
    }
  });

  it("still releases replaced chats that hold no keep-mounted tabs", () => {
    const f = fixture();
    try {
      const aReference = f.state.reference("a");
      f.navigation.openSession("b");
      assert.deepEqual(f.state.getSnapshot().background, {});
      assert.equal(aReference.releases, 1);
    } finally {
      f.state.dispose();
    }
  });

  it("closing a pane drops its background chats, and reopening elsewhere leaves the background", () => {
    const f = fixture();
    try {
      const first = paneFor(f.state, "a");
      f.state.split(first.id, "b", "right");
      const second = paneFor(f.state, "b");
      const bReference = f.state.reference("b");
      f.state.retainTab("a", new AbortController().signal);
      f.state.retainTab("b", new AbortController().signal);
      f.state.select(first.id, "c");
      f.state.select(second.id, "d");
      assert.deepEqual(f.state.getSnapshot().background, {
        a: first.id,
        b: second.id,
      });
      f.state.select(second.id, "a");
      assert.deepEqual(f.state.getSnapshot().background, { b: second.id });
      assert.equal(paneFor(f.state, "a").id, second.id);
      f.state.close(second.id);
      assert.deepEqual(f.state.getSnapshot().background, {});
      assert.equal(bReference.releases, 1);
      assertReferenceOwnership(f);
    } finally {
      f.state.dispose();
    }
  });

  it("never persists background chats", () => {
    const f = fixture();
    try {
      f.state.retainTab("a", new AbortController().signal);
      f.navigation.openSession("b");
      assert.deepEqual(Object.keys(f.writes.at(-1)).sort(), [
        "activeId",
        "tree",
      ]);
    } finally {
      f.state.dispose();
    }
  });
});
