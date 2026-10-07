"""Compose the reviewed documentation crops, GIF previews and silent MP4s.

Requires Pillow and a compiled readme-media.swift helper. Input folders contain
only the reviewed crops, not the private full-desktop recordings. See
../docs/media/README.md for extraction commands and the editorial cut list.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

FPS = 10
BACKGROUND = "#0b1017"
FRAME = "#253248"
ACCENT = "#83b6ff"
TEXT = "#f3f6fb"
MUTED = "#a8b7ca"
ROOT = Path(__file__).resolve().parents[1]


def font(size):
    return ImageFont.load_default(size=size)


def load_frames(folder, expected_count):
    paths = sorted(folder.glob("frame-*.png"))
    if len(paths) != expected_count:
        raise ValueError(f"{folder.name}: expected {expected_count} reviewed frames")
    return [Image.open(path).convert("RGB") for path in paths]


def card(image, title, subtitle, footer, width, image_width):
    """Frame real UI without inventing controls or changing its state."""
    image_height = round(image.height * image_width / image.width)
    height = 124 + image_height + 62
    height += height % 2
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((24, 22, 184, 45), radius=11, fill="#1d2d45")
    draw.text((36, 25), "DSH MULTI-PANEL", font=font(14), fill=ACCENT)
    draw.text((24, 55), title, font=font(30), fill=TEXT)
    draw.text((24, 91), subtitle, font=font(16), fill=MUTED)
    resized = image.resize((image_width, image_height), Image.Resampling.LANCZOS)
    mask = Image.new("L", resized.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image_width - 1, image_height - 1), radius=14, fill=255)
    x = (width - image_width) // 2
    canvas.paste(resized, (x, 124), mask)
    draw.rounded_rectangle((x, 124, x + image_width - 1, 124 + image_height - 1), radius=14, outline=FRAME, width=1)
    draw.text((24, 124 + image_height + 22), footer, font=font(15), fill=MUTED)
    return canvas


def save_clip(frames, name, poster_index, output, work, helper):
    # Hold the first/last states briefly, rather than repeating idle footage.
    held = [frames[0]] * 8 + frames + [frames[-1]] * 12
    poster = frames[poster_index]
    poster.save(output / f"{name}.png", optimize=True)
    palette = poster.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    gif_frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in held]
    gif_frames[0].save(
        output / f"{name}.gif", save_all=True, append_images=gif_frames[1:],
        duration=100, loop=0, optimize=True, disposal=1,
    )
    folder = work / name
    folder.mkdir(parents=True, exist_ok=False)
    for index, frame in enumerate(held):
        frame.save(folder / f"frame-{index:05d}.png", optimize=True)
    subprocess.run([str(helper), "encode", str(folder), str(output / f"{name}.mp4"), str(FPS)], check=True)
    return {"fps": FPS, "frames": len(held), "duration_seconds": len(held) / FPS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--helper", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True, help="new directory for composed intermediate frames")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/media")
    args = parser.parse_args()
    helper = args.helper.resolve(strict=True)
    work = args.work.resolve()
    output = args.output.resolve()
    names = ["split-panes.png", "split-panes.gif", "split-panes.mp4", "settings.png", "settings.gif", "settings.mp4", "settings-advanced.png", "manifest.json"]
    if any((output / name).exists() for name in names):
        raise ValueError("Output already exists; inspect and explicitly choose a fresh output directory")
    args.work.mkdir(parents=True, exist_ok=False)
    output.mkdir(parents=True, exist_ok=True)
    split = load_frames(args.frames / "split-menu", 20) + load_frames(args.frames / "split-resize", 30)
    settings = load_frames(args.frames / "settings-crop", 94)
    if any(frame.size != (1183, 699) for frame in split) or any(frame.size != (790, 777) for frame in settings):
        raise ValueError("Crop dimensions differ from the reviewed source recordings")
    split_cards = [card(image.crop((0, 0, image.width, 540)), "Split. Resize. Keep your flow.", "Native chat panes, each with its own composer.", "Direction menu / two chats / divider resize  ·  Edited desktop recording", 1080, 1032) for image in split]
    settings_cards = [card(image, "Make the layout yours.", "25 preferences, in DSH's native settings.", "Appearance · undo · splitting · sidebars  ·  Edited desktop recording", 860, 812) for image in settings]
    specs = {
        "split-panes": save_clip(split_cards, "split-panes", -1, output, work, helper),
        "settings": save_clip(settings_cards, "settings", 0, output, work, helper),
    }
    settings_cards[60].save(output / "settings-advanced.png", optimize=True)
    manifest = {
        "source_recordings_committed": False,
        "reference_viewport_width": 1920,
        "cuts": {
            "split-panes": {"recording": "A", "seconds": [[28, 30], [32, 35]], "crop_xywh": [1260, 412, 660, 390]},
            "settings": {"recording": "B", "seconds": [[6, 15.4]], "crop_xywh": [740, 195, 440, 433]},
        },
        "privacy": "Only blank chat panes and the settings window; other conversations, sidebar lists, customer dashboard and chat picker excluded. Rounded crop corners are masked. No audio or original recording metadata copied.",
        "clips": specs,
        "files": {},
    }
    for name in names[:-1]:
        file = output / name
        manifest["files"][name] = {"bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["files"], indent=2))


if __name__ == "__main__":
    main()
