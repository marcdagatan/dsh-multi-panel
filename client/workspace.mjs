import React from "react";
import { leaves, edgeAt } from "./split-model.mjs";
import { DEFAULT_PREFERENCES } from "./preferences.mjs";
import { UndoNotice } from "./undo-notice.mjs";

const defaultPreferencesSource = {
  subscribe: () => () => {},
  getSnapshot: () => DEFAULT_PREFERENCES,
};

const h = React.createElement;
const DRAG_TYPE = "application/x-dsh-chat-pane";
const EDGE_LABELS = {
  top: "above",
  bottom: "below",
  left: "left",
  right: "right",
};

/** Flat geometry keeps pane components mounted while splits and moves change their position. */
export function paneGeometry(
  tree,
  rect = { left: 0, top: 0, width: 100, height: 100 },
) {
  if (tree.type === "leaf")
    return { panes: [{ leaf: tree, rect }], dividers: [] };
  const horizontal = tree.axis === "horizontal";
  const firstRect = {
    ...rect,
    [horizontal ? "width" : "height"]:
      rect[horizontal ? "width" : "height"] * tree.ratio,
  };
  const secondRect = {
    ...rect,
    [horizontal ? "left" : "top"]:
      rect[horizontal ? "left" : "top"] +
      firstRect[horizontal ? "width" : "height"],
    [horizontal ? "width" : "height"]:
      rect[horizontal ? "width" : "height"] -
      firstRect[horizontal ? "width" : "height"],
  };
  const first = paneGeometry(tree.first, firstRect);
  const second = paneGeometry(tree.second, secondRect);
  return {
    panes: [...first.panes, ...second.panes],
    dividers: [
      { id: tree.id, axis: tree.axis, ratio: tree.ratio, rect },
      ...first.dividers,
      ...second.dividers,
    ],
  };
}

function useSize() {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const update = () => {
      const rect = ref.current.getBoundingClientRect();
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function SplitDivider({
  divider,
  size,
  onResize,
  onEqualize,
  bounds = { min: 0.15, max: 0.85 },
}) {
  const horizontal = divider.axis === "horizontal";
  const { rect } = divider;
  const coordinate = horizontal
    ? rect.left + rect.width * divider.ratio
    : rect.top + rect.height * divider.ratio;
  const pointer = React.useRef(null);
  function resize(event) {
    if (!pointer.current) return;
    const parent = event.currentTarget.parentElement.getBoundingClientRect();
    const point = horizontal
      ? event.clientX - parent.left
      : event.clientY - parent.top;
    const total = horizontal ? size.width : size.height;
    const start = (total * (horizontal ? rect.left : rect.top)) / 100;
    const length = (total * (horizontal ? rect.width : rect.height)) / 100;
    if (length > 0) onResize(divider.id, (point - start) / length);
  }
  return h("div", {
    className: "dshMulti-divider",
    role: "separator",
    tabIndex: 0,
    "aria-label": "Resize chat panes",
    "aria-orientation": horizontal ? "vertical" : "horizontal",
    "aria-valuemin": Math.round(bounds.min * 100),
    "aria-valuemax": Math.round(bounds.max * 100),
    "aria-disabled": bounds.min === bounds.max || undefined,
    "aria-valuenow": Math.round(divider.ratio * 100),
    "data-axis": divider.axis,
    style: horizontal
      ? {
          left: coordinate + "%",
          top: rect.top + "%",
          height: rect.height + "%",
        }
      : {
          top: coordinate + "%",
          left: rect.left + "%",
          width: rect.width + "%",
        },
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: resize,
    onDoubleClick: () => onEqualize?.(divider.id),
    onPointerUp(event) {
      pointer.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel() {
      pointer.current = null;
    },
    onKeyDown(event) {
      const delta = horizontal
        ? { ArrowLeft: -0.03, ArrowRight: 0.03 }[event.key]
        : { ArrowUp: -0.03, ArrowDown: 0.03 }[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      onResize(divider.id, divider.ratio + delta);
    },
  });
}

function ChatPicker({ sessions, currentId, onChoose, onCancel, title, onNew }) {
  const [query, setQuery] = React.useState("");
  const input = React.useRef(null);
  React.useEffect(() => {
    input.current?.focus();
  }, []);
  const items = sessions.ids
    .map((id) => sessions.byId[id])
    .filter(
      (row) => row && !row.archived && (!row.blank || row.id === currentId),
    );
  const matches = items.filter((row) =>
    (row.title || "Untitled chat").toLowerCase().includes(query.toLowerCase()),
  );
  return h(
    "div",
    {
      className: "dshMulti-picker",
      role: "dialog",
      "aria-label": title,
      onKeyDown(event) {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      },
    },
    h(
      "div",
      { className: "dshMulti-pickerHeading" },
      h("strong", null, title),
      h(
        "button",
        {
          type: "button",
          "aria-label": "Close chat picker",
          onClick: onCancel,
        },
        "×",
      ),
    ),
    h("input", {
      ref: input,
      value: query,
      placeholder: "Find a chat…",
      "aria-label": "Find a chat",
      onChange: (event) => setQuery(event.target.value),
    }),
    h(
      "button",
      { type: "button", className: "dshMulti-pickerItem", onClick: onNew },
      "+ New chat",
    ),
    h(
      "div",
      { className: "dshMulti-pickerList" },
      matches.length
        ? matches.map((row) =>
            h(
              "button",
              {
                type: "button",
                key: row.id,
                className: "dshMulti-pickerItem",
                onClick: () => onChoose(row.id),
              },
              h("span", null, row.title || "Untitled chat"),
              row.id === currentId ? h("small", null, "Current") : null,
            ),
          )
        : h("p", null, "No matching chats"),
    ),
  );
}

function Pane({
  leaf,
  rect,
  visible,
  focused,
  state,
  workspace,
  preferences,
  sessions,
  SessionProvider,
  renderSlot,
  drag,
  setDrag,
  target,
  setTarget,
}) {
  const [ref, size] = useSize();
  const [menu, setMenu] = React.useState(false);
  const [picker, setPicker] = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  const pendingNew = React.useRef(false);
  const menuRef = React.useRef(null);
  const title = sessions.byId[leaf.sessionId]?.title || "New chat";
  React.useEffect(() => {
    if (!menu && picker === null) return;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setMenu(false);
        setPicker(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu, picker]);
  const reference = leaf.sessionId
    ? workspace.reference(leaf.sessionId)
    : undefined;
  const style =
    state.maximizedId === leaf.id
      ? { inset: 0 }
      : {
          left: rect.left + "%",
          top: rect.top + "%",
          width: rect.width + "%",
          height: rect.height + "%",
        };
  function dragOver(event) {
    if (!drag || drag.paneId === leaf.id) return;
    const box = event.currentTarget.getBoundingClientRect();
    const edge = edgeAt(
      event.clientX - box.left,
      event.clientY - box.top,
      box.width,
      box.height,
    );
    if (!edge) {
      setTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = drag.paneId ? "move" : "copy";
    if (target?.paneId !== leaf.id || target.edge !== edge)
      setTarget({ paneId: leaf.id, edge });
  }
  function choose(sessionId) {
    if (picker.edge) workspace.split(leaf.id, sessionId, picker.edge);
    else workspace.select(leaf.id, sessionId);
    setPicker(null);
  }
  async function newChat() {
    if (pendingNew.current) return;
    const edge = picker?.edge ?? null;
    pendingNew.current = true;
    setCreating(true);
    setPicker(null);
    try {
      await workspace.newChat(leaf.id, edge);
    } finally {
      pendingNew.current = false;
      setCreating(false);
    }
  }
  const content = () =>
    h(
      "div",
      { className: "dshMulti-paneBody" },
      h(
        "div",
        { className: "dshMulti-conversation" },
        renderSlot("main.conversation", {}),
      ),
      leaf.sessionId && reference
        ? renderSlot("dsh.multi.sidebar", {
            paneId: leaf.id,
            visible,
            focused,
            width: size.width,
            viewportWidth: size.width,
            canShow: true,
            preferences,
          })
        : null,
    );
  return h(
    "section",
    {
      key: leaf.id,
      ref,
      className: "dshMulti-pane",
      style: { ...style, display: visible ? undefined : "none" },
      tabIndex: -1,
      "data-chat-pane": leaf.id,
      "data-focused": focused ? "" : undefined,
      "aria-label": title + " workspace",
      onPointerDownCapture: () => workspace.focus(leaf.id),
      onFocusCapture: () => workspace.focus(leaf.id),
      onDragOver: dragOver,
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null);
      },
      onDrop(event) {
        if (!drag || target?.paneId !== leaf.id) return;
        event.preventDefault();
        event.stopPropagation();
        if (drag.paneId) workspace.move(drag.paneId, leaf.id, target.edge);
        else if (sessions.byId[drag.sessionId])
          workspace.split(leaf.id, drag.sessionId, target.edge);
        setDrag(null);
        setTarget(null);
      },
    },
    h(
      "div",
      { className: "dshMulti-toolbar", ref: menuRef },
      h(
        "button",
        {
          type: "button",
          className: "dshMulti-grip",
          draggable: !!leaf.sessionId,
          "aria-label": "Move " + title + " pane",
          title: "Drag to an edge to move this pane",
          onDragStart(event) {
            const payload = { paneId: leaf.id, sessionId: leaf.sessionId };
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
            event.dataTransfer.setData("text/plain", title);
            event.dataTransfer.effectAllowed = "move";
            setDrag(payload);
          },
          onDragEnd() {
            setDrag(null);
            setTarget(null);
          },
        },
        "⠿",
      ),
      h(
        "button",
        {
          type: "button",
          className: "dshMulti-chatSelect",
          title: "Change chat in this pane",
          "aria-label": "Change chat: " + title,
          onClick: () => {
            setMenu(false);
            setPicker({ edge: null });
          },
        },
        h("span", null, title),
        h("span", { "aria-hidden": true }, "⌄"),
      ),
      h(
        "button",
        {
          type: "button",
          "aria-label": "Split chat pane",
          disabled: creating,
          "aria-expanded": menu,
          onClick: () => {
            setPicker(null);
            setMenu(!menu);
          },
        },
        "Split",
      ),
      h(
        "button",
        {
          type: "button",
          "aria-label":
            state.maximizedId === leaf.id
              ? "Restore chat layout"
              : "Maximize chat pane",
          title:
            state.maximizedId === leaf.id ? "Restore layout" : "Maximize pane",
          onClick: () => workspace.maximize(leaf.id),
        },
        state.maximizedId === leaf.id ? "▣" : "□",
      ),
      leaves(state.tree).length > 1
        ? h(
            "button",
            {
              type: "button",
              "aria-label": "Close chat pane",
              title: "Close pane (chat keeps running)",
              onClick: () => workspace.close(leaf.id),
            },
            "×",
          )
        : null,
      menu
        ? h(
            "div",
            {
              className: "dshMulti-menu",
              role: "menu",
              "aria-label": "Split direction",
              onKeyDown(event) {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setMenu(false);
                }
              },
            },
            [
              preferences.splitDirection,
              ...["top", "bottom", "left", "right"].filter(
                (edge) => edge !== preferences.splitDirection,
              ),
            ].map((edge) =>
              h(
                "button",
                {
                  key: edge,
                  type: "button",
                  role: "menuitem",
                  onClick: () => {
                    setMenu(false);
                    setPicker({ edge });
                  },
                },
                "Split " + EDGE_LABELS[edge],
              ),
            ),
          )
        : null,
      creating ? h("span", { role: "status" }, "Creating chat…") : null,
      picker
        ? h(ChatPicker, {
            sessions,
            currentId: leaf.sessionId,
            title: picker.edge
              ? "Choose chat to split " + EDGE_LABELS[picker.edge]
              : "Choose chat",
            onChoose: choose,
            onNew: newChat,
            onCancel: () => setPicker(null),
          })
        : null,
    ),
    leaf.sessionId && !reference
      ? h(
          "div",
          { className: "dshMulti-unavailable", role: "status" },
          "Chat could not be opened. Choose another chat above.",
        )
      : h(SessionProvider, { session: reference, empty: content }, content()),
    target?.paneId === leaf.id
      ? h(
          "div",
          {
            className: "dshMulti-dropPreview",
            "data-edge": target.edge,
            "aria-hidden": true,
          },
          h("span", null, "Split " + EDGE_LABELS[target.edge]),
        )
      : null,
  );
}

/** Render native chat + composer + per-session sidebar in each independently addressed pane. */
export function MultiWorkspace({
  workspace,
  useSessions,
  SessionProvider,
  renderSlot,
  preferencesSource = defaultPreferencesSource,
}) {
  const preferences = React.useSyncExternalStore(
    preferencesSource.subscribe,
    preferencesSource.getSnapshot,
    preferencesSource.getSnapshot,
  );
  const state = React.useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  );
  const sessions = useSessions((value) => value);
  const [ref, size] = useSize();
  const [drag, setDrag] = React.useState(null);
  const [target, setTarget] = React.useState(null);
  React.useLayoutEffect(
    () => workspace.setViewport?.(size.width, size.height),
    [workspace, size.width, size.height],
  );
  React.useEffect(() => {
    if (state.undo && !preferences.undoEnabled)
      workspace.dismissUndo(state.undo);
  }, [workspace, state.undo, preferences.undoEnabled]);
  React.useEffect(() => {
    function start(event) {
      const row = event.target.closest?.('[data-row-key^="session:"]');
      const sessionId = row?.dataset.rowKey.slice("session:".length);
      if (!sessionId || !sessions.byId[sessionId]) return;
      const payload = { sessionId };
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      setDrag(payload);
    }
    const end = () => {
      setDrag(null);
      setTarget(null);
    };
    const cancel = (event) => {
      if (event.key === "Escape" && drag) {
        event.stopPropagation();
        end();
      }
    };
    document.addEventListener("dragstart", start, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("keydown", cancel, true);
    return () => {
      document.removeEventListener("dragstart", start, true);
      document.removeEventListener("dragend", end, true);
      document.removeEventListener("keydown", cancel, true);
    };
  }, [sessions, drag]);
  const geometry = paneGeometry(state.tree);
  return h(
    "div",
    {
      className: "dshMulti-workspace",
      ref,
      "data-focus-highlight": preferences.focusHighlight || undefined,
      "data-pane-borders": preferences.paneBorders ? undefined : "hidden",
      "data-compact-toolbar": preferences.compactToolbar || undefined,
      "data-pane-titles": preferences.showPaneTitles ? undefined : "hidden",
      style: {
        "--dshMulti-focus-color": preferences.focusColor,
        "--dshMulti-focus-width": `${preferences.focusWidth}px`,
        "--dshMulti-inactive-opacity": preferences.inactiveOpacity,
        "--dshMulti-divider-size": `${preferences.dividerWidth}px`,
      },
    },
    geometry.panes.map(({ leaf, rect }) =>
      h(Pane, {
        key: leaf.id,
        leaf,
        rect,
        visible: !state.maximizedId || state.maximizedId === leaf.id,
        focused: state.activeId === leaf.id,
        state,
        workspace,
        preferences,
        sessions,
        SessionProvider,
        renderSlot,
        drag,
        setDrag,
        target,
        setTarget,
      }),
    ),
    !state.maximizedId
      ? geometry.dividers.map((divider) =>
          h(SplitDivider, {
            key: divider.id,
            divider,
            size,
            bounds:
              workspace.getResizeBounds?.(
                divider.id,
                size.width,
                size.height,
              ) ?? undefined,
            onResize: workspace.resize,
            onEqualize: workspace.equalize,
          }),
        )
      : null,
    state.undo && preferences.undoEnabled
      ? h(UndoNotice, {
          key: `${state.undo.id}:${preferences.undoDuration}`,
          undo: state.undo,
          workspace,
          preferences,
        })
      : null,
    state.warning
      ? h(
          "div",
          { className: "dshMulti-warning", role: "status" },
          state.warning,
        )
      : null,
  );
}
