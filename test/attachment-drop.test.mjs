import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import * as jsx from "react/jsx-runtime";
import { JSDOM } from "jsdom";
import * as Cordis from "../runtime-evidence/dsh/node_modules/@deepseek-ai/cordis/lib/index.js";
import * as Slots from "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js";
import {
  buildAttachmentFork,
  buildConversationFork,
} from "../scripts/conversation-fork.mjs";

// React DOM detects input-event support at import time, as in workspace.test.mjs.
const bootstrapDOM = new JSDOM("<!DOCTYPE html><body></body>");
const bootstrapGlobals = ["window", "document"].map((key) => [
  key,
  Object.getOwnPropertyDescriptor(globalThis, key),
]);
Object.assign(globalThis, {
  window: bootstrapDOM.window,
  document: bootstrapDOM.window.document,
});
const ReactDOM = await import("react-dom");
const { createRoot } = await import("react-dom/client");
bootstrapDOM.window.close();
for (const [key, descriptor] of bootstrapGlobals) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globalThis[key];
}

const artifact = (name) =>
  readFileSync(
    new URL(
      `../runtime-evidence/dsh/node_modules/@deepseek-ai/${name}/lib/client.js`,
      import.meta.url,
    ),
    "utf8",
  );
const nativeAttachment = artifact("dsh-client-ui-attachment");
const nativeConversation = artifact("dsh-client-ui-conversation");
const conversationFork = buildConversationFork(nativeConversation);
const attachmentFork = buildAttachmentFork(nativeAttachment);
const h = React.createElement;

// The native controller, upload scheduling, composer injection, attachment view
// and drop listeners run intact. Session shells, upload IO and visual dependencies
// are fixtures; observable storage replaces unavailable extracted Zustand/Immer.
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  const store = {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
    update(mutator) {
      const next = { ...value };
      mutator(next);
      store.set(next);
    },
  };
  return store;
}

const primitives = new Proxy(
  {
    fileExtension: (name) => name.split(".").at(-1),
    fileSizeText: (bytes) => `${bytes} bytes`,
  },
  { get: (target, key) => target[key] ?? (() => null) },
);
function loadNative(source) {
  let result;
  const ownerWindow = window;
  const previousLoader = ownerWindow.__ModuleLoader__;
  ownerWindow.__ModuleLoader__ = {
    load(definition) {
      result = definition.factory((name) => {
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsx;
        if (name === "react-dom") return ReactDOM;
        if (name === "@deepseek-ai/cordis") return Cordis;
        if (name === "@deepseek-ai/dsh-client-ui-slots") return Slots;
        if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
        if (name === "@deepseek-ai/dsh-client-store")
          return {
            createSnapshotStore: observable,
            defineStore: (spec) => ({ spec }),
            notifySubscribers: (listeners, _label, ...args) => {
              for (const listener of listeners) listener(...args);
            },
          };
        throw new Error(`Unexpected native module ${name}`);
      });
    },
  };
  try {
    new Function("window", source)(ownerWindow);
  } finally {
    ownerWindow.__ModuleLoader__ = previousLoader;
  }
  return result;
}

function instrumentConversation(source) {
  // Execute the real native registration closure without booting unrelated UI.
  const start = source.indexOf("const registerComposerBar = ");
  const endAnchor = "\n\t\t\t}, InputBar);";
  const end = source.indexOf(endAnchor, start);
  assert.ok(start >= 0 && end > start);
  const registration = source.slice(start, end + endAnchor.length);
  return source.replace(
    "exports.apply = apply;",
    `exports.testing = {
      installDraftKeymap, installDraftFilePicker, pasteCommand: Je$2, translations: { en, zh },
      registerComposerBar(deps) {
        const { ctx, sessions, slots, inputHub, stopShortcut, submissionPolicy, stop } = deps;
        ${registration}
        return registerComposerBar();
      }
    }; exports.apply = apply;`,
  );
}

async function fixture(
  attachmentSource = attachmentFork,
  ids = ["alpha", "beta"],
) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="root"></div></body>', {
    url: "http://127.0.0.1:19387",
  });
  const globals = ["window", "document", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const listenerSets = [];
  for (const target of [document, window]) {
    const tracked = new Set([
      "dragenter",
      "dragover",
      "dragleave",
      "drop",
      "dragend",
    ]);
    const byType = new Map();
    listenerSets.push(byType);
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = function (type, listener, options) {
      if (tracked.has(type)) {
        if (!byType.has(type)) byType.set(type, new Set());
        byType.get(type).add(listener);
      }
      return add.call(this, type, listener, options);
    };
    target.removeEventListener = function (type, listener, options) {
      byType.get(type)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
  }
  const conversation = loadNative(instrumentConversation(conversationFork));
  const attachment = loadNative(
    attachmentSource.replace(
      "exports.apply = apply;",
      "exports.testing = { ComposerAttachments }; exports.apply = apply;",
    ),
  );
  const uploads = [];
  const ctx = new Cordis.Context();
  const uploadOwner = ctx.plugin(
    class extends Cordis.Service {
      constructor(scope) {
        super(scope, "fileUpload");
      }
      async upload(sessionId, file) {
        uploads.push({ sessionId, name: file.name });
        return {
          ok: true,
          value: {
            receiptId: `receipt-${uploads.length}`,
            file: { name: file.name },
          },
        };
      }
    },
  );
  await uploadOwner.await();
  const controllerOwner = ctx.plugin(conversation.ConversationController, {
    input: {},
    blocks: {},
    maxConcurrentFileUploads: 2,
  });
  await controllerOwner.await();
  const controller = ctx.get("conversation");
  assert.ok(controller);
  const shells = new Map(
    ids.map((id) => {
      const store = observable({
        phase: "plain",
        attachmentIds: [],
        draft: `draft-${id}`,
      });
      return [
        id,
        {
          store,
          get snapshot() {
            return store.getSnapshot();
          },
          addFiles(_references, ids) {
            store.set({
              ...store.getSnapshot(),
              attachmentIds: [...store.getSnapshot().attachmentIds, ...ids],
            });
            return true;
          },
          notices: observable(null),
          lexicon: observable(new Map()),
        },
      ];
    }),
  );
  let registration;
  conversation.testing.registerComposerBar({
    ctx,
    sessions: {
      binding: (id) => (shells.has(id) ? { sessionId: id } : undefined),
      list: observable({ byId: Object.fromEntries(ids.map((id) => [id, {}])) }),
    },
    slots: {
      register: (options) => {
        registration = options;
      },
    },
    inputHub: { shell: (id) => shells.get(id), inputTriggers: () => undefined },
    stopShortcut: observable([]),
    submissionPolicy: { busyEnter: observable("queue") },
    stop() {},
  });
  const bound = new Map(ids.map((id) => [id, registration.inject(id)]));
  const root = createRoot(document.getElementById("root"));
  const releases = [];
  function Pane({ id, accepting, hidden }) {
    const shell = shells.get(id);
    const input = React.useSyncExternalStore(
      shell.store.subscribe,
      shell.store.getSnapshot,
    );
    const uploadStates = React.useSyncExternalStore(
      controller.fileUploads.subscribe,
      controller.fileUploads.getSnapshot,
    );
    return h(
      "section",
      {
        "data-chat-pane": id,
        style: { position: "relative", display: hidden ? "none" : undefined },
      },
      h("textarea", { "data-editor": id, defaultValue: input.draft }),
      h("div", { "data-transcript": id }, "Transcript"),
      h(attachment.testing.ComposerAttachments, {
        ...bound.get(id),
        attachments: controller.resolveDraftAttachments(input.attachmentIds),
        uploads: uploadStates,
        canAcceptDrop: accepting,
        onAddFiles: bound.get(id).addFiles,
        dropLimits: { count: 3, size: "10 MB" },
        t: (key, values = {}) =>
          (conversation.testing.translations.en[key] ?? key).replace(
            /\{(\w+)\}/g,
            (match, name) => values[name] ?? match,
          ),
      }),
    );
  }
  const render = async ({ order = ids, blocked, hidden } = {}) =>
    act(async () =>
      root.render(
        h(
          React.Fragment,
          null,
          order.map((id) =>
            h(Pane, {
              id,
              key: id,
              accepting: id !== blocked,
              hidden: id === hidden,
            }),
          ),
        ),
      ),
    );
  await render();
  const pane = (id) => document.querySelector(`[data-chat-pane="${id}"]`);
  const editor = (id) => pane(id).querySelector("textarea");
  const transcript = (id) => pane(id).querySelector("[data-transcript]");
  const file = (name) =>
    new window.File(["bytes"], name, { type: "text/plain" });
  const dispatch = async (target, type, files, options = {}) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      ...options,
    });
    const transfer = {
      types: files ? ["Files"] : ["application/x-dsh-chat-pane"],
      files: files ?? [],
      items: (files ?? []).map((file) => ({
        kind: "file",
        getAsFile: () => file,
      })),
      dropEffect: "move",
    };
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    await act(async () => target.dispatchEvent(event));
    await Promise.all([...controller.pendingFileUploads]);
    return { event, transfer };
  };
  const bindPaste = (id) => {
    const element = editor(id);
    const nativeEditor = {
      isComposing: () => false,
      registerRootListener(listener) {
        listener(element, null);
        return () => listener(null, element);
      },
      registerUpdateListener: () => () => {},
      registerCommand(command, handler) {
        if (command !== conversation.testing.pasteCommand) return () => {};
        element.addEventListener("paste", handler);
        return () => element.removeEventListener("paste", handler);
      },
    };
    releases.push(
      conversation.testing.installDraftKeymap(
        nativeEditor,
        {
          paste(text) {
            shells
              .get(id)
              .store.set({ ...shells.get(id).snapshot, draft: text });
          },
        },
        {
          current: {
            locked: false,
            machineBusy: false,
            intakeFiles: bound.get(id).addFiles,
          },
        },
      ),
    );
  };
  const paste = async (id, files, text = "") => {
    const event = new window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
        getData: () => text,
      },
    });
    await act(async () => editor(id).dispatchEvent(event));
    await Promise.all([...controller.pendingFileUploads]);
    return event;
  };
  return {
    dom,
    uploads,
    shells,
    controller,
    bound,
    pane,
    editor,
    transcript,
    file,
    dispatch,
    render,
    bindPaste,
    paste,
    translations: conversation.testing.translations,
    rebind(id) {
      bound.set(id, registration.inject(id));
    },
    documentDropListeners: () => listenerSets[0].get("drop")?.size ?? 0,
    async cleanup() {
      for (const release of releases) release();
      await act(async () => root.unmount());
      assert.equal(document.querySelector(".dshMulti-fileDropTarget"), null);
      for (const byType of listenerSets)
        for (const listeners of byType.values())
          assert.equal(listeners.size, 0);
      await controllerOwner.dispose();
      await uploadOwner.dispose();
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("attachment fork rejects native drift and preserves editor paste and picker implementation", () => {
  assert.throws(
    () => buildAttachmentFork(nativeAttachment + "\n"),
    /SHA-256 mismatch/,
  );
  const inputBinding = (source) =>
    source.slice(
      source.indexOf("function registerComposerKeymap("),
      source.indexOf("function keepDraftFocus("),
    );
  assert.equal(
    inputBinding(conversationFork),
    inputBinding(nativeConversation),
  );
});

test("pinned original reproduces the document-drop broadcast through real native intake", async () => {
  const ui = await fixture(nativeAttachment);
  try {
    ui.editor("alpha").focus();
    await ui.dispatch(ui.transcript("beta"), "drop", [ui.file("original.txt")]);
    assert.deepEqual(
      ui.uploads.map((upload) => upload.sessionId),
      ["alpha", "beta"],
    );
  } finally {
    await ui.cleanup();
  }
});

test("native attachment hook targets the unfocused pane, preserves other intake, and cleans up", async () => {
  const ui = await fixture();
  try {
    assert.equal(ui.documentDropListeners(), 2);
    ui.bindPaste("alpha");
    ui.bindPaste("beta");
    ui.editor("alpha").focus();
    const first = ui.file("beta-drop.txt");
    await ui.dispatch(ui.transcript("beta"), "dragenter", [first]);
    const mask = ui.pane("beta").querySelector('[role="status"]');
    assert.ok(mask);
    assert.equal(ui.pane("alpha").querySelector('[role="status"]'), null);
    assert.equal(mask.parentElement, ui.pane("beta"));
    assert.equal(mask.style.position, "absolute");
    assert.equal(mask.dataset.dropState, "accepted");
    assert.equal(mask.getAttribute("aria-atomic"), "true");
    assert.ok(mask.classList.contains("dshMulti-fileDropTarget"));
    assert.equal(
      mask.querySelector(".dshMulti-fileDropTitle").textContent,
      "Drop files in this chat",
    );
    assert.ok(
      mask.textContent.includes("Image limit: up to 3 images, 10 MB each"),
    );
    assert.equal(window.getComputedStyle(mask).pointerEvents, "none");
    const hover = await ui.dispatch(ui.transcript("beta"), "dragover", [first]);
    assert.equal(hover.transfer.dropEffect, "copy");
    const dropped = await ui.dispatch(ui.transcript("beta"), "drop", [first]);
    assert.equal(dropped.event.defaultPrevented, true);
    assert.deepEqual(ui.uploads, [{ sessionId: "beta", name: first.name }]);
    assert.equal(ui.shells.get("alpha").snapshot.attachmentIds.length, 0);
    assert.equal(ui.shells.get("beta").snapshot.attachmentIds.length, 1);
    assert.equal(ui.shells.get("alpha").snapshot.draft, "draft-alpha");
    assert.equal(ui.shells.get("beta").snapshot.draft, "draft-beta");
    assert.equal(ui.pane("beta").querySelector('[role="status"]'), null);

    // Moving keyed panes and maximizing one changes presentation, not intake ownership.
    const alphaPane = ui.pane("alpha");
    await ui.render({ order: ["beta", "alpha"] });
    assert.equal(ui.pane("alpha"), alphaPane);
    await ui.dispatch(ui.transcript("alpha"), "drop", [
      ui.file("alpha-drop.txt"),
    ]);
    assert.deepEqual(
      ui.uploads.map((upload) => upload.sessionId),
      ["beta", "alpha"],
    );
    await ui.render({ hidden: "alpha", blocked: "beta" });
    await ui.dispatch(ui.transcript("alpha"), "drop", [ui.file("hidden.txt")]);
    const blocked = await ui.dispatch(ui.transcript("beta"), "dragover", [
      first,
    ]);
    assert.equal(blocked.transfer.dropEffect, "none");
    await ui.dispatch(ui.transcript("beta"), "drop", [ui.file("blocked.txt")]);
    assert.equal(ui.uploads.length, 2);
    await ui.render();
    assert.equal(
      ui.documentDropListeners(),
      2,
      "rebinding removes old listeners",
    );

    // Internal pane drags and consumed guest drops must keep their bubble semantics.
    const internal = await ui.dispatch(ui.transcript("beta"), "drop");
    assert.equal(internal.event.defaultPrevented, false);
    const outside = await ui.dispatch(document.body, "drop", [
      ui.file("outside.txt"),
    ]);
    assert.equal(outside.event.defaultPrevented, false);
    ui.transcript("beta").addEventListener(
      "drop",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      { once: true },
    );
    await ui.dispatch(ui.transcript("beta"), "drop", [
      ui.file("guest-owned.txt"),
    ]);
    assert.equal(ui.uploads.length, 2);

    await ui.paste("beta", [ui.file("beta-paste.txt")]);
    assert.deepEqual(ui.uploads.at(-1), {
      sessionId: "beta",
      name: "beta-paste.txt",
    });
    await ui.paste("alpha", [], "ordinary text");
    assert.equal(ui.shells.get("alpha").snapshot.draft, "ordinary text");
    assert.equal(ui.shells.get("beta").snapshot.draft, "draft-beta");
    assert.equal(ui.uploads.length, 3);
    assert.equal(ui.shells.get("alpha").snapshot.attachmentIds.length, 1);
    assert.equal(ui.shells.get("beta").snapshot.attachmentIds.length, 2);
    assert.ok(
      Object.values(ui.controller.fileUploads.getSnapshot()).every(
        (state) => state.status === "ready",
      ),
    );
  } finally {
    await ui.cleanup();
  }
});

test("file-target feedback follows the drag without changing keyboard focus and clears on exit", async () => {
  const ui = await fixture();
  const feedback = (id) =>
    ui.pane(id).querySelector(".dshMulti-fileDropTarget");
  try {
    const file = ui.file("feedback.txt");
    ui.editor("alpha").focus();
    assert.equal(document.querySelector("[data-focus-highlight]"), null);
    assert.equal(
      ui.translations.zh["attachment.dropTitle"],
      "将文件拖放到此聊天",
    );
    await ui.dispatch(ui.transcript("alpha"), "dragenter", [file]);
    assert.equal(feedback("alpha").dataset.dropState, "accepted");
    await ui.dispatch(ui.transcript("beta"), "dragenter", [file]);
    assert.equal(feedback("alpha"), null);
    assert.equal(feedback("beta").dataset.dropState, "accepted");
    assert.equal(document.activeElement, ui.editor("alpha"));

    await ui.dispatch(ui.transcript("beta"), "dragleave", [file], {
      relatedTarget: ui.editor("alpha"),
    });
    assert.equal(feedback("beta"), null);
    await ui.dispatch(ui.transcript("beta"), "dragenter", [file]);
    await ui.render({ blocked: "beta" });
    assert.equal(feedback("beta").dataset.dropState, "blocked");
    assert.equal(
      feedback("beta").querySelector(".dshMulti-fileDropTitle").textContent,
      "Files and images cannot be added right now",
    );
    assert.ok(
      !feedback("beta").textContent.includes("10 MB"),
      "blocked feedback still omits native image limits",
    );
    await ui.dispatch(ui.transcript("beta"), "drop", [file]);
    assert.equal(feedback("beta"), null);
    assert.equal(ui.uploads.length, 0);

    await ui.render();
    await ui.dispatch(ui.transcript("alpha"), "dragenter", [file]);
    await act(async () => window.dispatchEvent(new window.Event("dragend")));
    assert.equal(feedback("alpha"), null);
    await ui.dispatch(ui.transcript("beta"), "dragenter", [file]);
    assert.ok(feedback("beta"), "cleanup below removes an active pane portal");
    assert.equal(document.activeElement, ui.editor("alpha"));
  } finally {
    await ui.cleanup();
  }
});

test("ongoing dragover targets every pane and survives native intake rebinding", async () => {
  const ids = ["alpha", "beta", "gamma"];
  const ui = await fixture(attachmentFork, ids);
  const feedback = (id) =>
    ui.pane(id).querySelector(".dshMulti-fileDropTarget");
  try {
    const file = ui.file("ongoing.txt");
    ui.editor("alpha").focus();
    for (const id of ["beta", "gamma", "alpha"]) {
      const hover = await ui.dispatch(ui.transcript(id), "dragover", [file]);
      assert.ok(feedback(id), `dragover alone activates ${id}`);
      assert.equal(hover.transfer.dropEffect, "copy");
      for (const other of ids.filter((other) => other !== id))
        assert.equal(feedback(other), null);
    }
    ui.rebind("alpha");
    await ui.render({ blocked: "alpha" });
    assert.equal(feedback("alpha").dataset.dropState, "blocked");
    assert.equal(ui.documentDropListeners(), 3);
    const blocked = await ui.dispatch(ui.editor("alpha"), "dragover", [file]);
    assert.equal(blocked.transfer.dropEffect, "none");
    ui.rebind("gamma");
    await ui.render();
    await ui.dispatch(ui.editor("gamma"), "dragover", [file]);
    assert.ok(feedback("gamma"));
    assert.equal(feedback("alpha"), null);
    assert.equal(document.activeElement, ui.editor("alpha"));
    await ui.dispatch(ui.editor("gamma"), "drop", [file]);
    assert.deepEqual(ui.uploads, [{ sessionId: "gamma", name: file.name }]);
    assert.equal(feedback("gamma"), null);
  } finally {
    await ui.cleanup();
  }
});

test("new-pane enter followed by old-pane leave keeps current file target feedback", async () => {
  const ui = await fixture();
  const feedback = (id) =>
    ui.pane(id).querySelector(".dshMulti-fileDropTarget");
  try {
    const file = ui.file("ordered.txt");
    await ui.dispatch(ui.transcript("alpha"), "dragenter", [file]);
    await ui.dispatch(ui.transcript("beta"), "dragenter", [file]);
    await ui.dispatch(ui.transcript("alpha"), "dragleave", [file], {
      relatedTarget: ui.transcript("beta"),
    });
    assert.equal(feedback("alpha"), null);
    assert.ok(
      feedback("beta"),
      "foreign dragleave must not clear the new owner",
    );
    await ui.dispatch(ui.transcript("beta"), "dragover", [file]);
    await ui.dispatch(ui.transcript("beta"), "dragleave", [file], {
      relatedTarget: ui.editor("beta"),
    });
    assert.ok(
      feedback("beta"),
      "nested leave within the same pane is not a pane exit",
    );
    await ui.dispatch(ui.editor("beta"), "dragover", [file]);
    await ui.dispatch(ui.editor("beta"), "dragleave", [file], {
      relatedTarget: document.body,
    });
    assert.equal(feedback("beta"), null);
    await ui.dispatch(ui.transcript("alpha"), "dragover", [file]);
    await ui.dispatch(document.body, "dragleave", [file], {
      clientX: 0,
      clientY: 0,
    });
    assert.equal(
      feedback("alpha"),
      null,
      "viewport exit clears an active pane",
    );
    await ui.dispatch(ui.transcript("beta"), "dragover", [file]);
    await ui.dispatch(document.body, "dragover", [file]);
    assert.equal(
      feedback("beta"),
      null,
      "ongoing drag outside panes clears feedback",
    );
  } finally {
    await ui.cleanup();
  }
});
