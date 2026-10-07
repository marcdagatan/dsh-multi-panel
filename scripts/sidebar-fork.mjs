import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSidebarPane, sidebarWidth } from "../client/sidebar-pane.mjs";
import { buildSidebarDockkit } from "./sidebar-dockkit.mjs";

export const PINNED_SIDEBAR_SHA256 =
  "4895dade6651ef34c33cf2f61d7933cc43c9933900c9d1ef76e5ad2f09abefff";

function replaceOnce(source, before, after) {
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    before.split(/\n\t*/).map(escape).join("\\n\\t*"),
    "g",
  );
  if ([...source.matchAll(pattern)].length !== 1)
    throw new Error(`Sidebar patch boundary changed: ${before.slice(0, 100)}`);
  return source.replace(pattern, () => after);
}

/** A cross-pane move of a sole docked tab replaces its collapsed source pane. */
function sidebarMoveKeepsCount(state, tabId, targetPaneId) {
  const source = _deepseek_ai_dsh_client_ui_dockkit.findTabPane(state, tabId);
  return (
    source.host === "dock" &&
    source.id !== targetPaneId &&
    source.tabs.length === 1
  );
}

/** Add a native resize operation after a split; the ratio is the incoming pane's share. */
function sidebarSplitPlan(state, ops, direction) {
  const incoming = sidebarPreferences().sidebarSplitRatio ?? 0.5;
  const result = [];
  let cursor = state;
  for (const operation of ops) {
    const op =
      operation.type === "split" && direction !== undefined
        ? {
            ...operation,
            ..._deepseek_ai_dsh_client_ui_dockkit.zoneSplit(direction),
          }
        : operation;
    result.push(op);
    cursor = _deepseek_ai_dsh_client_ui_dockkit.replay(cursor, [op]);
    if (op.type !== "split" || incoming === 0.5) continue;
    const parent = _deepseek_ai_dsh_client_ui_dockkit.findParent(
      cursor,
      op.newPaneId,
    );
    const incomingIndex = parent.children.indexOf(op.newPaneId);
    const existingIndex = parent.children.indexOf(op.paneId);
    const total = parent.sizes[incomingIndex] + parent.sizes[existingIndex];
    const sizes = parent.sizes.map((size, index) =>
      index === incomingIndex
        ? total * incoming
        : index === existingIndex
          ? total * (1 - incoming)
          : size,
    );
    const resize = { type: "resize", splitId: parent.id, sizes };
    result.push(resize);
    cursor = _deepseek_ai_dsh_client_ui_dockkit.replay(cursor, [resize]);
  }
  return result;
}

function sidebarDirectionalMenu(panel, tab, dismiss) {
  const pane = _deepseek_ai_dsh_client_ui_dockkit.findTabPane(
    panel.surface.layout,
    tab.id,
  );
  return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
    children: [
      ...["left", "right", "top", "bottom"].map((direction) =>
        react_jsx_runtime.jsx(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "dsh-multi-sidebar-menu-item",
            disabled:
              pane.host !== "dock" ||
              !_deepseek_ai_dsh_client_ui_dockkit.canSplit(
                panel.surface.layout,
              ) ||
              panel.room?.get(pane.id)?.[
                direction === "left" || direction === "right" ? "row" : "column"
              ] === false,
            onClick: () => {
              panel.splitPane(pane.id, direction);
              dismiss();
            },
            children: panel.t(`dock.drop.${direction}`),
          },
          direction,
        ),
      ),
      panel.renderSlot("sidebar.right.tab.menu.item", { tab, dismiss }),
    ],
  });
}

/**
 * Reuse the exact installed native sidebar plugin, changing its owning seat,
 * presentation geometry, and split restrictions; native tab services stay intact.
 * The optional shell argument makes build verification deterministic.
 * @param {string} source Exact installed native sidebar client artifact.
 * @param {string} [shellSource] Exact installed Web shell containing dockkit.
 * @returns {string} Module-loader wrapper for the parent's unified client bundle.
 * @throws {Error} If either artifact hash or a patch boundary differs.
 */
export function buildSidebarFork(
  source,
  shellSource = readFileSync(
    new URL(
      "../runtime-evidence/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js",
      import.meta.url,
    ),
    "utf8",
  ),
) {
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== PINNED_SIDEBAR_SHA256)
    throw new Error("Unsupported native sidebar artifact: SHA-256 mismatch");
  let result = source;
  const patch = (before, after) => {
    result = replaceOnce(result, before, after);
  };
  patch(
    'id: "@deepseek-ai/dsh-client-ui-sidebar-right",',
    'id: "dsh-multi-panel-sidebar",',
  );
  // The native toolbar assumes a right split; use its measured axis for the configured default.
  let dockkitSource = replaceOnce(
    buildSidebarDockkit(shellSource),
    'const G=A=>n?wc(M,A).row?void 0:"width":"budget"',
    'const G=A=>n?wc(M,A)[["left","right"].includes(sidebarPreferences().sidebarSplitDirection ?? "right") ? "row" : "column"]?void 0:"width":"budget"',
  );
  dockkitSource = replaceOnce(
    dockkitSource,
    "if(g&&u===void 0||!bs(e))return zt;",
    "if(g&&u===void 0||!bs(e)&&!sidebarMoveKeepsCount(e,o,s))return zt;",
  );
  dockkitSource = replaceOnce(
    dockkitSource,
    "function l4(e,n,o,s,a,u){",
    "function l4(e,n,o,s,a,u,canRearrange){",
  );
  dockkitSource = replaceOnce(
    dockkitSource,
    "if(!s||!y)return",
    "if((!s&&!canRearrange?.(f))||!y)return",
  );
  const dropCall = "l4(X,me.clientX,me.clientY,n,M,y)";
  if (dockkitSource.split(dropCall).length !== 3)
    throw new Error("Sidebar native move/up drop hit-test boundaries changed");
  dockkitSource = dockkitSource.replaceAll(
    dropCall,
    "l4(X,me.clientX,me.clientY,n,M,y,paneId=>sidebarMoveKeepsCount(e,A,paneId))",
  );
  patch(
    'let _deepseek_ai_dsh_client_ui_dockkit = require("@deepseek-ai/dsh-client-ui-dockkit");',
    `let sidebarPreferencesSource;
const sidebarPreferences = () => sidebarPreferencesSource?.getSnapshot() ?? {};
const nativeSidebarDockkit = ${dockkitSource};
let _deepseek_ai_dsh_client_ui_dockkit = Object.freeze({
  ...nativeSidebarDockkit,
  canSplit: (state) => nativeSidebarDockkit.canSplit(state) && nativeSidebarDockkit.dockPaneIds(state).length < (sidebarPreferences().sidebarMaxPanes ?? 16),
  planSplitPane: (state, mint, paneId, makeTab, direction = sidebarPreferences().sidebarSplitDirection ?? "right") => {
    if (!_deepseek_ai_dsh_client_ui_dockkit.canSplit(state)) return [];
    return sidebarSplitPlan(state, nativeSidebarDockkit.planSplitPane(state, mint, paneId, makeTab), direction);
  },
  planDropTab: (state, mint, tabId, paneId, zone, makeTab) => {
    if (zone !== "center" && !_deepseek_ai_dsh_client_ui_dockkit.canSplit(state) && !sidebarMoveKeepsCount(state, tabId, paneId)) return [];
    return sidebarSplitPlan(state, nativeSidebarDockkit.planDropTab(state, mint, tabId, paneId, zone, makeTab));
  },
});`,
  );
  patch(
    'const sidebarPersistence = "dsh.sidebar-right.v1";',
    'const sidebarPersistence = "dsh.multi.sidebar.v1";',
  );
  patch(
    "raw = localStorage.getItem(`${sidebarPersistence}.${sessionId}`);",
    "raw = localStorage.getItem(`${sidebarPersistence}.${sessionId}`) ?? localStorage.getItem(`dsh.sidebar-right.v1.${sessionId}`);",
  );
  patch(
    'host !== "dock" || id !== layout.rootId || entry.axis !== "row" || entry.children.length !== 2 || entry.children.length !== entry.sizes.length',
    'host !== "dock" || entry.children.length !== entry.sizes.length',
  );
  patch(
    "if (visited.size !== Object.keys(layout.nodes).length",
    "if (_deepseek_ai_dsh_client_ui_dockkit.dockPaneIds(layout).length > 16) reject();\n\t\t\tif (visited.size !== Object.keys(layout.nodes).length",
  );
  patch(
    "if (key === null || !key.startsWith(`dsh.sidebar-right.v1.`)) continue;\n\t\t\t\t\t\tconst sessionId = key.slice(21);",
    'if (key === null) continue;\n\t\t\t\t\t\tconst prefix = [sidebarPersistence + ".", "dsh.sidebar-right.v1."].find((prefix) => key.startsWith(prefix));\n\t\t\t\t\t\tif (prefix === undefined) continue;\n\t\t\t\t\t\tconst sessionId = key.slice(prefix.length);',
  );
  patch(
    "splitPane: (d, sessionId, paneId, settled) => {",
    'splitPane: (d, sessionId, paneId, settled, direction = sidebarPreferences().sidebarSplitDirection ?? "right") => {',
  );
  patch(
    "(0, _deepseek_ai_dsh_client_ui_dockkit.dockPaneIds)(state).length >= 2 || (0, _deepseek_ai_dsh_client_ui_dockkit.getPane)(state, paneId ?? (0, _deepseek_ai_dsh_client_ui_dockkit.activeDockPaneId)(state)).tabs.length === 0 ? [] : (0, _deepseek_ai_dsh_client_ui_dockkit.planSplitPane)(state, mint, paneId, makeTab)",
    "!(0, _deepseek_ai_dsh_client_ui_dockkit.canSplit)(state) || (0, _deepseek_ai_dsh_client_ui_dockkit.getPane)(state, paneId ?? (0, _deepseek_ai_dsh_client_ui_dockkit.activeDockPaneId)(state)).tabs.length === 0 ? [] : (0, _deepseek_ai_dsh_client_ui_dockkit.planSplitPane)(state, mint, paneId, makeTab, direction)",
  );
  result = result.replaceAll(
    " && (0, _deepseek_ai_dsh_client_ui_dockkit.dockPaneIds)(surface.layout).length < 2",
    "",
  );
  result = result.replaceAll(
    " || (0, _deepseek_ai_dsh_client_ui_dockkit.dockPaneIds)(layout).length >= 2",
    "",
  );
  patch('if (zone === "top" || zone === "bottom") return [];', "");
  patch(
    'if (zone !== "center" && (0, _deepseek_ai_dsh_client_ui_dockkit.dockPaneIds)(state).length >= 2) return [];',
    'if (zone !== "center" && !(0, _deepseek_ai_dsh_client_ui_dockkit.canSplit)(state) && !sidebarMoveKeepsCount(state, tabId, paneId)) return [];',
  );
  patch('dropZones: "horizontal",', 'dropZones: "edges",');
  patch(
    'width: fullscreen ? "100vw" : width,\n\t\t\t\t\t\t"--dsh-sidebar-width": fullscreen ? "100vw" : `${width}px`',
    'width,\n\t\t\t\t\t\t"--dsh-sidebar-width": `${width}px`',
  );
  patch(
    'renderTabMenuItems: (tab, dismiss) => renderSlot("sidebar.right.tab.menu.item", {\n\t\t\t\t\t\t\ttab,\n\t\t\t\t\t\t\tdismiss\n\t\t\t\t\t\t}),',
    "renderTabMenuItems: (tab, dismiss) => sidebarDirectionalMenu(panel, tab, dismiss),",
  );
  patch(
    "const autoFullscreen = viewportWidth < 768;",
    "const autoFullscreen = false;",
  );
  patch(
    "const panelRef = (0, react.useRef)(null);\n\t\t\tconst reportRoom",
    "const panelRef = (0, react.useRef)(null);\n\t\t\tconst [room, setRoom] = (0, react.useState)(new Map());\n\t\t\tconst reportRoom",
  );
  patch(
    "measureRoom((paneId) => fits.get(paneId)?.row !== false);",
    'setRoom(fits);\n\t\t\t\tmeasureRoom((paneId, direction = "right") => fits.get(paneId)?.[direction === "left" || direction === "right" ? "row" : "column"] !== false);',
  );
  patch(
    "autoFullscreen,\n\t\t\t\treportRoom,",
    "autoFullscreen,\n\t\t\t\troom,\n\t\t\t\treportRoom,",
  );
  patch(
    "split(paneId) {\n\t\t\t\tconst { sessionId, actions } = this.require();\n\t\t\t\tconst layout = this.mountedSurface()?.layout;",
    'split(paneId, sessionId = this.mounted.getSnapshot(), direction = sidebarPreferences().sidebarSplitDirection ?? "right") {\n\t\t\t\tconst actions = this.actionsFor(sessionId);\n\t\t\t\tconst layout = this.adopted.get(sessionId)?.store.getSnapshot().bySession[sessionId]?.layout;\n\t\t\t\tif (actions === undefined) return;',
  );
  patch(
    "!this.canSplitPane(sessionId, target)) return void 0;",
    "!this.canSplitPane(sessionId, target, direction)) return void 0;",
  );
  patch(
    "created = id;\n\t\t\t\t\t});",
    "created = id;\n\t\t\t\t\t}, direction);",
  );
  patch(
    "canSplitPane(sessionId, paneId) {\n\t\t\t\treturn this.rooms.get(sessionId)?.(paneId) ?? true;",
    'canSplitPane(sessionId, paneId, direction = sidebarPreferences().sidebarSplitDirection ?? "right") {\n\t\t\t\treturn this.rooms.get(sessionId)?.(paneId, direction) ?? true;',
  );
  patch(
    "syncPresentation({ shown, track, fullscreen }) {\n\t\t\t\t\t\tif (shown) layout.openRightbar(track, fullscreen);\n\t\t\t\t\t\telse layout.closeRightbar();\n\t\t\t\t\t},",
    "syncPresentation() {},",
  );
  const rootStart =
    '\t\t\t\tconst disposeSeat = ctx.slots.inject("rightbar", function* () {';
  const sessionStart =
    '\t\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\t\tname: "rightbar.session",';
  const begin = result.indexOf(rootStart);
  const end = result.indexOf(sessionStart, begin);
  if (begin < 0 || end < 0)
    throw new Error("Native sidebar root/seat registration boundary changed");
  result =
    result.slice(0, begin) +
    '\t\t\t\tconst disposeSeat = ctx.slots.inject("dsh.multi.sidebar", function* () {\n\t\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\t\tname: "dsh.multi.sidebar",' +
    result.slice(end + sessionStart.length);
  patch("}, RightbarSeat);\n\t\t\t\t});", "}, SidebarPane);\n\t\t\t\t});");
  patch(
    "...injected,\n\t\t\t\t\t\t\tmeasureRoom:",
    '...injected,\n\t\t\t\t\t\t\topenTab: (kind, options) => controller.openTabIn(sessionId, kind, options),\n\t\t\t\t\t\t\tsplitPane: (paneId, direction) => controller.split(paneId, sessionId, direction),\n\t\t\t\t\t\t\ttoggleFullscreen: () => { const actions = controller.actionsFor(sessionId); const surface = controller.adopted.get(sessionId)?.store.getSnapshot().bySession[sessionId]; if (surface) actions.setMode(sessionId, surface.layout.mode === "fullscreen" ? "push" : "fullscreen"); },\n\t\t\t\t\t\t\tmeasureRoom:',
  );
  result = result
    .replaceAll("Two panes is the limit", "Pane limit reached")
    .replaceAll("已达两格上限", "已达分栏上限")
    .replaceAll(
      "Not enough width to split, widen the sidebar",
      "Not enough room to split",
    )
    .replaceAll("栏宽不足，拖宽侧边栏后再分栏", "空间不足，调整侧边栏后再分栏");
  const helper = `\n\t\tconst sidebarMoveKeepsCount=${sidebarMoveKeepsCount.toString()};\n\t\tconst sidebarSplitPlan=${sidebarSplitPlan.toString()};\n\t\tconst sidebarDirectionalMenu=${sidebarDirectionalMenu.toString()};\n\t\tconst SidebarPane=(${createSidebarPane.toString()})(react,react_jsx_runtime,RightbarSeat,${sidebarWidth.toString()});\n`;
  patch(
    '\t\tconst NS = "sidebarRight";',
    helper + '\t\tconst NS = "sidebarRight";',
  );
  patch(
    "function apply(ctx) {",
    "function apply(ctx, { preferencesSource } = {}) {\n\t\t\tsidebarPreferencesSource = preferencesSource;",
  );
  patch(
    "const t = ctx.locale.bind(NS);\n\t\t\tconst tabs",
    `const t = ctx.locale.bind(NS);\n\t\t\tctx.effect(() => {\n\t\t\t\tconst tag = document.createElement('style');\n\t\t\t\ttag.dataset.multiPanelSidebar = '';\n\t\t\t\ttag.textContent = '.dsh-multi-sidebar-host [data-sidebar-right-panel]{max-width:none}.dsh-multi-sidebar-host [data-dockkit-column]{--dsh-dockkit-strip-inline-start:10px!important}.dsh-multi-sidebar-resizer:hover,.dsh-multi-sidebar-resizer:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.dsh-multi-sidebar-menu-item{display:block;width:100%;border:0;background:none;text-align:left;padding:6px 12px;color:inherit;font:inherit;cursor:pointer}.dsh-multi-sidebar-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dsh-multi-sidebar-menu-item:disabled{opacity:.4;cursor:default}';\n\t\t\t\tdocument.head.appendChild(tag);\n\t\t\t\treturn () => tag.remove();\n\t\t\t}, 'multi-sidebar: pane presentation');\n\t\t\tconst tabs`,
  );
  return result;
}
