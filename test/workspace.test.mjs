import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
// React DOM detects input-event support at import time; provide a real DOM first.
const bootstrapDOM = new JSDOM("<!DOCTYPE html><body></body>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
bootstrapDOM.window.close();
delete globalThis.window;
delete globalThis.document;
import { MultiWorkspace, paneGeometry } from "../client/workspace.mjs";
import { createWorkspaceState } from "../client/workspace-state.mjs";
import { normalizePreferences } from "../client/preferences.mjs";

const h = React.createElement;
const Session = React.createContext(null);

function fixture(initialPreferences = {}, { keepMounted = false } = {}) {
  let preferences = normalizePreferences(initialPreferences);
  const preferenceListeners = new Set();
  const preferencesSource = {
    getSnapshot: () => preferences,
    subscribe(fn) {
      preferenceListeners.add(fn);
      return () => preferenceListeners.delete(fn);
    },
  };
  const dom = new JSDOM('<!DOCTYPE html><body><div id="root"></div></body>', {
    url: "http://127.0.0.1:19387",
  });
  const saved = {};
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "ResizeObserver",
    "IS_REACT_ACT_ENVIRONMENT",
  ])
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 1200,
    bottom: 800,
    width: 1200,
    height: 800,
  });
  let list = {
    phase: "ready",
    ids: ["a", "b", "c"],
    byId: Object.fromEntries(
      ["a", "b", "c"].map((id) => [
        id,
        {
          id,
          title: "Chat " + id,
          blank: false,
          retainedBy: { mainView: id === "a" ? 1 : 0 },
        },
      ]),
    ),
  };
  const listeners = new Set();
  const sessions = {
    list: {
      getSnapshot: () => list,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    retain(sessionId) {
      return { sessionId, ready: Promise.resolve(), release() {} };
    },
  };
  let nextId = 0;
  const workspace = createWorkspaceState({
    sessions,
    getPreferences: preferencesSource.getSnapshot,
    storage: dom.window.localStorage,
    id: () => "id-" + ++nextId,
    navigation: {
      openSession(sessionId) {
        list = {
          ...list,
          byId: Object.fromEntries(
            list.ids.map((id) => [
              id,
              {
                ...list.byId[id],
                retainedBy: { mainView: id === sessionId ? 1 : 0 },
              },
            ]),
          ),
        };
        for (const listener of listeners) listener();
      },
    },
  });
  let mounted = 0;
  function NativeChat() {
    const sessionId = React.useContext(Session);
    const [draft, setDraft] = React.useState("");
    const [tab, setTab] = React.useState("Chat");
    React.useEffect(() => {
      mounted++;
    }, []);
    return h(
      "div",
      { "data-native-chat": sessionId ?? "empty" },
      h(
        "button",
        {
          onClick: () => setTab(tab === "Chat" ? "Usage" : "Chat"),
          "data-native-tab": sessionId,
        },
        tab,
      ),
      h(
        "button",
        {
          onClick: () => setDraft("Unsent draft"),
          "data-set-draft": sessionId,
        },
        "Write draft",
      ),
      h("textarea", {
        "data-native-draft": sessionId,
        value: draft,
        onChange: (event) => setDraft(event.target.value),
      }),
    );
  }
  function Provider({ session, empty, children }) {
    return session
      ? h(Session.Provider, { value: session.sessionId }, children)
      : h(Session.Provider, { value: null }, empty());
  }
  const useSessions = (selector) =>
    selector(
      React.useSyncExternalStore(
        sessions.list.subscribe,
        sessions.list.getSnapshot,
        sessions.list.getSnapshot,
      ),
    );
  const renderSlot = (name, props) =>
    name === "main.conversation" ? h(NativeChat) : h(Sidebar, props);
  const sidebarMounts = {};
  // Like a native keep-mounted tab (the browser), hold the chat while mounted.
  function Sidebar(props) {
    const sessionId = React.useContext(Session);
    const [signal] = React.useState(() => new AbortController().signal);
    React.useLayoutEffect(() => {
      sidebarMounts[sessionId] = (sidebarMounts[sessionId] ?? 0) + 1;
    }, [sessionId]);
    React.useLayoutEffect(
      () => (keepMounted ? props.retainTab("browser", signal) : undefined),
      [props.retainTab, signal],
    );
    return h(
      "div",
      {
        "data-native-sidebar": sessionId,
        "data-visible": String(props.visible),
      },
      sessionId,
    );
  }
  const container = document.getElementById("root");
  const root = createRoot(container);
  act(() =>
    root.render(
      h(MultiWorkspace, {
        workspace,
        useSessions,
        SessionProvider: Provider,
        renderSlot,
        preferencesSource,
      }),
    ),
  );
  return {
    dom,
    workspace,
    container,
    setPreferences(patch) {
      preferences = normalizePreferences({ ...preferences, ...patch });
      for (const listener of preferenceListeners) listener();
    },
    get mounted() {
      return mounted;
    },
    sidebarMounts,
    cleanup() {
      act(() => root.unmount());
      workspace.dispose();
      dom.window.close();
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

function click(element) {
  act(() =>
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  );
}

test("undo notice includes a countdown bar and expires after exactly three seconds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = fixture();
  try {
    const first = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.split(first, "b", "right"));
    const notice = ui.container.querySelector(".dshMulti-undo");
    assert.ok(notice);
    assert.equal(
      notice.style.getPropertyValue("--dshMulti-undo-duration"),
      "3000ms",
    );
    assert.equal(
      notice
        .querySelector(".dshMulti-undoCountdown")
        .getAttribute("aria-hidden"),
      "true",
    );
    act(() => t.mock.timers.tick(2999));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), notice);
    act(() => t.mock.timers.tick(1));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
    assert.equal(ui.workspace.getSnapshot().undo, null);
    assert.equal(ui.container.querySelectorAll("[data-chat-pane]").length, 2);
  } finally {
    ui.cleanup();
  }
});

test("new layout changes restart the notice, but focus and resizing do not", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = fixture();
  try {
    const first = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.split(first, "b", "right"));
    const originalNotice = ui.container.querySelector(".dshMulti-undo");
    act(() => t.mock.timers.tick(1500));
    act(() => ui.workspace.focus(first));
    act(() => ui.workspace.resize(ui.workspace.getSnapshot().tree.id, 0.6));
    act(() => t.mock.timers.tick(1000));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), originalNotice);
    act(() => ui.workspace.split(first, "c", "bottom"));
    const refreshedNotice = ui.container.querySelector(".dshMulti-undo");
    assert.ok(refreshedNotice);
    assert.notEqual(
      refreshedNotice,
      originalNotice,
      "remount restarts the CSS countdown",
    );
    act(() => t.mock.timers.tick(2999));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), refreshedNotice);
    act(() => t.mock.timers.tick(1));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
  } finally {
    ui.cleanup();
  }
});

test("undo remains clickable during the countdown and cancels its expiry timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = fixture();
  try {
    const first = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.split(first, "b", "right"));
    act(() => t.mock.timers.tick(1000));
    click(ui.container.querySelector(".dshMulti-undo"));
    assert.equal(ui.container.querySelectorAll("[data-chat-pane]").length, 1);
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
    act(() => t.mock.timers.tick(3000));
    assert.equal(ui.container.querySelectorAll("[data-chat-pane]").length, 1);
  } finally {
    ui.cleanup();
  }
});

test("live appearance preferences update without replacing native draft DOM", () => {
  const ui = fixture();
  try {
    act(() =>
      ui.workspace.split(ui.workspace.getSnapshot().activeId, "b", "right"),
    );
    click(ui.container.querySelector('[data-set-draft="a"]'));
    const draft = ui.container.querySelector('[data-native-draft="a"]');
    const root = ui.container.querySelector(".dshMulti-workspace");
    assert.equal(root.hasAttribute("data-focus-highlight"), false);
    act(() =>
      ui.setPreferences({
        focusHighlight: true,
        focusColor: "#ffaa00",
        dividerWidth: 12,
        compactToolbar: true,
        sidebarWidth: 0.5,
      }),
    );
    assert.equal(root.getAttribute("data-focus-highlight"), "true");
    assert.equal(
      root.style.getPropertyValue("--dshMulti-focus-color"),
      "#ffaa00",
    );
    assert.equal(
      root.style.getPropertyValue("--dshMulti-divider-size"),
      "12px",
    );
    assert.equal(root.getAttribute("data-compact-toolbar"), "true");
    assert.equal(ui.container.querySelector('[data-native-draft="a"]'), draft);
    assert.equal(draft.value, "Unsent draft");
    assert.equal(ui.mounted, 2);
  } finally {
    ui.cleanup();
  }
});

test("configured Undo duration, position and hover pause preserve the remaining countdown", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const ui = fixture({
    undoDuration: 5,
    undoProgress: false,
    undoPosition: "left",
    pauseUndoOnHover: true,
  });
  try {
    act(() =>
      ui.workspace.split(ui.workspace.getSnapshot().activeId, "b", "right"),
    );
    const notice = ui.container.querySelector(".dshMulti-undo");
    assert.equal(
      notice.style.getPropertyValue("--dshMulti-undo-duration"),
      "5000ms",
    );
    assert.equal(notice.dataset.position, "left");
    assert.equal(notice.querySelector(".dshMulti-undoCountdown"), null);
    act(() => t.mock.timers.tick(1000));
    act(() =>
      notice.dispatchEvent(
        new window.MouseEvent("mouseover", { bubbles: true }),
      ),
    );
    assert.equal(
      notice.style.getPropertyValue("--dshMulti-undo-play-state"),
      "paused",
    );
    act(() => t.mock.timers.tick(8000));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), notice);
    act(() =>
      notice.dispatchEvent(
        new window.MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: ui.container,
        }),
      ),
    );
    act(() => t.mock.timers.tick(3999));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), notice);
    act(() => t.mock.timers.tick(1));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
  } finally {
    ui.cleanup();
  }
});

test("disabling Undo clears the current notice rather than reviving it later", () => {
  const ui = fixture();
  try {
    act(() =>
      ui.workspace.split(ui.workspace.getSnapshot().activeId, "b", "right"),
    );
    assert.ok(ui.container.querySelector(".dshMulti-undo"));
    act(() => ui.setPreferences({ undoEnabled: false }));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
    assert.equal(ui.workspace.getSnapshot().undo, null);
    act(() => ui.setPreferences({ undoEnabled: true }));
    assert.equal(ui.container.querySelector(".dshMulti-undo"), null);
  } finally {
    ui.cleanup();
  }
});

test("mixed chat geometry tiles the available rectangle and reports both divider axes", () => {
  const leaf = (id) => ({ type: "leaf", id, sessionId: id });
  const geometry = paneGeometry({
    type: "split",
    id: "root",
    axis: "vertical",
    ratio: 0.4,
    first: leaf("a"),
    second: {
      type: "split",
      id: "nested",
      axis: "horizontal",
      ratio: 0.25,
      first: leaf("b"),
      second: leaf("c"),
    },
  });
  assert.deepEqual(
    geometry.panes.map((entry) => entry.rect),
    [
      { left: 0, top: 0, width: 100, height: 40 },
      { left: 0, top: 40, width: 25, height: 60 },
      { left: 25, top: 40, width: 75, height: 60 },
    ],
  );
  assert.deepEqual(
    geometry.dividers.map((entry) => entry.axis),
    ["vertical", "horizontal"],
  );
});

test("chat bodies, draft DOM, tab state, and scoped sidebar stay mounted across splits, moves, resizes, maximize and focus", () => {
  const ui = fixture();
  try {
    const a = ui.workspace.getSnapshot().activeId;
    const original = ui.container.querySelector('[data-native-chat="a"]');
    const input = original.querySelector("textarea");
    click(original.querySelector("[data-set-draft]"));
    click(original.querySelector("[data-native-tab]"));
    act(() => ui.workspace.split(a, "b", "bottom"));
    const b = ui.workspace.getSnapshot().activeId;
    assert.equal(
      ui.container.querySelector('[data-native-chat="a"]'),
      original,
    );
    assert.equal(original.querySelector("button").textContent, "Usage");
    assert.equal(
      ui.container.querySelector('[data-native-sidebar="b"]').textContent,
      "b",
    );
    act(() => ui.workspace.split(b, "c", "right"));
    const c = ui.workspace.getSnapshot().activeId;
    const mounted = ui.mounted;
    act(() => ui.workspace.move(a, c, "left"));
    act(() => ui.workspace.resize(ui.workspace.getSnapshot().tree.id, 0.6));
    act(() => ui.workspace.maximize(c));
    assert.equal(
      ui.container.querySelector('[data-native-chat="a"]'),
      original,
    );
    assert.equal(original.closest("[data-chat-pane]").style.display, "none");
    assert.equal(input.value, "Unsent draft");
    assert.equal(
      ui.container.querySelector('[data-native-draft="b"]').value,
      "",
    );
    act(() => ui.workspace.maximize(c));
    act(() => ui.workspace.focus(b));
    assert.equal(ui.mounted, mounted);
    assert.equal(original.querySelector("button").textContent, "Usage");
    assert.equal(ui.container.querySelectorAll("[data-chat-pane]").length, 3);
  } finally {
    ui.cleanup();
  }
});

test("split menu and chat picker support keyboard escape and selecting a chat without a drag", () => {
  const ui = fixture();
  try {
    click(ui.container.querySelector('[aria-label="Split chat pane"]'));
    const below = [...ui.container.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Split below",
    );
    click(below);
    assert.ok(ui.container.querySelector('[role="dialog"]'));
    const find = ui.container.querySelector('[aria-label="Find a chat"]');
    act(() =>
      find.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(ui.container.querySelector('[role="dialog"]'), null);
    click(ui.container.querySelector('[aria-label="Split chat pane"]'));
    click(
      [...ui.container.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Split below",
      ),
    );
    click(
      [...ui.container.querySelectorAll(".dshMulti-pickerItem")].find(
        (item) => item.textContent === "Chat b",
      ),
    );
    assert.equal(ui.container.querySelectorAll("[data-chat-pane]").length, 2);
    assert.equal(ui.workspace.getSnapshot().tree.axis, "vertical");
    assert.equal(ui.container.querySelector('[role="dialog"]'), null);
  } finally {
    ui.cleanup();
  }
});

test("divider keyboard controls use the correct axis and clamp ratios without unmounting chats", () => {
  const ui = fixture();
  try {
    const first = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.split(first, "b", "right"));
    const divider = ui.container.querySelector(
      '[aria-label="Resize chat panes"]',
    );
    const mounted = ui.mounted;
    act(() =>
      divider.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      ),
    );
    assert.equal(ui.workspace.getSnapshot().tree.ratio, 0.47);
    act(() =>
      divider.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      ),
    );
    assert.equal(ui.workspace.getSnapshot().tree.ratio, 0.47);
    assert.equal(ui.mounted, mounted);
  } finally {
    ui.cleanup();
  }
});

test("double-clicking a divider evens out the panes it separates", () => {
  const ui = fixture();
  try {
    const first = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.split(first, "b", "right"));
    act(() => ui.workspace.resize(ui.workspace.getSnapshot().tree.id, 0.7));
    const divider = ui.container.querySelector('[role="separator"]');
    act(() =>
      divider.dispatchEvent(
        new ui.container.ownerDocument.defaultView.MouseEvent("dblclick", {
          bubbles: true,
        }),
      ),
    );
    assert.equal(ui.workspace.getSnapshot().tree.ratio, 0.5);
  } finally {
    ui.cleanup();
  }
});

test("a replaced chat's keep-mounted sidebar stays mounted behind its pane and returns intact", () => {
  const ui = fixture({}, { keepMounted: true });
  try {
    const pane = ui.workspace.getSnapshot().activeId;
    const sidebar = ui.container.querySelector('[data-native-sidebar="a"]');
    act(() => ui.workspace.select(pane, "b"));
    assert.equal(
      ui.container.querySelector('[data-native-sidebar="a"]'),
      sidebar,
    );
    assert.equal(sidebar.getAttribute("data-visible"), "false");
    assert.equal(sidebar.closest(".dshMulti-paneBody").style.display, "none");
    assert.equal(ui.container.querySelector('[data-native-chat="a"]'), null);
    assert.ok(ui.container.querySelector('[data-native-chat="b"]'));
    act(() => ui.workspace.select(pane, "a"));
    assert.equal(
      ui.container.querySelector('[data-native-sidebar="a"]'),
      sidebar,
    );
    assert.equal(sidebar.getAttribute("data-visible"), "true");
    assert.equal(sidebar.closest(".dshMulti-paneBody").style.display, "");
    assert.equal(ui.sidebarMounts.a, 1);
    assert.deepEqual(ui.workspace.getSnapshot().background, { b: pane });
  } finally {
    ui.cleanup();
  }
});

test("a replaced chat without keep-mounted tabs unmounts its sidebar as before", () => {
  const ui = fixture();
  try {
    const pane = ui.workspace.getSnapshot().activeId;
    act(() => ui.workspace.select(pane, "b"));
    assert.equal(ui.container.querySelector('[data-native-sidebar="a"]'), null);
    act(() => ui.workspace.select(pane, "a"));
    assert.equal(ui.sidebarMounts.a, 2);
  } finally {
    ui.cleanup();
  }
});
