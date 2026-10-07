# README Media

These assets are excerpts from real DSH desktop recordings, not generated UI mockups. The main demos retain the entire workspace and its actual nested pane geometry. Opaque editorial covers hide private content; they are not replacement chats or fabricated UI. The basic split and settings demos use tighter crops.

## What the Clips Show

| Asset                                                                 | Visible actions                                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Complex layouts](complex-layouts.mp4) / [GIF](complex-layouts.gif)   | Six native chat panes, a browser dock inside a chat, edge-drop previews, pane rearrangement and divider resizing. |
| [Rearrange panes](rearrange-panes.mp4) / [GIF](rearrange-panes.gif)   | The focused edge-drag and pane-reflow sequence, keeping the full workspace visible.                               |
| [Split panes](split-panes.mp4) / [GIF](split-panes.gif)               | Open the direction menu, cut to two blank native chats, resize their divider.                                     |
| [Settings](settings.mp4) / [GIF](settings.gif)                        | Browse the Multi-panel settings and scroll into Advanced.                                                         |
| [Split snapshot](split-panes.png)                                     | Two blank native chat panes, each with a composer.                                                                |
| [Settings overview](settings.png) / [Advanced](settings-advanced.png) | Actual native preference controls.                                                                                |

These clips do **not** demonstrate every feature. File intake, independent agent-mode selection, maximize/restore, close/Undo, shortcuts and restoration after restart need additional footage. Use the [Codex capture prompt](../capture-prompt.md) for those scenes.

## Editing and Privacy

The full-workspace clips keep the real pane positions, nesting, docked browser region and divider motion. Private messages, task/goal rows, session/workspace lists, chat titles, local paths, browser tab/address/page content and the desktop status area are covered with opaque masks. Empty native composers and blank-chat bodies remain visible where safe. Drag-preview outlines remain visible; private preview text is covered. The browser's page is hidden throughout, so these clips demonstrate its docked geometry, not page interaction or uninterrupted guest rendering.

The basic split and settings crops exclude unrelated content. The basic chat-picker interval is removed, not blurred. Rounded crop corners are masked against an opaque background. MP4s contain no audio track and do not copy original recording metadata.

Source videos and raw/intermediate frames remain local under the ignored cache or their original location. Do not copy full recordings into this public directory. Review **every frame** before adding or replacing media.

The [manifest](manifest.json) records cuts, dimensions, durations and asset hashes. The split clip contains an explicit jump cut between choosing the direction and the resulting two panes; it is not evidence of the hidden picker interaction. Opening/ending states are briefly held for readability.

## Regeneration

The renderers are documentation tooling only, not plugin runtime dependencies or build prerequisites. Requirements: macOS 13+, Xcode Command Line Tools (Swift/AVFoundation), Python 3 and Pillow; the full-workspace redactor also needs NumPy.

### Full-Workspace Redaction

The [full-workspace renderer](../../scripts/render-complex-readme-media.py) is intentionally limited to the reviewed recording A, dimensions and 43–57-second interval. It starts with opaque covers and restores inspected native chrome, empty composers and blank chats. It is not a general-purpose anonymizer. Do not apply its geometry assumptions to other footage without a new review.

```sh
mkdir -p .cache/readme-complex/regenerate/swift-cache
swiftc -parse-as-library \
  -module-cache-path .cache/readme-complex/regenerate/swift-cache \
  scripts/readme-media.swift -o .cache/readme-complex/regenerate/media

.cache/readme-complex/regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-complex/regenerate/source 8 43 57 0,0,3440,1440 3440

python3 scripts/render-complex-readme-media.py \
  --source .cache/readme-complex/regenerate/source \
  --output .cache/readme-complex/regenerate/redacted --start 43 --fps 8
```

The result is 112 redacted PNG frames plus geometry metadata, kept in the ignored review cache. Assemble the complex clip from all 112 frames; the rearrangement excerpt uses frames 40–87 (A48–54). Repeat each excerpt's first and last frame eight times for one-second holds, then encode at 8 fps with the native helper. The resulting MP4 lengths are 16 and 8 seconds. GIF previews are resized to 1280×611 with alternating 120/130 ms delays to preserve those exact clocks. Review every frame and all recognized text before copying exports into this directory; a scan for known private labels alone can miss a transient leak.

### Basic Split and Settings

The recipes match the two reviewed **3440×1440** source recordings. Crop coordinates use the initial 1920-pixel-wide review viewport and are scaled to full source resolution. Do not reuse them on different footage without inspecting and updating the crops.

From the plugin repository root, substitute the two private recording paths locally:

```sh
mkdir -p .cache/readme-regenerate/swift-cache
swiftc -parse-as-library \
  -module-cache-path .cache/readme-regenerate/swift-cache \
  scripts/readme-media.swift -o .cache/readme-regenerate/media

.cache/readme-regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-regenerate/split-menu 10 28 30 1260,412,660,390 1920
.cache/readme-regenerate/media extract "RECORDING_A.mov" \
  .cache/readme-regenerate/split-resize 10 32 35 1260,412,660,390 1920
.cache/readme-regenerate/media extract "RECORDING_B.mov" \
  .cache/readme-regenerate/settings-crop 10 6 15.4 740,195,440,433 1920

python3 scripts/render-readme-media.py \
  --frames .cache/readme-regenerate \
  --helper .cache/readme-regenerate/media \
  --work .cache/readme-regenerate/composed \
  --output .cache/readme-regenerate/review-output
```

The tools refuse to replace existing frames/videos. Choose fresh intermediate/output directories for another render. Review outputs before copying approved assets into this directory. The split card also crops unused blank space below the composers; the settings card retains the full reviewed settings crop.

The static [badge row](badges.svg) is source SVG, not a live npm or CI status badge. No package/repository publication is implied.
