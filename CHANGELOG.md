# Changelog

## Unreleased

## 0.2.11 — Local activation candidate

- Fix the chat box showing its placeholder over typed text. A chat open in
  two workspace tabs mounted two composers, and only one could receive
  typing. A chat now lives in one tab at a time: showing it in a tab
  removes it from the others (their pane stays, empty), and on restart the
  active tab keeps any chat saved in more than one tab.

## 0.2.10 — Local activation candidate

- Rename a workspace tab by double-clicking it. Enter or clicking away saves,
  Escape cancels, and clearing the name returns to the focused chat's title.
  Names are saved with the tabs and restored on restart.

## 0.2.9 — Local activation candidate

- Keep a chat's browser alive when you switch that pane to another chat. A
  chat whose sidebar has a browser or terminal tab now stays loaded, hidden
  behind its pane, so returning to it no longer reloads the page. Closing the
  pane or its last browser/terminal tab releases it; reopening it in a
  different pane still reloads.

## 0.2.8 — Local activation candidate

- Double-click a divider to equalize the panes in its row or column.
- Add workspace tabs above the panes: each tab holds its own pane layout, and
  **+** opens a fresh blank workspace.
- Keep every tab mounted and its chats retained while switching, so background
  chats keep streaming and keep their drafts.
- Show a pulsing dot on tabs with running chats and a pane count for split tabs.
- Remember tabs and each tab's layout in this browser; the first tab keeps the
  existing saved layout.
- Add four unbound tab shortcuts: new, next, previous and close tab.
- Known limitation: duplicate existing-chat selection across workspace tabs is
  not prevented. Keep each chat in only one workspace tab.
- Support DSH 0.2.0-rc.2 only; this is a local candidate, not a public release.

## 0.2.7 — Public-release preparation

- Prepare a standalone source repository and reproducible build instructions.
- Separate authored code licensing from bundled third-party notices.
- Exclude local runtime extraction, generated files and personal QA artifacts from Git.
- Verify build, tests and formatting before packaging.
- No changes to the installed 0.2.6 pane behavior.

## 0.2.6

- Restore native agent selection by declaring native slots before controller activation.
- Keep each focused blank chat's agent selection independent.
- Preserve the native Developer tools gate and started-chat restrictions.

## 0.2.5

- Fix cross-pane file-drag event ordering and recover feedback on ongoing dragover.
- Verify file intake remains limited to the target pane without moving keyboard focus.

## 0.2.4

- Remove file-drop borders; retain the light tint and localized drop message.

## 0.2.0–0.2.3

- Add profile-wide multi-panel preferences and configurable pane shortcuts.
- Preserve native composer, attachment and sidebar behavior in independently bound panes.
- Add pane-targeted file intake and drag feedback.

## 0.1.x

- Introduce nested horizontal/vertical chat splits and independent docked sidebar splits.
- Keep panes mounted through moves, resizing and maximize/restore.
