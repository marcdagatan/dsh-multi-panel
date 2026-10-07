import { createHash } from "node:crypto";

export const PINNED_CONVERSATION_SHA256 =
  "a3f53771eeebdadbd2184c87c92845dcca2b1f4414031e1e5a3d502d95405948";

function replaceOnce(source, before, after, owner = "Conversation") {
  if (source.split(before).length !== 2)
    throw new Error(`${owner} patch boundary changed: ${before.slice(0, 100)}`);
  return source.replace(before, after);
}

/** Fork only the native root assembly; keep native views, input shell, approvals and header slots. */
export function buildConversationFork(source) {
  if (
    createHash("sha256").update(source).digest("hex") !==
    PINNED_CONVERSATION_SHA256
  )
    throw new Error("Unsupported conversation artifact: SHA-256 mismatch");
  let result = replaceOnce(
    source,
    'id: "@deepseek-ai/dsh-client-ui-conversation",',
    'id: "dsh-multi-panel-conversation",',
  );
  result = replaceOnce(
    result,
    'function ConversationPanel({ renderSlot }) {\n\t\t\treturn renderSlot("main.conversation", {});\n\t\t}',
    'function ConversationPanel(props) {\n\t\t\tconst tabs = react.useSyncExternalStore(props.workspaceSource.subscribe, props.workspaceSource.getSnapshot, props.workspaceSource.getSnapshot);\n\t\t\treturn tabs === null ? null : react.createElement(require("dsh-multi-panel/workspace-tabs-view").WorkspaceTabs, { ...props, tabs });\n\t\t}',
  );
  result = replaceOnce(
    result,
    '\t\t\tslots.inject("main", function* () {',
    '\t\t\tconst multiPanelWorkspaceSource = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(null);\n\t\t\tslots.inject("main", function* () {',
  );
  result = replaceOnce(
    result,
    'children: { "main.conversation": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "session-maybe"\n\t\t\t\t\t} }',
    'inject: () => ({ workspaceSource: multiPanelWorkspaceSource, preferencesSource: config.multiPanelPreferences }),\n\t\t\t\t\tchildren: { "main.conversation": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "session-maybe"\n\t\t\t\t\t}, "dsh.multi.sidebar": { kind: "single", scope: "session" } }',
  );
  // Native consumers (including agent-preset) register as soon as conversation
  // activates. Keep native declarations BEFORE its controller, not behind a
  // readiness gate. Gate only rendering: eager slot listeners must not resolve
  // the composer until both service owners are active and preferences are ready.
  const controller =
    "\t\t\tctx.plugin(ConversationController, {\n\t\t\t\tinput: inputHub,\n\t\t\t\tblocks: composerBlocks,\n\t\t\t\tmaxConcurrentFileUploads\n\t\t\t});";
  result = replaceOnce(
    result,
    controller,
    `${controller}
			ctx.inject(["uiConversation", "conversation"], (mount) => {
				mount.effect(() => require("dsh-multi-panel/preferences").whenPreferencesReady(config.multiPanelPreferences, () => {
					const createSession = (originId) => { const rows = sessions.list.getSnapshot().byId; const origin = Object.hasOwn(rows, originId) ? rows[originId] : undefined; const selectedWorkspace = workspaceNavigation?.workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(originId)); return sessions.create(selectedWorkspace ? { workspaceId: selectedWorkspace.workspaceId } : origin?.cwd ? { cwd: origin.cwd } : {}); };
					const tabs = require("dsh-multi-panel/workspace-tabs").createWorkspaceTabs({ storage: globalThis.localStorage, restore: config.multiPanelPreferences.getSnapshot().restoreLayout, createWorkspace: (options) => require("dsh-multi-panel/workspace-state").createWorkspaceState({ sessions, navigation: workspaceNavigation, storage: globalThis.localStorage, getPreferences: config.multiPanelPreferences.getSnapshot, createSession, ...options }) });
					mount.effect(() => {
						multiPanelWorkspaceSource.set(tabs);
						return () => { multiPanelWorkspaceSource.set(null); tabs.dispose(); };
					}, "multi-panel: retained pane sessions");
					require("dsh-multi-panel/shortcuts").registerPaneShortcuts(mount, tabs, config.multiPanelPreferences);
				}), "multi-panel: startup preferences");
			});`,
  );
  result = replaceOnce(
    result,
    '"attachment.dropTitle": "Drag files or images here to add them",',
    '"attachment.dropTitle": "Drop files in this chat",',
  );
  result = replaceOnce(
    result,
    '"attachment.dropTitle": "文件或图片拖动到此处即可添加",',
    '"attachment.dropTitle": "将文件拖放到此聊天",',
  );
  return result;
}

export const PINNED_ATTACHMENT_SHA256 =
  "612acffb3ce5ca4fa8806ce274bcde37bfdfac61eb31da75bb9c639bc96927ab";

/** Keep native attachment presentation and uploads; scope its file-drop hook to its pane. */
export function buildAttachmentFork(source) {
  if (
    createHash("sha256").update(source).digest("hex") !==
    PINNED_ATTACHMENT_SHA256
  )
    throw new Error("Unsupported attachment artifact: SHA-256 mismatch");
  let result = source;
  const patch = (before, after) => {
    result = replaceOnce(result, before, after, "Attachment");
  };
  patch(
    'id: "@deepseek-ai/dsh-client-ui-attachment",',
    'id: "dsh-multi-panel-attachment",',
  );
  patch(
    "function installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive) {",
    `function installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive, dropAnchorRef) {
			// Resolve the live DOM owner, not the focused session or cached pane geometry.
			const ownsTarget = (target) => {
				const pane = dropAnchorRef.current?.closest("[data-chat-pane]");
				const element = target?.nodeType === 1 ? target : target?.parentElement;
				return pane != null && pane.isConnected && !pane.hidden && pane.style.display !== "none" && element?.closest("[data-chat-pane]") === pane;
			};`,
  );
  patch(
    '\t\t\t\tif (dataTransfer === null || !dataTransfer.types.includes("Files")) return null;',
    '\t\t\t\tif (dataTransfer === null || !dataTransfer.types.includes("Files") || !ownsTarget(event.target)) return null;',
  );
  patch(
    "\t\t\tconst onDragEnter = (event) => {\n\t\t\t\tif (fileTransfer(event) === null) return;",
    "\t\t\tconst onDragEnter = (event) => {\n\t\t\t\tif (fileTransfer(event) === null) { reset(); return; }",
  );
  patch(
    "\t\t\tconst onDragOver = (event) => {\n\t\t\t\tconst dataTransfer = fileTransfer(event);\n\t\t\t\tif (dataTransfer === null) return;",
    "\t\t\tconst onDragOver = (event) => {\n\t\t\t\tconst dataTransfer = fileTransfer(event);\n\t\t\t\tif (dataTransfer === null) { reset(); return; }\n\t\t\t\t// Ongoing hover is authoritative even if dragenter was missed or listeners rebound.\n\t\t\t\tdragDepth.current = Math.max(1, dragDepth.current);\n\t\t\t\tsetDragActive(true);",
  );
  patch(
    `\t\t\tconst onDragLeave = (event) => {
				if (fileTransfer(event) === null) return;
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setDragActive(false);
				const leftViewport = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
				if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset();
			};`,
    `\t\t\tconst onDragLeave = (event) => {
				const dataTransfer = event.dataTransfer;
				if (dataTransfer === null || !dataTransfer.types.includes("Files")) return;
				const leftViewport = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
				if ((event.target === document.documentElement || event.target === document.body) && leftViewport) { reset(); return; }
				// A new pane's enter may precede the old pane's leave. Foreign leaves
				// must not clear the new owner or decrement its independent depth.
				if (!ownsTarget(event.target)) return;
				if (event.relatedTarget != null) {
					if (ownsTarget(event.relatedTarget)) dragDepth.current = Math.max(1, dragDepth.current - 1);
					else reset();
					return;
				}
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setDragActive(false);
			};`,
  );
  patch(
    "\t\t\tconst onDrop = (event) => {\n\t\t\t\tconst dataTransfer = fileTransfer(event);\n\t\t\t\tif (dataTransfer === null) return;",
    "\t\t\tconst onDrop = (event) => {\n\t\t\t\tconst dataTransfer = fileTransfer(event);\n\t\t\t\tif (dataTransfer === null) { reset(); return; }",
  );
  patch(
    "\t\t\tconst dragDepth = (0, react.useRef)(0);",
    "\t\t\tconst dragDepth = (0, react.useRef)(0);\n\t\t\tconst dropAnchorRef = (0, react.useRef)(null);",
  );
  patch(
    "return installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive);",
    "return installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive, dropAnchorRef);",
  );
  patch(
    "\t\t\treturn (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [\n\t\t\t\tdragActive &&",
    '\t\t\treturn (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [\n\t\t\t\t(0, react_jsx_runtime.jsx)("span", { ref: dropAnchorRef, hidden: true }),\n\t\t\t\tdragActive &&',
  );
  // The native mask is pointer-transparent. Keep it that way, but portal into
  // the owning positioned pane so its invitation does not cover other chats.
  patch(
    "function DropOverlay({ disabled, labels }) {",
    "function DropOverlay({ disabled, labels, target = document.body }) {",
  );
  patch(
    "\t\t\t\tclassName: DropOverlay_module_css_default.mask,",
    '\t\t\t\tclassName: `${DropOverlay_module_css_default.mask} dshMulti-fileDropTarget`,\n\t\t\t\t"data-drop-state": disabled ? "blocked" : "accepted",\n\t\t\t\t"aria-atomic": true,\n\t\t\t\tstyle: target === document.body ? void 0 : { position: "absolute" },',
  );
  patch(
    "\t\t\t\t\t\tclassName: DropOverlay_module_css_default.title,",
    "\t\t\t\t\t\tclassName: `${DropOverlay_module_css_default.title} dshMulti-fileDropTitle`,",
  );
  patch("\t\t\t}), document.body);", "\t\t\t}), target);");
  patch(
    "\t\t\t\tdragActive && (0, react_jsx_runtime.jsx)(DropOverlay, {\n\t\t\t\t\tdisabled:",
    '\t\t\t\tdragActive && (0, react_jsx_runtime.jsx)(DropOverlay, {\n\t\t\t\t\ttarget: dropAnchorRef.current?.closest("[data-chat-pane]"),\n\t\t\t\t\tdisabled:',
  );
  return result;
}
