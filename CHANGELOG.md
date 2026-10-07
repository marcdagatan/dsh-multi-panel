# Changelog

## Unreleased

- Double-click a divider to equalize the panes in its row or column.

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
