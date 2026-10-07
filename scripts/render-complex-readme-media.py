"""Local review-only full-workspace redaction for recording A, 43–57 seconds.

Fail closed: start opaque, restore only inspected native chrome and blank chats.
Private chat bodies and docked browser page are never copied into the output.
Pre-commit geometry uses inspected keyframes; later divider geometry is measured
on every frame. This helper accepts only the reviewed recording dimensions/cut.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1920, 804
BACKGROUND = '#0c1118'
COVER = '#171e28'
TEXT = '#93a2b5'


def font(size):
    return ImageFont.load_default(size=size)


def runs(bits):
    indices = np.flatnonzero(np.diff(np.r_[False, bits, False]))
    return [(int(a), int(b)) for a, b in zip(indices[::2], indices[1::2])]


def headers(array, x):
    # Empty padding at the left of real tab bars has a distinct gray value.
    values = np.median(array[:, x:x + 3], axis=1)
    gray = (values.min(axis=1) >= 27) & (values.max(axis=1) <= 39)
    bands = [(a, b) for a, b in runs(gray) if b - a >= 9 and a >= 17]
    # Only this reviewed interval: real lower title bars are below y=300.
    # The MCP settings card also has gray body blocks near y=150 and y=180.
    return [17] + [a - 2 for a, _ in bands if a > 300]


def compose(path, seconds):
    source = Image.open(path)
    if source.size != (3440, 1440) or not 43 <= seconds < 57:
        raise ValueError('Only the inspected 3440×1440 recording A, 43–57s, is supported')
    raw = source.convert('RGB').resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    array = np.array(raw)
    candidates = sorted(set(headers(array, 1190) + headers(array, 160)))
    left_headers = []
    for candidate in candidates:
        if not left_headers or candidate - left_headers[-1] > 8:
            left_headers.append(candidate)
    # Reviewed keyframe: the native commit first appears at A51.125s.
    # Before that, drag tint can hide both header probes; it must never be
    # mistaken for a committed layout. All three native rows remain in place.
    if seconds < 51.125:
        left_headers = [17, 381, 593]
    if len(left_headers) not in (2, 3) or abs(left_headers[0] - 17) > 3:
        raise ValueError(f'Unreviewed left pane geometry at {seconds}: {left_headers}')
    split = seconds >= 51.125
    if split and len(left_headers) != 2:
        raise ValueError(f'Unreviewed committed geometry at {seconds}: {left_headers}')
    out = Image.new('RGB', raw.size, COVER)
    draw = ImageDraw.Draw(out)

    def restore(box):
        out.paste(raw.crop(box), box[:2])

    def cover(box, color=COVER):
        draw.rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=color)

    def label(box, text):
        x0, y0, x1, y1 = box
        draw.text(((x0 + x1) / 2, (y0 + y1) / 2), text, font=font(15), fill=TEXT, anchor='mm')

    # Keep native app identity; hide macOS status/date and workspace/session list.
    restore((0, 0, 210, 17))
    restore((0, 17, 157, 146))
    restore((0, 768, 157, 804))
    restore((0, 146, 8, 768))
    restore((153, 146, 157, 768))
    label((8, 146, 153, 768), 'Private list hidden')
    restore((156, 17, 160, 804))
    restore((1255, 17, 1261, 804))

    panes = []
    def chat(x0, y0, x1, y1):
        # Native draggable title bar, actions and Chat/Trajectory/Usage/MCPs tabs.
        restore((x0, y0, x1, min(y0 + 57, y1)))
        cover((x0 + 14, y0 + 3, x1 - 65, y0 + 18), '#202220')
        cover((x0 + 8, y0 + 22, x1 - 77, y0 + 42), '#141414')
        restore((x0, y1 - 3, x1, y1))
        restore((x0, y0, x0 + 3, y1))
        restore((x1 - 3, y0, x1, y1))
        # The actual empty native composer is ~377px wide and bottom anchored
        # throughout this reviewed cut. Copy its inspected 380×55px envelope.
        # Measuring color fails while the real drag-preview tint covers it;
        # using the measured pane center/bottom keeps the whole source shape.
        # This restores pixels, not a drawn/fabricated composer. Goals/task rows
        # above and token/session statistics below remain opaque.
        center = (x0 + x1) // 2
        restore((center - 190, y1 - 72, center + 190, y1 - 17))
        label((x0 + 4, y0 + 65, x1 - 4, y1 - 65), 'Private chat content hidden')
        panes.append({'type': 'chat', 'bounds': [x0, y0, x1, y1]})

    y = left_headers[1]
    if split:
        chat(158, 17, 707, y)
        chat(708, 17, 1257, y)
        restore((705, 17, 711, y))
        chat(158, y, 712, 804)
    else:
        chat(158, 17, 1257, y)
        chat(158, y, 712, left_headers[2])
        chat(158, left_headers[2], 1257, 804)
    chat(1259, 17, 1920, 410)

    browser_end = 804 if split else left_headers[2]
    # Native browser toolbar and dock boundary; title and address are opaque.
    restore((712, y, 1257, y + 19))
    cover((712, y + 3, 1192, y + 18), '#202220')
    restore((712, y + 19, 1257, y + 61))
    cover((727, y + 21, 779, y + 38), '#282828')
    cover((802, y + 41, 1239, y + 59), '#282828')
    restore((709, y + 19, 715, browser_end))
    restore((712, browser_end - 3, 1257, browser_end))
    cover((715, y + 62, 1254, browser_end - 3), '#111c29')
    label((715, y + 62, 1254, browser_end - 3), 'Private browser page hidden')
    panes.append({'type': 'native-docked-browser', 'bounds': [712, y + 19, 1257, browser_end]})

    # These two actual native New Chat panes are empty throughout the chosen cut.
    restore((1259, 410, 1920, 804))
    panes.extend([{'type': 'blank-chat', 'bounds': [1259, 410, 1591, 804]},
                  {'type': 'blank-chat', 'bounds': [1592, 410, 1920, 804]}])

    # Retain real drag-preview boundary pixels, not translucent private interiors.
    preview_lines = []
    if not split:
        for yy in range(80, 802):
            row = array[yy, 159:1257].astype(int)
            bright = (row.min(axis=1) > 145) & (row.max(axis=1) - row.min(axis=1) < 15)
            spans = [(a, b) for a, b in runs(bright) if b - a > 350]
            for a, b in spans:
                restore((a + 159, yy, b + 159, yy + 1))
                preview_lines.append([a + 159, yy, b + 159])
        # A continuous vertical preview boundary is also safe, unlike body text.
        for xx in range(160, 1255):
            col = array[19:802, xx].astype(int)
            bright = (col.min(axis=1) > 145) & (col.max(axis=1) - col.min(axis=1) < 15)
            for a, b in runs(bright):
                if b - a > 130:
                    restore((xx, a + 19, xx + 1, b + 19))

    canvas = Image.new('RGB', (1920, 916), BACKGROUND)
    canvas.paste(out, (0, 68))
    d = ImageDraw.Draw(canvas)
    d.text((24, 15), 'Real workspace. Nested panes. Native browser.', font=font(29), fill='#f0f5fc')
    d.text((24, 877), 'Edited recording · Opaque editorial privacy covers · Native pane geometry and controls retained', font=font(18), fill='#a8b7ca')
    return canvas, {'source_seconds': seconds, 'left_header_y': left_headers,
                    'chat_count': 6, 'browser_count': 1, 'panes': panes,
                    'drag_preview_horizontal_lines': preview_lines}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--start', type=float, default=43)
    p.add_argument('--fps', type=float, default=1)
    args = p.parse_args()
    cache = Path(__file__).resolve().parents[1] / '.cache' / 'readme-complex'
    paths = sorted(args.source.glob('frame-*.png'))
    if not args.output.resolve().is_relative_to(cache.resolve()):
        raise ValueError('Review outputs must stay under .cache/readme-complex')
    if not paths or args.fps <= 0 or args.start < 43 or args.start + len(paths) / args.fps > 57:
        raise ValueError('The selected frames must remain within the inspected 43–57s cut')
    args.output.mkdir(parents=True, exist_ok=False)
    geometry = []
    for i, path in enumerate(paths):
        frame, info = compose(path, args.start + i / args.fps)
        frame.save(args.output / path.name)
        geometry.append(info)
    (args.output / 'geometry.json').write_text(json.dumps(geometry, indent=2) + '\n')
    print(f'Redacted {len(geometry)} full-workspace frames')


if __name__ == '__main__':
    main()
