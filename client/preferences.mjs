/** Settings are profile-wide; pane layouts and manual sidebar widths stay browser/session-local. */
export const PREFERENCE_FIELDS = [
  {
    key: "focusHighlight",
    label: "Highlight the focused pane",
    type: "boolean",
    default: false,
    group: "Appearance",
  },
  {
    key: "undoDuration",
    label: "Undo notice duration (seconds)",
    type: "number",
    min: 1,
    max: 30,
    step: 1,
    default: 3,
    group: "Undo",
  },
  {
    key: "undoProgress",
    label: "Show the shrinking countdown bar",
    type: "boolean",
    default: true,
    group: "Undo",
  },
  {
    key: "splitDirection",
    label: "Default split direction",
    type: "select",
    choices: { right: "Right", bottom: "Below", left: "Left", top: "Above" },
    default: "right",
    group: "Splitting",
  },
  {
    key: "splitRatio",
    label: "New chat pane's share",
    type: "number",
    min: 0.15,
    max: 0.85,
    step: 0.05,
    default: 0.5,
    group: "Splitting",
    hint: "New pane's share: 0.5 is 50/50. Applies to new splits only.",
  },
  {
    key: "minPaneWidth",
    label: "Minimum chat pane width (px)",
    type: "number",
    min: 0,
    max: 1200,
    step: 1,
    default: 0,
    group: "Splitting",
    hint: "0 keeps flexible sizing. Existing chats remain mounted when the window shrinks.",
  },
  {
    key: "minPaneHeight",
    label: "Minimum chat pane height (px)",
    type: "number",
    min: 0,
    max: 1200,
    step: 1,
    default: 0,
    group: "Splitting",
    hint: "0 keeps flexible sizing.",
  },
  {
    key: "sidebarWidth",
    label: "Default sidebar width",
    type: "number",
    min: 0.15,
    max: 0.75,
    step: 0.05,
    default: 0.4,
    group: "Sidebars",
    hint: "Share of the chat pane: 0.4 is 40%. Manually resized sidebars keep their saved width.",
  },
  {
    key: "restoreLayout",
    label: "Restore the last chat layout on startup",
    type: "boolean",
    default: true,
    group: "Startup",
    hint: "Changes apply on the next page load; no chats or drafts are deleted.",
  },
  {
    key: "focusColor",
    label: "Focus highlight color",
    type: "color",
    default: "#4f8cff",
    group: "Appearance",
    advanced: true,
  },
  {
    key: "focusWidth",
    label: "Focus border thickness (px)",
    type: "number",
    min: 1,
    max: 4,
    step: 1,
    default: 1,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "paneBorders",
    label: "Show neutral pane borders",
    type: "boolean",
    default: true,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "inactiveOpacity",
    label: "Inactive pane opacity",
    type: "number",
    min: 0.4,
    max: 1,
    step: 0.05,
    default: 1,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "dividerWidth",
    label: "Divider hit area (px)",
    type: "number",
    min: 4,
    max: 16,
    step: 1,
    default: 8,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "compactToolbar",
    label: "Compact pane toolbar",
    type: "boolean",
    default: false,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "showPaneTitles",
    label: "Show chat titles in pane toolbars",
    type: "boolean",
    default: true,
    group: "Appearance",
    advanced: true,
  },
  {
    key: "undoEnabled",
    label: "Show Undo layout notices",
    type: "boolean",
    default: true,
    group: "Undo",
    advanced: true,
  },
  {
    key: "undoPosition",
    label: "Undo notice position",
    type: "select",
    choices: {
      center: "Bottom center",
      left: "Bottom left",
      right: "Bottom right",
    },
    default: "center",
    group: "Undo",
    advanced: true,
  },
  {
    key: "pauseUndoOnHover",
    label: "Pause Undo while hovered or keyboard-focused",
    type: "boolean",
    default: false,
    group: "Undo",
    advanced: true,
  },
  {
    key: "maxPanes",
    label: "Maximum chat panes",
    type: "number",
    min: 1,
    max: 64,
    step: 1,
    default: 64,
    group: "Splitting",
    advanced: true,
    hint: "Lowering the limit never closes existing panes.",
  },
  {
    key: "focusNewPane",
    label: "Focus newly split chat panes",
    type: "boolean",
    default: true,
    group: "Splitting",
    advanced: true,
  },
  {
    key: "sidebarMinWidth",
    label: "Minimum sidebar width (px)",
    type: "number",
    min: 0,
    max: 600,
    step: 1,
    default: 320,
    group: "Sidebars",
    advanced: true,
    hint: "Clipped to the chat pane's available width.",
  },
  {
    key: "sidebarSplitDirection",
    label: "Default sidebar split direction",
    type: "select",
    choices: { right: "Right", bottom: "Below", left: "Left", top: "Above" },
    default: "right",
    group: "Sidebars",
    advanced: true,
  },
  {
    key: "sidebarSplitRatio",
    label: "New sidebar pane's share",
    type: "number",
    min: 0.15,
    max: 0.85,
    step: 0.05,
    default: 0.5,
    group: "Sidebars",
    advanced: true,
  },
  {
    key: "sidebarMaxPanes",
    label: "Maximum sidebar panes per chat",
    type: "number",
    min: 1,
    max: 16,
    step: 1,
    default: 16,
    group: "Sidebars",
    advanced: true,
  },
];

export const DEFAULT_PREFERENCES = Object.freeze(
  Object.fromEntries(
    PREFERENCE_FIELDS.map((field) => [field.key, field.default]),
  ),
);

/** Decode only known safe values; invalid/omitted fields retain their established defaults. */
export function normalizePreferences(input) {
  const values =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(
    PREFERENCE_FIELDS.map((field) => {
      const value = Object.hasOwn(values, field.key)
        ? values[field.key]
        : undefined;
      const valid =
        field.type === "boolean"
          ? typeof value === "boolean"
          : field.type === "select"
            ? typeof value === "string" && Object.hasOwn(field.choices, value)
            : field.type === "color"
              ? typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
              : typeof value === "number" &&
                Number.isFinite(value) &&
                value >= field.min &&
                value <= field.max &&
                (field.step !== 1 || Number.isInteger(value));
      return [field.key, valid ? value : field.default];
    }),
  );
}

/** Shared metadata drives both Host validation and the native settings page. */
export function preferenceSchemaFields(Schema) {
  return Object.fromEntries(
    PREFERENCE_FIELDS.map((field) => {
      let node;
      if (field.type === "boolean") node = Schema.boolean();
      else if (field.type === "select")
        node = Schema.union(Object.keys(field.choices));
      else if (field.type === "color")
        node = Schema.string().pattern(/^#[0-9a-f]{6}$/i);
      else
        node = (field.step === 1 ? Schema.natural() : Schema.number())
          .min(field.min)
          .max(field.max);
      return [
        field.key,
        node.default(field.default).description(field.label).volatile(),
      ];
    }),
  );
}

/** Wait for persisted startup preferences before deciding whether to restore a layout. */
export function whenPreferencesReady(source, start) {
  let started = false;
  let disposed = false;
  const check = () => {
    if (disposed || started || source.form.getSnapshot().status === "loading")
      return;
    started = true;
    start();
  };
  const off = source.subscribe(check);
  check();
  return () => {
    disposed = true;
    off();
  };
}

/** Cache decoded snapshots for React; shared ConfigForms owns writes and their revision fences. */
export function createPreferencesSource(form) {
  let previous;
  let decoded = DEFAULT_PREFERENCES;
  return {
    form,
    subscribe: (listener) => form.subscribe(listener),
    getSnapshot() {
      const value = form.getSnapshot().value;
      if (value !== previous) {
        previous = value;
        decoded = Object.freeze(normalizePreferences(value));
      }
      return decoded;
    },
  };
}
