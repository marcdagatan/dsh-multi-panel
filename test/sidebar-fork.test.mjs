import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { SlotCore } from "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js";
import { buildSidebarFork } from "../scripts/sidebar-fork.mjs";
import { normalizePreferences } from "../client/preferences.mjs";
import {
  buildSidebarDockkit,
  freeIdentifiers,
} from "../scripts/sidebar-dockkit.mjs";
import {
  createSidebarPane,
  sidebarRectangles,
  sidebarWidth,
} from "../client/sidebar-pane.mjs";

const native = readFileSync(
  new URL(
    "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js",
    import.meta.url,
  ),
  "utf8",
);
const shell = readFileSync(
  new URL(
    "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js",
    import.meta.url,
  ),
  "utf8",
);
const compiled = buildSidebarFork(native, shell);
const identity = (value) => JSON.parse(JSON.stringify(value));
const observable = (initial) => {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next) => {
      value = next;
      listeners.forEach((fn) => fn());
    },
  };
};
const storeRuntime = {
  createSnapshotStore: observable,
  notifySubscribers: (listeners) => listeners.forEach((fn) => fn()),
  defineStore: (spec) => ({
    spec,
    create: () => {
      const store = observable(spec.init());
      const actions = Object.fromEntries(
        Object.entries(spec.actions).map(([name, fn]) => [
          name,
          (...args) => {
            const draft = structuredClone(store.getSnapshot());
            fn(draft, ...args);
            store.set(draft);
          },
        ]),
      );
      return { ...store, store, actions, clearPersisted() {} };
    },
  }),
};
const storage = () => {
  const values = new Map();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const primitives = new Proxy(
  {
    MenuSurface: React.forwardRef((props, ref) =>
      jsx.jsx("div", { ...props, ref }),
    ),
    Tooltip: ({ children }) => children,
    modalSelector: '[role="dialog"][aria-modal="true"], [role="menu"]',
    observeComposition: () => ({ guards: () => false, dispose() {} }),
    focusWithoutRing: (element, options) => element.focus(options),
  },
  { get: (target, key) => target[key] ?? (() => null) },
);
const requireNative = (name) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "react-dom") return ReactDOM;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
  if (name === "@deepseek-ai/dsh-client-store") return storeRuntime;
  throw new Error(`Unexpected native module ${name}`);
};
function loadSidebar(localStorage, document) {
  let result;
  const instrumented = compiled
    .replace(
      "exports.apply = apply;",
      "exports.testing = { createSidebarRightStore, createSidebarRightController, readSidebarLayout, validateReferences, sidebarMoveKeepsCount, dockkit: _deepseek_ai_dsh_client_ui_dockkit }; exports.apply = apply;",
    )
    .replace("return XS;", "return { ...XS, testingDropTarget: l4 };");
  const ownerDocument = document ?? {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  new Function(
    "window",
    "document",
    "localStorage",
    "MutationObserver",
    instrumented,
  )(
    {
      __ModuleLoader__: {
        load: (definition) => {
          result = definition.factory(requireNative);
        },
      },
    },
    ownerDocument,
    localStorage,
    class {
      observe() {}
      disconnect() {}
    },
  );
  return result;
}
function setup(localStorage = storage(), document, core, preferencesSource) {
  const module = loadSidebar(localStorage, document);
  const services = {};
  const startupTrace = [];
  const registrations = [];
  const releases = [];
  const retainCounts = new Map();
  const current = observable({ key: "alpha" });
  const context = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => {
      const release = fn() ?? (() => {});
      releases.push(release);
      return release;
    },
    sessions: {
      retain: (id) => {
        retainCounts.set(id, (retainCounts.get(id) ?? 0) + 1);
        return {
          ready: Promise.resolve(),
          release: () => retainCounts.set(id, retainCounts.get(id) - 1),
        };
      },
    },
    uiSession: { adapter: { current } },
    resources: { pin() {} },
    layout: {
      panelInfo: observable({ activePanelId: null }),
      openRightbar: () => {
        throw new Error("Global layout presentation must not change");
      },
      closeRightbar: () => {
        throw new Error("Global layout presentation must not change");
      },
    },
    reflect: {
      provide: (key, value) => {
        services[key] = value;
        startupTrace.push(`service:${key}`);
        return () => {
          delete services[key];
        };
      },
    },
    shortcuts: {
      register: () => () => {},
      catalog: observable([]),
      closeWindow: () => Promise.resolve(),
    },
    slots: {
      inject: (name, factory) => {
        const release = factory();
        if (release?.[Symbol.iterator])
          for (const item of release) {
            void item;
          }
        return () => {};
      },
      register: (options, component) => {
        registrations.push({ options, component });
        startupTrace.push(`slot:${options.name}`);
        return core ? core.register(options, component) : () => {};
      },
    },
  };
  // apply installs a presentation style unconditionally; this small document is only
  // the explicit native style lifecycle, not a substitute for component tests.
  const styleDocument = document ?? {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  };
  const savedDocument = globalThis.document;
  globalThis.document = styleDocument;
  try {
    const declared = new Set([...module.inject, "effect", "reflect"]);
    module.apply(
      new Proxy(context, {
        get(target, key) {
          if (!declared.has(key))
            throw new Error(
              `Sidebar accessed undeclared context key ${String(key)}`,
            );
          return target[key];
        },
      }),
      { preferencesSource },
    );
  } finally {
    globalThis.document = savedDocument;
  }
  const seat = registrations.find(
    (entry) => entry.options.name === "dsh.multi.sidebar",
  );
  const instantiate = (id) => {
    const instance = seat.options.store.create(id);
    instance.actions.open(id);
    return instance;
  };
  return {
    module,
    context,
    services,
    startupTrace,
    registrations,
    seat,
    instantiate,
    localStorage,
    current,
    retainCounts,
    releases,
  };
}

test("fork is hash pinned, keeps native extension slots, and does not occupy global rightbar", () => {
  assert.throws(() => buildSidebarFork(native + "\n", shell), /SHA-256/);
  assert.throws(() => buildSidebarDockkit(shell + "\n"), /SHA-256/);
  const owner = setup();
  assert.deepEqual(Object.keys(owner.seat.options.children), [
    "sidebar.right.pane.tab",
    "sidebar.right.pane.tab.title",
    "sidebar.right.tab.menu.item",
  ]);
  assert.ok(owner.services.sidebarRight);
  assert.ok(owner.services.sidebarRightTabs);
  assert.equal(
    owner.registrations.some((entry) =>
      ["rightbar", "rightbar.session"].includes(entry.options.name),
    ),
    false,
  );
  owner.seat.options
    .inject("alpha")
    .syncPresentation({ shown: true, track: true, fullscreen: true });
});

test("sidebar startup satisfies real native slot ownership and publishes services before seats", () => {
  const core = new SlotCore();
  core.register(
    {
      name: "root",
      children: {
        "dsh.multi.sidebar": { kind: "single", scope: "session" },
        "conversation.session.header.corner": {
          kind: "single",
          scope: "session",
        },
      },
    },
    () => null,
  );
  const owner = setup(storage(), undefined, core);
  assert.deepEqual(owner.module.inject, [
    "slots",
    "layout",
    "locale",
    "resources",
    "sessions",
    "uiSession",
    "shortcuts",
  ]);
  const seatIndex = owner.startupTrace.indexOf("slot:dsh.multi.sidebar");
  assert.ok(owner.startupTrace.indexOf("service:sidebarRight") < seatIndex);
  assert.ok(owner.startupTrace.indexOf("service:sidebarRightTabs") < seatIndex);
  assert.equal(core.spec("sidebar.right.pane.tab").scope, "session");
  assert.equal(core.spec("sidebar.right.tab.guide.entry").kind, "keyed");
  assert.throws(
    () => setup(storage(), undefined, core),
    /single slot "dsh.multi.sidebar" already has a registration/,
  );
});

test("an enabled original sidebar declaration causes a concrete boot collision", () => {
  const core = new SlotCore();
  core.register(
    {
      name: "root",
      children: {
        rightbar: { kind: "single", scope: "root" },
        "dsh.multi.sidebar": { kind: "single", scope: "session" },
        "conversation.session.header.corner": {
          kind: "single",
          scope: "session",
        },
      },
    },
    () => null,
  );
  core.register(
    {
      name: "rightbar",
      children: { "rightbar.session": { kind: "single", scope: "session" } },
    },
    () => null,
  );
  core.register(
    {
      name: "rightbar.session",
      children: {
        "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
      },
    },
    () => null,
  );
  assert.throws(
    () => setup(storage(), undefined, core),
    /slot "sidebar.right.pane.tab" is already declared/,
  );
});

test("session-bound sidebar controls isolate unfocused sessions and tab occurrence lifetimes", () => {
  const owner = setup();
  const alpha = owner.instantiate("alpha");
  const beta = owner.instantiate("beta");
  const alphaProps = owner.seat.options.inject("alpha");
  const betaProps = owner.seat.options.inject("beta");
  alphaProps.openTab("guide");
  betaProps.openTab("guide");
  const beforeAlpha = identity(alpha.getSnapshot());
  const betaLayout = beta.getSnapshot().bySession.beta.layout;
  const tabId = betaLayout.nodes[betaLayout.rootId].activeTabId;
  const occurrence = owner.services.sidebarRight.tabDomain.occurrence("beta", {
    id: tabId,
  });
  betaProps.splitPane(betaLayout.rootId, "bottom");
  betaProps.toggleFullscreen();
  assert.deepEqual(identity(alpha.getSnapshot()), beforeAlpha);
  assert.equal(beta.getSnapshot().bySession.beta.layout.mode, "fullscreen");
  assert.equal(
    beta.getSnapshot().bySession.beta.layout.nodes[
      beta.getSnapshot().bySession.beta.layout.rootId
    ].axis,
    "column",
  );
  assert.equal(occurrence.signal.aborted, false);
  owner.services.sidebarRight.closeIn("beta", tabId);
  assert.equal(occurrence.signal.aborted, true);
  assert.equal(owner.services.sidebarRight.mounted.getSnapshot(), "alpha");
});

test("configured incoming shares cover all edges, merged siblings, and native undo without replacing tabs", () => {
  for (const direction of ["left", "right", "top", "bottom"]) {
    const preferences = observable(
      normalizePreferences({
        sidebarSplitRatio: 0.3,
        sidebarSplitDirection: "right",
        sidebarMaxPanes: 4,
      }),
    );
    const owner = setup(storage(), undefined, undefined, preferences);
    const instance = owner.instantiate("alpha");
    instance.actions.setExpanded("alpha", true);
    const props = owner.seat.options.inject("alpha");
    const dockkit = owner.module.testing.dockkit;
    const original = instance.getSnapshot().bySession.alpha.layout.rootId;
    const tabId =
      instance.getSnapshot().bySession.alpha.layout.nodes[original].activeTabId;
    const occurrence = owner.services.sidebarRight.tabDomain.occurrence(
      "alpha",
      { id: tabId },
    );
    const incoming = props.splitPane(original, direction);
    const firstLayout = instance.getSnapshot().bySession.alpha.layout;
    const firstParent = dockkit.findParent(firstLayout, incoming);
    assert.equal(
      firstParent.axis,
      direction === "left" || direction === "right" ? "row" : "column",
    );
    assert.equal(
      firstParent.children[direction === "left" || direction === "top" ? 0 : 1],
      incoming,
    );
    assert.ok(
      Math.abs(
        firstParent.sizes[firstParent.children.indexOf(incoming)] - 0.3,
      ) < 1e-12,
    );
    const second = props.splitPane(original, direction);
    const secondLayout = instance.getSnapshot().bySession.alpha.layout;
    const merged = dockkit.findParent(secondLayout, second);
    assert.equal(merged.id, firstParent.id);
    assert.equal(merged.children.length, 3);
    assert.ok(
      Math.abs(merged.sizes[merged.children.indexOf(second)] - 0.21) < 1e-12,
    );
    assert.ok(
      Math.abs(merged.sizes[merged.children.indexOf(incoming)] - 0.3) < 1e-12,
    );
    owner.module.testing.validateReferences(
      instance.getSnapshot().bySession.alpha,
    );
    instance.actions.undo("alpha");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(firstLayout),
    );
    instance.actions.redo("alpha");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(secondLayout),
    );
    assert.equal(
      owner.services.sidebarRight.tabDomain.occurrence("alpha", { id: tabId }),
      occurrence,
    );
    assert.equal(occurrence.signal.aborted, false);
  }
});

test("live native split preferences enforce budgets, preserve existing panes, and allow center moves", () => {
  const preferences = observable(
    normalizePreferences({
      sidebarSplitRatio: 0.65,
      sidebarSplitDirection: "bottom",
      sidebarMaxPanes: 2,
    }),
  );
  const owner = setup(storage(), undefined, undefined, preferences);
  const instance = owner.instantiate("alpha");
  instance.actions.setExpanded("alpha", true);
  const props = owner.seat.options.inject("alpha");
  const dockkit = owner.module.testing.dockkit;
  const original = instance.getSnapshot().bySession.alpha.layout.rootId;
  props.measureRoom((_paneId, direction) => direction === "bottom");
  assert.equal(props.splitPane(original, "right"), undefined);
  const incoming = props.splitPane(original);
  const before = instance.getSnapshot().bySession.alpha.layout;
  const parent = dockkit.findParent(before, incoming);
  assert.equal(parent.axis, "column");
  assert.equal(parent.children[1], incoming);
  assert.ok(Math.abs(parent.sizes[1] - 0.65) < 1e-12);
  preferences.set(normalizePreferences({ sidebarMaxPanes: 1 }));
  assert.deepEqual(
    identity(instance.getSnapshot().bySession.alpha.layout),
    identity(before),
  );
  assert.equal(dockkit.canSplit(before), false);
  assert.equal(props.splitPane(original), undefined);
  instance.actions.splitPane("alpha", original);
  assert.equal(
    dockkit.dockPaneIds(instance.getSnapshot().bySession.alpha.layout).length,
    2,
  );
  let opened;
  instance.actions.openContent(
    "alpha",
    {
      kind: "guide",
      contentId: "test/incoming",
      title: "Incoming",
      paneId: original,
      preferNewPane: true,
    },
    (id) => {
      opened = id;
    },
  );
  const atBudget = instance.getSnapshot().bySession.alpha.layout;
  assert.equal(dockkit.dockPaneIds(atBudget).length, 2);
  assert.equal(dockkit.findTabPane(atBudget, opened).id, original);
  preferences.set(
    normalizePreferences({
      sidebarMaxPanes: 3,
      sidebarSplitDirection: "left",
      sidebarSplitRatio: 0.2,
    }),
  );
  let third;
  instance.actions.splitPane("alpha", original, (id) => {
    third = id;
  });
  const changed = instance.getSnapshot().bySession.alpha.layout;
  const changedParent = dockkit.findParent(changed, third);
  assert.equal(changedParent.axis, "row");
  assert.equal(changedParent.children[0], third);
  assert.ok(Math.abs(changedParent.sizes[0] - 0.2) < 1e-12);
  preferences.set(
    normalizePreferences({
      sidebarMaxPanes: 4,
      sidebarSplitDirection: "top",
      sidebarSplitRatio: 0.4,
    }),
  );
  let preferred;
  instance.actions.openContent(
    "alpha",
    {
      kind: "guide",
      contentId: "test/preferred",
      title: "Preferred",
      paneId: third,
      preferNewPane: true,
    },
    (id) => {
      preferred = id;
    },
  );
  const preferredLayout = instance.getSnapshot().bySession.alpha.layout;
  const preferredPane = dockkit.findTabPane(preferredLayout, preferred);
  const preferredParent = dockkit.findParent(preferredLayout, preferredPane.id);
  assert.equal(dockkit.dockPaneIds(preferredLayout).length, 4);
  assert.equal(preferredParent.axis, "column");
  assert.equal(preferredParent.children[0], preferredPane.id);
  assert.ok(Math.abs(preferredParent.sizes[0] - 0.4) < 1e-12);
  preferences.set(normalizePreferences({ sidebarMaxPanes: 1 }));
  assert.deepEqual(
    identity(owner.module.testing.readSidebarLayout("alpha").layout),
    identity(preferredLayout),
  );
  instance.actions.dropTab("alpha", opened, incoming, "center");
  assert.equal(
    dockkit.findTabPane(instance.getSnapshot().bySession.alpha.layout, opened)
      .id,
    incoming,
  );
  owner.module.testing.validateReferences(
    instance.getSnapshot().bySession.alpha,
  );
});

test("edge drops use configured incoming shares without changing the dragged occurrence", () => {
  for (const direction of ["left", "right", "top", "bottom"]) {
    const preferences = observable(
      normalizePreferences({
        sidebarSplitRatio: 0.7,
        sidebarSplitDirection: "bottom",
      }),
    );
    const owner = setup(storage(), undefined, undefined, preferences);
    const instance = owner.instantiate("alpha");
    instance.actions.setExpanded("alpha", true);
    const initial = instance.getSnapshot().bySession.alpha.layout;
    const tabId = initial.nodes[initial.rootId].activeTabId;
    const occurrence = owner.services.sidebarRight.tabDomain.occurrence(
      "alpha",
      { id: tabId },
    );
    instance.actions.dropTab("alpha", tabId, initial.rootId, direction);
    const result = instance.getSnapshot().bySession.alpha.layout;
    const dockkit = owner.module.testing.dockkit;
    const moved = dockkit.findTabPane(result, tabId);
    const parent = dockkit.findParent(result, moved.id);
    assert.equal(
      parent.axis,
      direction === "left" || direction === "right" ? "row" : "column",
    );
    assert.equal(
      parent.children[direction === "left" || direction === "top" ? 0 : 1],
      moved.id,
    );
    assert.ok(
      Math.abs(parent.sizes[parent.children.indexOf(moved.id)] - 0.7) < 1e-12,
    );
    assert.equal(
      owner.services.sidebarRight.tabDomain.occurrence("alpha", { id: tabId }),
      occurrence,
    );
    assert.equal(occurrence.signal.aborted, false);
  }
});

test("edge rearrangements at the configured or hard cap replace collapsed sources without allowing new panes", () => {
  for (const budget of [2, 16]) {
    const preferences = observable(
      normalizePreferences({ sidebarMaxPanes: budget, sidebarSplitRatio: 0.3 }),
    );
    const owner = setup(storage(), undefined, undefined, preferences);
    const instance = owner.instantiate("alpha");
    instance.actions.setExpanded("alpha", true);
    const { dockkit, sidebarMoveKeepsCount, validateReferences } =
      owner.module.testing;
    const original = instance.getSnapshot().bySession.alpha.layout.rootId;
    for (let index = 1; index < budget; index++)
      instance.actions.splitPane("alpha", original);
    const before = instance.getSnapshot().bySession.alpha.layout;
    const destination = dockkit.dockPaneIds(before).at(-1);
    const tabId = before.nodes[original].activeTabId;
    const occurrence = owner.services.sidebarRight.tabDomain.occurrence(
      "alpha",
      { id: tabId },
    );
    assert.equal(dockkit.canSplit(before), false);
    const root = {
      querySelectorAll: () =>
        [original, destination].map((id, index) => ({
          dataset: { dockkitPane: id },
          querySelector: () => null,
          getBoundingClientRect: () => ({
            x: index * 1000,
            y: 0,
            width: 1000,
            height: 800,
          }),
        })),
    };
    const preview = (state, x) =>
      dockkit.testingDropTarget(
        root,
        x,
        400,
        false,
        new Map(),
        "edges",
        (paneId) => sidebarMoveKeepsCount(state, tabId, paneId),
      );
    assert.deepEqual(identity(preview(before, 1030)), {
      kind: "zone",
      paneId: destination,
      zone: "left",
    });
    assert.equal(
      preview(before, 30),
      undefined,
      "splitting the source itself would create another pane",
    );
    instance.actions.dropTab("alpha", tabId, original, "left");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(before),
    );
    instance.actions.dropTab("alpha", tabId, destination, "bottom");
    const moved = instance.getSnapshot().bySession.alpha.layout;
    assert.equal(dockkit.dockPaneIds(moved).length, budget);
    assert.equal(moved.nodes[original], undefined);
    assert.notEqual(dockkit.findTabPane(moved, tabId).id, destination);
    assert.equal(
      owner.services.sidebarRight.tabDomain.occurrence("alpha", { id: tabId }),
      occurrence,
    );
    assert.equal(occurrence.signal.aborted, false);
    validateReferences(instance.getSnapshot().bySession.alpha);
    instance.actions.undo("alpha");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(before),
    );
    instance.actions.redo("alpha");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(moved),
    );
    instance.actions.undo("alpha");
    let extra;
    instance.actions.openContent(
      "alpha",
      {
        kind: "guide",
        contentId: `test/extra-${budget}`,
        title: "Extra",
        paneId: original,
      },
      (id) => {
        extra = id;
      },
    );
    const full = instance.getSnapshot().bySession.alpha.layout;
    assert.equal(full.nodes[original].tabs.length, 2);
    assert.equal(
      preview(full, 1030),
      undefined,
      "a nonempty source would leave a genuine extra pane",
    );
    instance.actions.dropTab("alpha", tabId, destination, "top");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(full),
    );
    instance.actions.floatTab("alpha", extra, {
      x: 20,
      y: 20,
      width: 300,
      height: 200,
    });
    const floated = instance.getSnapshot().bySession.alpha.layout;
    assert.equal(dockkit.findTabPane(floated, extra).host, "float");
    instance.actions.dropTab("alpha", extra, destination, "left");
    assert.deepEqual(
      identity(instance.getSnapshot().bySession.alpha.layout),
      identity(floated),
    );
    preferences.set(normalizePreferences({ sidebarMaxPanes: 1 }));
    instance.actions.dropTab("alpha", tabId, destination, "top");
    const overBudget = instance.getSnapshot().bySession.alpha.layout;
    assert.equal(dockkit.dockPaneIds(overBudget).length, budget);
    assert.equal(
      owner.services.sidebarRight.tabDomain.occurrence("alpha", { id: tabId }),
      occurrence,
    );
    validateReferences(instance.getSnapshot().bySession.alpha);
  }
});

test("directional split, nested resize, close, history, and persistence preserve native planning", () => {
  const owner = setup();
  const instance = owner.instantiate("alpha");
  instance.actions.setExpanded("alpha", true);
  const originalPane = instance.getSnapshot().bySession.alpha.layout.rootId;
  for (const direction of ["left", "top", "right", "bottom"])
    instance.actions.splitPane("alpha", originalPane, undefined, direction);
  const surface = instance.getSnapshot().bySession.alpha;
  const { dockkit, validateReferences, readSidebarLayout } =
    owner.module.testing;
  assert.equal(dockkit.dockPaneIds(surface.layout).length, 5);
  assert.ok(
    Object.values(surface.layout.nodes).some((node) => node.axis === "row"),
  );
  assert.ok(
    Object.values(surface.layout.nodes).some((node) => node.axis === "column"),
  );
  validateReferences(surface);
  assert.deepEqual(
    identity(readSidebarLayout("alpha").layout),
    identity(surface.layout),
  );
  instance.actions.undo("alpha");
  assert.equal(
    dockkit.dockPaneIds(instance.getSnapshot().bySession.alpha.layout).length,
    4,
  );
  instance.actions.redo("alpha");
  assert.equal(
    dockkit.dockPaneIds(instance.getSnapshot().bySession.alpha.layout).length,
    5,
  );
  for (let i = 0; i < 30; i++)
    instance.actions.splitPane("alpha", originalPane, undefined, "bottom");
  assert.equal(
    dockkit.dockPaneIds(instance.getSnapshot().bySession.alpha.layout).length,
    16,
  );
});

test("sidebar drag commits accept each edge and settle emptied panes", () => {
  for (const direction of ["left", "right", "top", "bottom"]) {
    const owner = setup();
    const instance = owner.instantiate("alpha");
    instance.actions.setExpanded("alpha", true);
    const layout = instance.getSnapshot().bySession.alpha.layout;
    const tabId = layout.nodes[layout.rootId].activeTabId;
    const held = owner.services.sidebarRight.tabDomain.occurrence("alpha", {
      id: tabId,
    });
    instance.actions.dropTab("alpha", tabId, layout.rootId, direction);
    const result = instance.getSnapshot().bySession.alpha.layout;
    const split = result.nodes[result.rootId];
    assert.equal(
      split.axis,
      direction === "left" || direction === "right" ? "row" : "column",
    );
    const movedPane = owner.module.testing.dockkit.findTabPane(result, tabId);
    assert.equal(
      split.children[direction === "left" || direction === "top" ? 0 : 1],
      movedPane.id,
    );
    assert.equal(
      owner.services.sidebarRight.tabDomain.occurrence("alpha", { id: tabId }),
      held,
    );
    owner.module.testing.validateReferences(
      instance.getSnapshot().bySession.alpha,
    );
  }
});

test("legacy sidebar snapshot is adopted without overwriting its rollback namespace", () => {
  const localStorage = storage();
  const { testing } = loadSidebar(localStorage);
  const old = testing
    .createSidebarRightStore(() => ({ kind: "guide", title: "Start" }))
    .create("legacy");
  old.actions.setExpanded("legacy", true);
  const value = localStorage.getItem("dsh.multi.sidebar.v1.legacy");
  localStorage.removeItem("dsh.multi.sidebar.v1.legacy");
  localStorage.setItem("dsh.sidebar-right.v1.legacy", value);
  const owner = setup(localStorage);
  const instance = owner.instantiate("legacy");
  const pane = instance.getSnapshot().bySession.legacy.layout.rootId;
  instance.actions.splitPane("legacy", pane, undefined, "top");
  assert.equal(localStorage.getItem("dsh.sidebar-right.v1.legacy"), value);
  assert.ok(localStorage.getItem("dsh.multi.sidebar.v1.legacy"));
});

test("flattened all-axis geometry tiles nested layouts and applies live resize previews", () => {
  const state = {
    rootId: "root",
    nodes: {
      root: {
        kind: "split",
        axis: "row",
        children: ["left", "right"],
        sizes: [0.4, 0.6],
      },
      left: { kind: "pane" },
      right: {
        kind: "split",
        axis: "column",
        children: ["top", "bottom"],
        sizes: [0.25, 0.75],
      },
      top: { kind: "pane" },
      bottom: { kind: "pane" },
    },
  };
  const result = sidebarRectangles(state);
  assert.deepEqual(result.panes.get("bottom"), {
    left: 0.4,
    top: 0.25,
    width: 0.6,
    height: 0.75,
  });
  assert.equal(result.dividers.length, 2);
  assert.deepEqual(
    sidebarRectangles(state, { splitId: "right", sizes: [0.5, 0.5] }).panes.get(
      "top",
    ),
    { left: 0.4, top: 0, width: 0.6, height: 0.5 },
  );
  assert.equal(sidebarWidth(1200, 0.1), 320);
  assert.equal(sidebarWidth(400, 0.4), 200);
  assert.equal(sidebarWidth(400, 3), 300);
  assert.equal(sidebarWidth(NaN, 0.4), 0);
  assert.equal(sidebarWidth(800, 0.2, 0), 160);
  assert.equal(sidebarWidth(800, 0.2, 500), 400);
  assert.equal(sidebarWidth(100, 0.2, 600), 50);
  assert.deepEqual(
    freeIdentifiers("const x=1; function f(a){ return a+x+external; }"),
    ["external"],
  );
});

test("pane-local shell clips collapse, retains its seat, and scopes visibility and fullscreen", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const keys = [
    "window",
    "document",
    "localStorage",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, globalThis[key]]),
  );
  const localStorage = storage();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const store = observable({
    bySession: { alpha: { layout: { expanded: true, mode: "push" } } },
  });
  let mounts = 0;
  let seatProps;
  const useStore = (selector) =>
    selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot));
  function Seat(props) {
    seatProps = props;
    React.useEffect(() => {
      mounts++;
    }, []);
    return jsx.jsx("div", { "data-native-seat": true });
  }
  const Pane = createSidebarPane(React, jsx, Seat, sidebarWidth);
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = (visible = true) =>
    root.render(
      jsx.jsx(Pane, {
        sessionId: "alpha",
        paneId: "chat-one",
        width: 800,
        visible,
        focused: false,
        useStore,
        actions: {},
      }),
    );
  const setLayout = (layout) => store.set({ bySession: { alpha: { layout } } });
  try {
    await act(async () => render());
    const host = dom.window.document.querySelector("[data-multi-sidebar-pane]");
    assert.equal(host.style.width, "320px");
    assert.equal(
      seatProps.active,
      true,
      "a visible but unfocused chat keeps its native tabs visible",
    );
    const resize = host.querySelector('[role="separator"]');
    await act(async () =>
      resize.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      ),
    );
    assert.equal(host.style.width, "336px");
    assert.equal(localStorage.getItem("dsh.multi.sidebar.ratio.alpha"), "0.42");
    await act(async () => setLayout({ expanded: false, mode: "push" }));
    assert.equal(host.style.width, "0px");
    assert.equal(mounts, 1);
    await act(async () => setLayout({ expanded: true, mode: "fullscreen" }));
    assert.equal(host.style.width, "100%");
    assert.equal(host.style.position, "absolute");
    assert.equal(seatProps.width, 800);
    await act(async () => render(false));
    assert.equal(host.hidden, true);
    assert.equal(seatProps.active, false);
    assert.equal(mounts, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});

test("live shell defaults leave saved/manual session widths intact and clip the minimum without remounting", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const keys = [
    "window",
    "document",
    "localStorage",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const localStorage = storage();
  localStorage.setItem("dsh.multi.sidebar.ratio.alpha", "0.25");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const store = observable({
    bySession: Object.fromEntries(
      ["alpha", "beta"].map((id) => [
        id,
        { layout: { expanded: true, mode: "push" } },
      ]),
    ),
  });
  const useStore = (selector) =>
    selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot));
  let mounts = 0;
  function Seat({ sessionId }) {
    React.useEffect(() => {
      mounts++;
    }, []);
    return jsx.jsx("div", { "data-native-seat": sessionId });
  }
  const Pane = createSidebarPane(React, jsx, Seat, sidebarWidth);
  const container = document.getElementById("root");
  let root = createRoot(container);
  const render = (preferences, width = 1000) =>
    root.render(
      jsx.jsxs(React.Fragment, {
        children: ["alpha", "beta"].map((sessionId) =>
          jsx.jsx(
            Pane,
            {
              sessionId,
              paneId: sessionId,
              width,
              visible: true,
              useStore,
              actions: {},
              preferences: normalizePreferences(preferences),
            },
            sessionId,
          ),
        ),
      }),
    );
  const host = (id) =>
    container.querySelector(`[data-multi-sidebar-pane="${id}"]`);
  const widthOf = (id) => parseFloat(host(id).style.width);
  try {
    await act(async () => render({ sidebarWidth: 0.2, sidebarMinWidth: 0 }));
    assert.equal(widthOf("alpha"), 250);
    assert.equal(widthOf("beta"), 200);
    assert.equal(localStorage.getItem("dsh.multi.sidebar.ratio.alpha"), "0.25");
    assert.equal(localStorage.getItem("dsh.multi.sidebar.ratio.beta"), null);
    const alphaSeat = host("alpha").querySelector("[data-native-seat]");
    const betaSeat = host("beta").querySelector("[data-native-seat]");
    await act(async () => render({ sidebarWidth: 0.6, sidebarMinWidth: 0 }));
    assert.equal(widthOf("alpha"), 250);
    assert.equal(widthOf("beta"), 600);
    await act(async () =>
      host("beta")
        .querySelector('[role="separator"]')
        .dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
          }),
        ),
    );
    assert.equal(widthOf("beta"), 584);
    assert.equal(localStorage.getItem("dsh.multi.sidebar.ratio.beta"), "0.584");
    await act(async () => render({ sidebarWidth: 0.15, sidebarMinWidth: 600 }));
    assert.equal(widthOf("alpha"), 500);
    assert.equal(widthOf("beta"), 584);
    assert.equal(localStorage.getItem("dsh.multi.sidebar.ratio.alpha"), "0.25");
    assert.equal(
      host("alpha")
        .querySelector('[role="separator"]')
        .getAttribute("aria-valuemin"),
      "500",
    );
    await act(async () =>
      render({ sidebarWidth: 0.15, sidebarMinWidth: 600 }, 200),
    );
    for (const id of ["alpha", "beta"])
      assert.ok(widthOf(id) >= 100 && widthOf(id) <= 150);
    await act(async () =>
      render({ sidebarWidth: 0.15, sidebarMinWidth: 600 }, 0),
    );
    assert.equal(widthOf("alpha"), 0);
    assert.equal(widthOf("beta"), 0);
    await act(async () => render({ sidebarWidth: 0.15, sidebarMinWidth: 0 }));
    assert.equal(widthOf("alpha"), 250);
    assert.equal(widthOf("beta"), 584);
    assert.equal(host("alpha").querySelector("[data-native-seat]"), alphaSeat);
    assert.equal(host("beta").querySelector("[data-native-seat]"), betaSeat);
    assert.equal(mounts, 2);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => render({ sidebarWidth: 0.7, sidebarMinWidth: 0 }));
    assert.equal(widthOf("alpha"), 250);
    assert.equal(widthOf("beta"), 584);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("native flat tab hosts remain mounted when tabs split, move, resize, and hide", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const previous = Object.fromEntries(
    [
      "window",
      "document",
      "Node",
      "HTMLElement",
      "getComputedStyle",
      "IS_REACT_ACT_ENVIRONMENT",
    ].map((key) => [key, globalThis[key]]),
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.hasAttribute("data-dockkit-strip") ? 24 : 1000;
    return { left: 0, top: 0, right: 100, bottom: height, width: 100, height };
  };
  const preferences = observable(
    normalizePreferences({ sidebarSplitDirection: "bottom" }),
  );
  const owner = setup(storage(), undefined, undefined, preferences);
  const dockkit = owner.module.testing.dockkit;
  const mint = dockkit.createIdMinter();
  let state = dockkit.createInitialState(mint);
  const pane = state.rootId;
  state = dockkit.replay(state, [{ type: "setExpanded", expanded: true }]);
  for (const contentId of ["one", "two"])
    state = dockkit.replay(
      state,
      dockkit.planOpenContent(state, mint.next, {
        kind: "browser",
        contentId,
        title: contentId,
      }).ops,
    );
  let mounts = 0;
  let unmounts = 0;
  function Body({ tab }) {
    React.useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return jsx.jsx("div", { "data-body": tab.id });
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = (active = true) =>
    root.render(
      jsx.jsx(dockkit.DockLayout, {
        state,
        active,
        canSplit: dockkit.canSplit(state),
        keepMounted: () => true,
        intents: Object.fromEntries(
          [
            "focusTab",
            "focusPane",
            "splitPane",
            "addTab",
            "closeTab",
            "duplicateTab",
            "floatTab",
            "unfloatPane",
            "placeTab",
            "dropTab",
            "moveFloat",
            "resizeFloat",
            "resizeSplit",
          ].map((name) => [name, () => {}]),
        ),
        labels: {
          drop: {
            center: "Move",
            top: "Top",
            right: "Right",
            bottom: "Bottom",
            left: "Left",
          },
        },
        renderTab: (tab) => jsx.jsx(Body, { tab }),
        renderTabTitle: (tab) => tab.title,
        dropZones: "edges",
      }),
    );
  try {
    await act(async () => render());
    const splitButton = dom.window.document.querySelector(
      "[data-dockkit-split-button]",
    );
    assert.equal(
      splitButton.disabled,
      false,
      "a narrow but tall pane can use the configured vertical split",
    );
    preferences.set(normalizePreferences({ sidebarSplitDirection: "right" }));
    await act(async () => render());
    assert.equal(
      splitButton.disabled,
      true,
      "horizontal splitting still respects native room measurements",
    );
    preferences.set(normalizePreferences({ sidebarSplitDirection: "bottom" }));
    await act(async () => render());
    assert.equal(splitButton.disabled, false);
    const tabs = Object.keys(state.tabs);
    state = dockkit.replay(state, [{ type: "focusTab", tabId: tabs[0] }]);
    await act(async () => render());
    assert.equal(mounts, 2);
    const bodies = new Map(
      [...dom.window.document.querySelectorAll("[data-body]")].map(
        (element) => [element.dataset.body, element],
      ),
    );
    state = dockkit.replay(
      state,
      dockkit.planDropTab(state, mint.next, tabs[0], pane, "top"),
    );
    await act(async () => render());
    const newPane = dockkit.findTabPane(state, tabs[0]).id;
    state = dockkit.replay(
      state,
      dockkit.planDropTab(state, mint.next, tabs[0], newPane, "left", (id) => ({
        id,
        kind: "guide",
        title: "Start",
        contentId: "page:guide",
      })),
    );
    state = dockkit.replay(state, dockkit.planSettle(state, mint.next));
    await act(async () => render());
    const split = Object.values(state.nodes).find(
      (node) => node.kind === "split",
    );
    state = dockkit.replay(
      state,
      dockkit.planResizeSplit(split.id, [0.3, 0.7]),
    );
    await act(async () => render(false));
    assert.equal(unmounts, 0);
    for (const [tabId, element] of bodies)
      assert.equal(
        dom.window.document.querySelector(`[data-body="${tabId}"]`),
        element,
      );
    assert.ok(
      dom.window.document.querySelector(
        '[role="separator"][aria-orientation="horizontal"]',
      ),
    );
    assert.ok(
      dom.window.document.querySelector(
        '[role="separator"][aria-orientation="vertical"]',
      ),
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});
