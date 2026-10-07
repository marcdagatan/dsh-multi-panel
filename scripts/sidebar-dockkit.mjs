import { createHash } from "node:crypto";
import { parse } from "acorn";
import { sidebarRectangles } from "../client/sidebar-pane.mjs";

/** Find lexical free names so a shell fork never silently guesses imports. */
export function freeIdentifiers(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
  const scopes = new WeakMap();
  const bindings = new WeakSet();
  const root = { parent: null, names: new Set(), function: true };
  const bind = (node, scope) => {
    if (!node) return;
    if (node.type === "Identifier") {
      scope.names.add(node.name);
      bindings.add(node);
    } else if (node.type === "RestElement") bind(node.argument, scope);
    else if (node.type === "AssignmentPattern") bind(node.left, scope);
    else if (node.type === "ArrayPattern")
      node.elements.forEach((item) => bind(item, scope));
    else if (node.type === "ObjectPattern")
      node.properties.forEach((item) =>
        bind(item.type === "RestElement" ? item.argument : item.value, scope),
      );
  };
  const children = (node) =>
    Object.entries(node).flatMap(([key, value]) => {
      if (key === "start" || key === "end") return [];
      if (Array.isArray(value))
        return value
          .filter((item) => item && typeof item.type === "string")
          .map((item) => [key, item]);
      return value && typeof value.type === "string" ? [[key, value]] : [];
    });
  const declare = (node, inherited) => {
    let scope = inherited;
    if (/Function/.test(node.type) || node.type === "ArrowFunctionExpression") {
      if (node.type === "FunctionDeclaration") bind(node.id, inherited);
      scope = { parent: inherited, names: new Set(), function: true };
      bind(node.id, scope);
      node.params.forEach((param) => bind(param, scope));
    } else if (node.type === "BlockStatement" || node.type === "CatchClause") {
      scope = { parent: inherited, names: new Set(), function: false };
      if (node.type === "CatchClause") bind(node.param, scope);
    }
    scopes.set(node, scope);
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var") while (!target.function) target = target.parent;
      node.declarations.forEach((item) => bind(item.id, target));
    }
    if (node.type === "ClassDeclaration") bind(node.id, scope);
    children(node).forEach(([, child]) => declare(child, scope));
  };
  declare(ast, root);
  const free = new Set();
  const reference = (node, parent, key) => {
    if (node.type === "Identifier" && !bindings.has(node)) {
      const propertyKey =
        (parent?.type === "MemberExpression" &&
          key === "property" &&
          !parent.computed) ||
        ((parent?.type === "Property" ||
          parent?.type === "MethodDefinition" ||
          parent?.type === "PropertyDefinition") &&
          key === "key" &&
          !parent.computed);
      if (!propertyKey) {
        let scope = scopes.get(node);
        while (scope && !scope.names.has(node.name)) scope = scope.parent;
        if (!scope) free.add(node.name);
      }
    }
    children(node).forEach(([childKey, child]) =>
      reference(child, node, childKey),
    );
  };
  reference(ast, null, "");
  return [...free].sort();
}

export function extractDockkit(shell) {
  const begin = shell.indexOf('lE="_split_6nhg2_17"');
  const end = shell.indexOf(")),Kr=", begin);
  if (begin < 0 || end < 0)
    throw new Error("Pinned dockkit shell boundary not found");
  return `const ${shell.slice(begin, end + 2)};`;
}

export function shellDigest(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function dockkitFreeNames(shell) {
  return freeIdentifiers(extractDockkit(shell));
}

export const PINNED_SHELL_SHA256 =
  "af3ff948cf3f132edbddebea93e2f9f02233b390a94bd4c9842182300be811bb";

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Dockkit patch boundary changed: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}

function flatDockLayout({ state: n, callbacks: o, preview: s, ...props }) {
  const a = j.useRef();
  const callbacks = {
    ...o,
    onFocusTab: (tabId) => {
      a.current =
        Kt(n, tabId).activeTabId === tabId
          ? undefined
          : { tabId, origin: document.activeElement };
      o.onFocusTab(tabId);
    },
  };
  const geometry = dshSidebarRectangles(n, s);
  const floats = N7(n, props.intents);
  const position = (rect) => ({
    position: "absolute",
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });
  return l.jsxs("div", {
    className: ve.tabLayout,
    style: {
      display: "block",
      position: "relative",
      height: "100%",
      minHeight: 0,
    },
    children: [
      Object.values(n.tabs)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((tab) => {
          const pane = Kt(n, tab.id);
          return l.jsx(
            US,
            {
              ...props,
              state: n,
              callbacks,
              tab,
              pane,
              column: 0,
              position:
                pane.host === "dock"
                  ? position(geometry.panes.get(pane.id))
                  : undefined,
              floats,
              focusRequest: a,
            },
            tab.id,
          );
        }),
      [...geometry.panes]
        .filter(([id]) => Re(n, id).tabs.length === 0)
        .map(([id, rect]) =>
          l.jsx(
            "div",
            {
              className: ve.emptyTabHost,
              "data-dockkit-empty": true,
              style: position(rect),
              children: l.jsx(O7, { state: n, pane: Re(n, id), callbacks: o }),
            },
            id,
          ),
        ),
      geometry.dividers.map((divider) => {
        const row = divider.axis === "row";
        const split = n.nodes[divider.splitId];
        return l.jsx(
          "div",
          {
            style: {
              ...position(divider.rect),
              pointerEvents: "none",
              zIndex: 20,
            },
            children: l.jsx("div", {
              className: ue(ve.divider, ve.tabLayoutDivider),
              "data-dockkit-divider": `${divider.splitId}:${divider.index}`,
              role: "separator",
              tabIndex: 0,
              "aria-label": "Resize sidebar panes",
              "aria-orientation": row ? "vertical" : "horizontal",
              "aria-valuenow": Math.round(divider.offset * 100),
              style: row
                ? {
                    position: "absolute",
                    left: `calc(${divider.offset * 100}% - 3px)`,
                    top: 0,
                    width: 6,
                    height: "100%",
                    cursor: "col-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  }
                : {
                    position: "absolute",
                    top: `calc(${divider.offset * 100}% - 3px)`,
                    left: 0,
                    height: 6,
                    width: "100%",
                    cursor: "row-resize",
                    pointerEvents: "auto",
                    touchAction: "none",
                  },
              onPointerDown: (event) =>
                o.onDividerPressed(divider.splitId, divider.index, event),
              onKeyDown: (event) => {
                const decrease = row ? "ArrowLeft" : "ArrowUp";
                const increase = row ? "ArrowRight" : "ArrowDown";
                if (event.key !== decrease && event.key !== increase) return;
                event.preventDefault();
                props.intents.resizeSplit(
                  divider.splitId,
                  n0(
                    l7(
                      split.sizes,
                      divider.index,
                      event.key === decrease ? -0.03 : 0.03,
                    ),
                    0.12,
                  ),
                );
              },
            }),
          },
          `${divider.splitId}:${divider.index}`,
        );
      }),
    ],
  });
}

/** Return a private native dockkit fork; only geometry and the explicit pane limit change. */
export function buildSidebarDockkit(shell) {
  if (shellDigest(shell) !== PINNED_SHELL_SHA256)
    throw new Error("Unsupported DSH shell: sidebar dockkit SHA-256 mismatch");
  let source = extractDockkit(shell);
  const aliases = {
    d5: "IconCloseFillRegular",
    vs: "IconCloseOutlineRegular",
    Y4: "IconPanelLeftOutlineRegular",
    J4: "IconPlusOutlineRegular",
    Ji: "MenuSurface",
    Bn: "Tooltip",
    o1: "focusWithoutRing",
    V6: "modalSelector",
    xs: "observeComposition",
  };
  const globals = new Set([
    "AbortController",
    "Error",
    "HTMLElement",
    "JSON",
    "Map",
    "Math",
    "Node",
    "Number",
    "Object",
    "ResizeObserver",
    "Set",
    "String",
    "Symbol",
    "document",
    "getComputedStyle",
    "window",
    "j",
    "l",
    "cn",
    "ue",
  ]);
  for (const name of freeIdentifiers(source))
    if (!globals.has(name) && !aliases[name])
      throw new Error(`Unmapped native dockkit import ${name}`);
  const ast = parse(source, { ecmaVersion: "latest" });
  const layout = ast.body.find(
    (node) => node.type === "FunctionDeclaration" && node.id.name === "ZS",
  );
  if (!layout) throw new Error("Native stable-host layout was not found");
  source =
    source.slice(0, layout.start) +
    flatDockLayout.toString().replace("flatDockLayout", "ZS") +
    source.slice(layout.end);
  source = replaceOnce(
    source,
    "active:g=!0}){const x=a.host",
    "active:g=!0,position:position}){const x=a.host",
  );
  source = replaceOnce(
    source,
    "gridColumn:x?1:u*2+1,gridRow:1,order:x?F:0",
    "...(x?{gridColumn:1,gridRow:1}:position),order:x?F:0",
  );
  source = replaceOnce(source, "const gS=4,e0=", "const gS=16,e0=");
  source = replaceOnce(
    source,
    "function bs(e){return e7(e)<4}",
    "function bs(e){return e7(e)<gS}",
  );
  const imports = Object.entries(aliases)
    .map(([alias, name]) => `const ${alias}=primitives.${name};`)
    .join("\n");
  return `(()=>{\nconst j=require('react'),l=require('react/jsx-runtime'),cn=require('react-dom');\nconst primitives=require('@deepseek-ai/dsh-client-ui-primitives');\nconst ue=(...classes)=>classes.filter(Boolean).join(' ');\n${imports}\nconst dshSidebarRectangles=${sidebarRectangles.toString()};\n${source}\nreturn XS;\n})()`;
}
