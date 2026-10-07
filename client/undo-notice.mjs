import React from "react";
const h = React.createElement;

/** Keyed per undo/duration: focus and layout resize must not restart the countdown. */
export function UndoNotice({ undo, workspace, preferences }) {
  const duration = preferences.undoDuration * 1000;
  const remaining = React.useRef(duration);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const paused = preferences.pauseUndoOnHover && (hovered || focused);
  React.useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(
      () => workspace.dismissUndo(undo),
      remaining.current,
    );
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [workspace, undo, duration, paused]);
  return h(
    "button",
    {
      type: "button",
      className: "dshMulti-undo",
      "data-position": preferences.undoPosition,
      style: {
        "--dshMulti-undo-duration": `${duration}ms`,
        "--dshMulti-undo-play-state": paused ? "paused" : "running",
      },
      onClick: workspace.undo,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    "Undo layout change",
    preferences.undoProgress &&
      h("span", { className: "dshMulti-undoCountdown", "aria-hidden": true }),
  );
}
