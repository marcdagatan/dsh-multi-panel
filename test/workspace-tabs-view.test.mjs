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
import { WorkspaceTabs } from "../client/workspace-tabs-view.mjs";
import { createWorkspaceTabs } from "../client/workspace-tabs.mjs";
import { createWorkspaceState } from "../client/workspace-state.mjs";

const h = React.createElement;
const Session = React.createContext(null);

function fixture() {
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
  const row = (id, patch = {}) => ({
    id,
    title: "Chat " + id,
    blank: false,
    running: false,
    retainedBy: { mainView: id === "a" ? 1 : 0, multiPanel: 0 },
    ...patch,
  });
  let list = {
    phase: "ready",
    ids: ["a", "b"],
    byId: { a: row("a"), b: row("b") },
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (id, patch) => {
    list = {
      ...list,
      byId: { ...list.byId, [id]: { ...list.byId[id], ...patch } },
    };
    emit();
  };
  const sessions = {
    list: {
      getSnapshot: () => list,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    retain(sessionId) {
      const count = () => list.byId[sessionId].retainedBy.multiPanel;
      update(sessionId, {
        retainedBy: {
          ...list.byId[sessionId].retainedBy,
          multiPanel: count() + 1,
        },
      });
      return {
        sessionId,
        ready: Promise.resolve(),
        release: () =>
          update(sessionId, {
            retainedBy: {
              ...list.byId[sessionId].retainedBy,
              multiPanel: count() - 1,
            },
          }),
      };
    },
  };
  const navigation = {
    openSession(sessionId) {
      for (const id of list.ids)
        list.byId[id] = {
          ...list.byId[id],
          retainedBy: {
            ...list.byId[id].retainedBy,
            mainView: +(id === sessionId),
          },
        };
      list = { ...list, byId: { ...list.byId } };
      emit();
    },
  };
  let nextId = 0;
  const tabs = createWorkspaceTabs({
    storage: dom.window.localStorage,
    id: () => "tab-" + ++nextId,
    createWorkspace: (options) =>
      createWorkspaceState({
        sessions,
        navigation,
        storage: dom.window.localStorage,
        id: () => "pane-" + ++nextId,
        ...options,
      }),
  });
  let mounted = 0;
  function NativeChat() {
    const sessionId = React.useContext(Session);
    const [draft, setDraft] = React.useState("");
    React.useEffect(() => {
      mounted++;
    }, []);
    return h("textarea", {
      "data-native-draft": sessionId ?? "empty",
      value: draft,
      onChange: (event) => setDraft(event.target.value),
    });
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
  const container = document.getElementById("root");
  const root = createRoot(container);
  act(() =>
    root.render(
      h(WorkspaceTabs, {
        tabs,
        useSessions,
        SessionProvider: Provider,
        renderSlot: (name) =>
          name === "main.conversation" ? h(NativeChat) : null,
      }),
    ),
  );
  const $ = (selector) => container.querySelector(selector);
  const click = (element) =>
    act(() =>
      element.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      ),
    );
  return {
    dom,
    tabs,
    $,
    click,
    update,
    list: () => list,
    get mounted() {
      return mounted;
    },
    tabButtons: () => [...container.querySelectorAll('[role="tab"]')],
    cleanup() {
      act(() => root.unmount());
      tabs.dispose();
      dom.window.close();
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("a new tab opens a blank workspace while background chats stay mounted and retained", () => {
  const f = fixture();
  try {
    assert.equal(f.tabButtons().length, 1);
    assert.match(f.tabButtons()[0].textContent, /Chat a/);
    const draft = f.$('[data-native-draft="a"]');
    act(() => {
      Object.getOwnPropertyDescriptor(
        f.dom.window.HTMLTextAreaElement.prototype,
        "value",
      ).set.call(draft, "Unsent draft");
      draft.dispatchEvent(new f.dom.window.Event("input", { bubbles: true }));
    });
    f.click(f.$('[aria-label="New workspace tab"]'));
    const [first, second] = f.tabButtons();
    assert.equal(second.getAttribute("aria-selected"), "true");
    assert.match(second.textContent, /New workspace/);
    const panels = [
      ...f.dom.window.document.querySelectorAll('[role="tabpanel"]'),
    ];
    assert.equal(panels[0].hidden, true);
    assert.equal(panels[1].hidden, false);
    assert.ok(panels[1].querySelector('[data-native-draft="empty"]'));
    assert.equal(f.list().byId.a.retainedBy.multiPanel, 1);
    assert.equal(
      f.list().byId.a.retainedBy.mainView,
      1,
      "blank tab does not claim chat a",
    );
    const mounted = f.mounted;
    f.click(first);
    assert.equal(first.getAttribute("aria-selected"), "true");
    assert.equal(f.$('[data-native-draft="a"]'), draft);
    assert.equal(draft.value, "Unsent draft");
    assert.equal(f.mounted, mounted, "switching tabs never remounts chats");
  } finally {
    f.cleanup();
  }
});

test("tabs show running activity and close without losing the last tab", () => {
  const f = fixture();
  try {
    assert.equal(f.$(".dshMulti-tabActivity"), null);
    act(() => f.update("a", { running: true }));
    assert.equal(
      f.$(".dshMulti-tabActivity").getAttribute("aria-label"),
      "1 chat running",
    );
    assert.equal(f.$('[aria-label^="Close"][aria-label$="tab"]'), null);
    f.click(f.$('[aria-label="New workspace tab"]'));
    f.click(f.$('[aria-label="Close New workspace tab"]'));
    assert.equal(f.tabButtons().length, 1);
    assert.equal(f.tabs.getSnapshot().activeId, "default");
    assert.equal(f.list().byId.a.retainedBy.multiPanel, 1);
  } finally {
    f.cleanup();
  }
});

test("double-clicking a tab renames it, Enter saves, Escape cancels and blank restores the chat title", () => {
  const f = fixture();
  try {
    const rename = (value, key) => {
      const tab = f.tabButtons()[0];
      act(() =>
        tab.dispatchEvent(
          new f.dom.window.MouseEvent("dblclick", { bubbles: true }),
        ),
      );
      const input = f.$('input[aria-label="Tab name"]');
      assert.equal(f.dom.window.document.activeElement, input);
      act(() => {
        Object.getOwnPropertyDescriptor(
          f.dom.window.HTMLInputElement.prototype,
          "value",
        ).set.call(input, value);
        input.dispatchEvent(new f.dom.window.Event("input", { bubbles: true }));
      });
      act(() =>
        input.dispatchEvent(
          new f.dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
      assert.equal(f.$('input[aria-label="Tab name"]'), null);
    };
    rename("Research", "Enter");
    assert.match(f.tabButtons()[0].textContent, /Research/);
    rename("Ignored", "Escape");
    assert.match(f.tabButtons()[0].textContent, /Research/);
    rename("", "Enter");
    assert.match(f.tabButtons()[0].textContent, /Chat a/);
  } finally {
    f.cleanup();
  }
});
