/** Project native dock nodes into stable, flat tab-host rectangles. */
export function sidebarRectangles(state, preview) {
  const panes = new Map();
  const dividers = [];
  const visit = (id, rect) => {
    const node = state.nodes[id];
    if (!node) throw new Error(`Sidebar layout references missing node ${id}`);
    if (node.kind === "pane") {
      panes.set(id, rect);
      return;
    }
    const sizes = preview?.splitId === id ? preview.sizes : node.sizes;
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (node.children.length !== sizes.length || !(total > 0)) {
      throw new Error(`Sidebar split ${id} has invalid sizes`);
    }
    let offset = 0;
    node.children.forEach((childId, index) => {
      const fraction = sizes[index] / total;
      const childRect =
        node.axis === "row"
          ? {
              ...rect,
              left: rect.left + rect.width * offset,
              width: rect.width * fraction,
            }
          : {
              ...rect,
              top: rect.top + rect.height * offset,
              height: rect.height * fraction,
            };
      visit(childId, childRect);
      offset += fraction;
      if (index < node.children.length - 1) {
        dividers.push({ splitId: id, index, axis: node.axis, rect, offset });
      }
    });
  };
  visit(state.rootId, { left: 0, top: 0, width: 1, height: 1 });
  return { panes, dividers };
}

/**
 * Keep the sidebar useful without exhausting a narrow chat leaf.
 * @param {number} paneWidth Full chat leaf width in pixels.
 * @param {number} ratio Saved/manual override or the current default fraction.
 * @param {number} [minWidth=320] Minimum pixels, clipped to half the leaf width.
 * @returns {number} Width clipped to at most three quarters of the leaf.
 */
export function sidebarWidth(paneWidth, ratio, minWidth = 320) {
  const width = Math.max(0, Number.isFinite(paneWidth) ? paneWidth : 0);
  const fraction = Number.isFinite(ratio) ? ratio : 0.4;
  const minimum = Math.min(
    Number.isFinite(minWidth) ? Math.max(0, minWidth) : 320,
    width * 0.5,
  );
  return Math.min(width * 0.75, Math.max(minimum, width * fraction));
}

/** Create the pane-local shell around the unchanged native session/tab seat. */
export function createSidebarPane(React, jsx, RightbarSeat, measureWidth) {
  return function SidebarPane(props) {
    const { sessionId, paneId, width, visible, useStore, actions } = props;
    const layout = useStore((state) => state.bySession[sessionId]?.layout);
    const expanded = layout?.expanded === true;
    const fullscreen = layout?.mode === "fullscreen";
    const storageKey = `dsh.multi.sidebar.ratio.${sessionId}`;
    // Only a saved width or a user resize is an override; defaults remain live props.
    const [manualRatio, setManualRatio] = React.useState(() => {
      try {
        const saved = Number(localStorage.getItem(storageKey));
        return saved > 0 && saved < 1 ? saved : null;
      } catch (error) {
        console.warn("Sidebar width preference unavailable:", error);
        return null;
      }
    });
    const ratio = manualRatio ?? props.preferences?.sidebarWidth ?? 0.4;
    const minWidth = props.preferences?.sidebarMinWidth ?? 320;
    const drag = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    const localWidth = measureWidth(width, ratio, minWidth);
    const persist = (next) => {
      setManualRatio(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch (error) {
        console.warn("Sidebar width preference could not be saved:", error);
      }
    };
    const move = (event) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.pointerId || !(width > 0)) return;
      setManualRatio(
        measureWidth(
          width,
          (start.width + start.x - event.clientX) / width,
          minWidth,
        ) / width,
      );
    };
    const end = (event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      persist(localWidth / Math.max(1, width));
    };
    const style =
      fullscreen && expanded
        ? { position: "absolute", inset: 0, zIndex: 30, width: "100%" }
        : {
            position: "relative",
            width: expanded ? localWidth : 0,
            flex: "none",
          };
    return jsx.jsxs("div", {
      className: "dsh-multi-sidebar-host",
      "data-multi-sidebar-pane": paneId,
      "data-multi-sidebar-visible": visible || undefined,
      "data-multi-sidebar-dragging": dragging || undefined,
      hidden: !visible,
      style: { ...style, height: "100%", minWidth: 0, overflow: "hidden" },
      children: [
        jsx.jsx(RightbarSeat, {
          ...props,
          width: fullscreen ? width : localWidth,
          viewportWidth: width,
          active: visible,
          canShow: true,
          retainTab: props.retainTab ?? (() => () => {}),
        }),
        expanded &&
          !fullscreen &&
          jsx.jsx("div", {
            role: "separator",
            tabIndex: 0,
            "aria-label": "Resize right sidebar",
            "aria-orientation": "vertical",
            "aria-valuemin": Math.round(measureWidth(width, 0, minWidth)),
            "aria-valuemax": Math.round(width * 0.75),
            "aria-valuenow": Math.round(localWidth),
            className: "dsh-multi-sidebar-resizer",
            onPointerDown: (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                width: localWidth,
              };
              setDragging(true);
            },
            onPointerMove: move,
            onPointerUp: end,
            onPointerCancel: end,
            onLostPointerCapture: () => {
              drag.current = null;
              setDragging(false);
            },
            onKeyDown: (event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 16 : -16;
              persist(
                measureWidth(
                  width,
                  (localWidth + delta) / Math.max(1, width),
                  minWidth,
                ) / Math.max(1, width),
              );
            },
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 6,
              zIndex: 100,
              cursor: "col-resize",
              touchAction: "none",
            },
          }),
      ],
    });
  };
}
