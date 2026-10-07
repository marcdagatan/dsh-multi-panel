import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { paneShortcutCommands } from "../client/shortcuts.mjs";

function fixture() {
  const dom = new JSDOM(
    '<body><div class="dshMulti-workspace"><section data-chat-pane="a"><textarea>Draft A</textarea></section><section data-chat-pane="b"><textarea>Draft B</textarea></section></div><input id="settings"></body>',
  );
  let state = {
    tree: {
      type: "split",
      first: { type: "leaf", id: "a" },
      second: { type: "leaf", id: "b" },
    },
    activeId: "a",
    maximizedId: null,
    undo: null,
  };
  const calls = [];
  const workspace = {
    getSnapshot: () => state,
    newChat: async (id, edge) => calls.push(["split", id, edge]),
    focus(id) {
      calls.push(["focus", id]);
      state = { ...state, activeId: id };
    },
    maximize(id) {
      calls.push(["maximize", id]);
      state = { ...state, maximizedId: id };
    },
    close(id) {
      calls.push(["close", id]);
    },
    undo() {
      calls.push(["undo"]);
    },
  };
  let tabState = { tabs: [{ id: "one" }, { id: "two" }], activeId: "one" };
  const tabs = {
    active: () => workspace,
    getSnapshot: () => tabState,
    add: () => calls.push(["add-tab"]),
    select(id) {
      calls.push(["select-tab", id]);
      tabState = { ...tabState, activeId: id };
    },
    close: (id) => calls.push(["close-tab", id]),
  };
  const commands = new Map(
    paneShortcutCommands(tabs, {
      getSnapshot: () => ({ splitDirection: "bottom", undoEnabled: true }),
    }).map((command) => [command.id.split(".")[1], command]),
  );
  return {
    dom,
    calls,
    commands,
    target: dom.window.document.querySelector("textarea"),
    setState(next) {
      state = { ...state, ...next };
    },
    setTabs(next) {
      tabState = { ...tabState, ...next };
    },
    close: () => dom.window.close(),
  };
}

test("pane commands are configurable and unbound without replacing existing key bindings", () => {
  const f = fixture();
  try {
    assert.equal(f.commands.size, 12);
    for (const command of f.commands.values())
      assert.deepEqual(command.defaults, {});
    f.commands.get("split").resolve({ target: f.target, modal: null }).run();
    assert.deepEqual(f.calls, [["split", "a", "bottom"]]);
    assert.equal(
      f.commands.get("close").resolve({
        target: f.dom.window.document.querySelector("#settings"),
        modal: null,
      }).status,
      "blocked",
    );
    assert.equal(
      f.commands.get("split").resolve({ target: f.target, modal: "settings" })
        .status,
      "blocked",
    );
  } finally {
    f.close();
  }
});

test("focus shortcuts preserve drafts and carry maximization to the next pane", async () => {
  const f = fixture();
  try {
    f.setState({ maximizedId: "a" });
    f.commands.get("focus-next").resolve({ target: f.target }).run();
    await Promise.resolve();
    assert.deepEqual(f.calls, [
      ["maximize", "b"],
      ["focus", "b"],
    ]);
    assert.equal(f.dom.window.document.activeElement.value, "Draft B");
    assert.equal(f.target.value, "Draft A");
  } finally {
    f.close();
  }
});

test("close and Undo respect their visible layout availability", () => {
  const f = fixture();
  try {
    assert.equal(
      f.commands.get("undo").resolve({ target: f.target }).status,
      "blocked",
    );
    f.setState({ undo: {} });
    f.commands.get("undo").resolve({ target: f.target }).run();
    assert.deepEqual(f.calls, [["undo"]]);
    f.setState({ tree: { type: "leaf", id: "a" } });
    assert.equal(
      f.commands.get("close").resolve({ target: f.target }).status,
      "blocked",
    );
  } finally {
    f.close();
  }
});

test("tab shortcuts add, cycle and close workspace tabs", () => {
  const f = fixture();
  try {
    const run = (name) =>
      f.commands.get(name).resolve({ target: f.target, modal: null }).run();
    run("new-tab");
    run("next-tab");
    run("previous-tab");
    run("close-tab");
    assert.deepEqual(f.calls, [
      ["add-tab"],
      ["select-tab", "two"],
      ["select-tab", "one"],
      ["close-tab", "one"],
    ]);
    f.setTabs({ tabs: [{ id: "one" }] });
    for (const name of ["next-tab", "previous-tab", "close-tab"])
      assert.equal(
        f.commands.get(name).resolve({ target: f.target }).status,
        "blocked",
      );
  } finally {
    f.close();
  }
});
