import React from "react";
import { PREFERENCE_FIELDS } from "./preferences.mjs";

const h = React.createElement;

function NumberSetting({ field, value, save, ...common }) {
  const [draft, setDraft] = React.useState(String(value));
  const cancelled = React.useRef(false);
  React.useEffect(() => setDraft(String(value)), [value]);
  return h("input", {
    ...common,
    type: "number",
    value: draft,
    min: field.min,
    max: field.max,
    step: field.step,
    onChange: (event) => setDraft(event.target.value),
    onBlur: (event) => {
      if (
        !cancelled.current &&
        event.target.value !== "" &&
        event.target.validity.valid &&
        event.target.valueAsNumber !== value
      )
        save(field, event.target.valueAsNumber);
      else setDraft(String(value));
      cancelled.current = false;
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      cancelled.current = event.key === "Escape";
      event.currentTarget.blur();
    },
  });
}

function SettingField({ field, value, disabled, save }) {
  const id = `dshMulti-setting-${field.key}`;
  const common = {
    id,
    disabled,
    "aria-describedby": field.hint ? `${id}-hint` : undefined,
  };
  const input =
    field.type === "boolean"
      ? h("input", {
          ...common,
          type: "checkbox",
          checked: value,
          onChange: (event) => save(field, event.target.checked),
        })
      : field.type === "select"
        ? h(
            "select",
            {
              ...common,
              value,
              onChange: (event) => save(field, event.target.value),
            },
            Object.entries(field.choices).map(([key, label]) =>
              h("option", { key, value: key }, label),
            ),
          )
        : field.type === "color"
          ? h("input", {
              ...common,
              type: "color",
              value,
              onChange: (event) => save(field, event.target.value),
            })
          : h(NumberSetting, { ...common, field, value, save });
  return h(
    "div",
    { className: "dshMulti-setting" },
    h(
      "div",
      null,
      h("label", { htmlFor: id }, field.label),
      field.hint && h("p", { id: `${id}-hint` }, field.hint),
    ),
    input,
  );
}

/** Feature-owned page on the native Settings section list; writes use the shared Host form. */
export function MultiPanelSettings({ preferencesSource }) {
  const values = React.useSyncExternalStore(
    preferencesSource.subscribe,
    preferencesSource.getSnapshot,
    preferencesSource.getSnapshot,
  );
  const form = preferencesSource.form;
  const subscribeForm = React.useCallback(
    (listener) => form.subscribe(listener),
    [form],
  );
  const getForm = React.useCallback(() => form.getSnapshot(), [form]);
  const snapshot = React.useSyncExternalStore(subscribeForm, getForm, getForm);
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const disabled = pending || snapshot.status !== "ready" || !snapshot.writable;
  async function write(operation) {
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      if (!(await operation()))
        throw new Error(
          "Settings could not be saved. The previous value was restored; try again.",
        );
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const save = (field, value) => write(() => form.set(field.key, value));
  function fields(advanced) {
    return [
      ...new Set(
        PREFERENCE_FIELDS.filter((field) => !!field.advanced === advanced).map(
          (field) => field.group,
        ),
      ),
    ].map((group) =>
      h(
        "fieldset",
        { key: group },
        h("legend", null, group),
        PREFERENCE_FIELDS.filter(
          (field) => field.group === group && !!field.advanced === advanced,
        ).map((field) =>
          h(SettingField, {
            key: field.key,
            field,
            value: values[field.key],
            disabled,
            save,
          }),
        ),
      ),
    );
  }
  return h(
    "div",
    { className: "dshMulti-settings", "data-multi-panel-settings": "" },
    h("h2", null, "Multi-panel"),
    h(
      "p",
      { className: "dshMulti-settingsIntro" },
      "Settings apply live to open panes. Startup restoration applies on the next page load. Chats, drafts and sidebar tabs stay independent.",
    ),
    snapshot.status !== "ready" || !snapshot.writable
      ? h(
          "p",
          { role: "status" },
          snapshot.status === "loading"
            ? "Loading settings…"
            : "Settings are read-only in this connection.",
        )
      : null,
    error &&
      h("p", { role: "alert", className: "dshMulti-settingsError" }, error),
    fields(false),
    h(
      "fieldset",
      null,
      h("legend", null, "Pane shortcuts"),
      h(
        "p",
        null,
        "Open General → Edit shortcuts and search “Multi-panel” to assign split, focus, maximize, close and Undo shortcuts. They are unbound by default so existing shortcuts do not change.",
      ),
    ),
    h(
      "details",
      { className: "dshMulti-advanced" },
      h("summary", null, "Advanced"),
      fields(true),
    ),
    h(
      "button",
      {
        type: "button",
        disabled,
        className: "dshMulti-resetSettings",
        onClick: () =>
          write(() =>
            form.mutate(
              PREFERENCE_FIELDS.map((field) => ({
                op: "unset",
                path: [field.key],
              })),
            ),
          ),
      },
      "Reset multi-panel settings",
    ),
    h(
      "span",
      { role: "status", className: "dshMulti-saveStatus" },
      pending ? "Saving…" : "",
    ),
  );
}

/** A dedicated section avoids a long list of unrelated rows on General. */
export function registerMultiPanelSettings(ctx, preferencesSource) {
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "multi-panel-settings",
        label: "Multi-panel",
        order: 35,
        inject: () => ({ preferencesSource }),
      },
      MultiPanelSettings,
    ),
  );
}
