"""Extract selected installed UI contracts without changing existing evidence."""

import argparse
import json
import pathlib
import struct


DEFAULT_ASAR = pathlib.Path(
    "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
)
DEFAULT_OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "runtime-evidence"
API_PACKAGES = (
    "dsh-api-workspace-controller",
    "dsh-api-session-controller",
    "dsh-api-remotes",
    "dsh-web-app",
    "dsh-cordis-client-runner",
    "dsh-plugin-manager",
    "cordis",
    "cosmokit",
)


def selected(path):
    """Keep pinned runtime artifacts and their package/license provenance."""
    full = "/".join(path)
    name = path[-1]
    ui = "/@deepseek-ai/dsh-client-" in "/" + full
    api = any(
        "/@deepseek-ai/" + package + "/" in "/" + full
        for package in API_PACKAGES
    )
    guide = name == "AGENTS.md" or full in ("dsh/package.json", "dsh/cordis.yml")
    shell = full in (
        "dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js",
        "dsh/node_modules/@deepseek-ai/dsh-web-frontend/package.json",
        "dsh/node_modules/@deepseek-ai/dsh-web-frontend/LICENSE",
    )
    supported = name == "LICENSE" or name.endswith(
        (".js", ".json", ".md", ".yml", ".yaml", ".d.ts")
    )
    return (ui or api or guide or shell) and supported


def entries(tree, parts=()):
    """Walk the ASAR file map and reject invalid path components."""
    if not isinstance(tree, dict) or not isinstance(tree.get("files"), dict):
        raise ValueError("Invalid ASAR file map")
    for name, entry in tree["files"].items():
        if (
            not name
            or name in (".", "..")
            or any(character in name for character in ("/", "\\", "\0", ":"))
            or not isinstance(entry, dict)
        ):
            raise ValueError(f"Invalid ASAR entry: {name!r}")
        path = parts + (name,)
        if "link" in entry:
            continue
        if "files" in entry:
            yield from entries(entry, path)
        elif selected(path):
            yield path, entry


def extract(archive, output):
    """Copy missing selected files; packed bytes and unpacked siblings are read-only."""
    output = output.resolve()
    with archive.open("rb") as stream:
        archive_size = stream.seek(0, 2)
        stream.seek(0)
        prefix = stream.read(16)
        if len(prefix) != 16:
            raise ValueError("Truncated ASAR header")
        size_pickle, header_size, payload_size, json_size = struct.unpack("<4I", prefix)
        base = 8 + header_size
        if (
            size_pickle != 4
            or header_size < 8
            or payload_size != header_size - 4
            or json_size > header_size - 8
            or base > archive_size
        ):
            raise ValueError("Invalid ASAR header sizes")
        header = json.loads(stream.read(json_size))
        for path, entry in entries(header):
            destination = output.joinpath(*path)
            if output not in destination.resolve().parents:
                raise ValueError(f"ASAR destination escapes output: {'/'.join(path)}")
            if destination.exists():
                continue
            size = entry.get("size")
            if type(size) is not int or size < 0:
                raise ValueError(f"Invalid ASAR file size: {'/'.join(path)}")
            if entry.get("unpacked"):
                data = pathlib.Path(str(archive) + ".unpacked").joinpath(*path).read_bytes()
            else:
                offset = entry.get("offset")
                if not isinstance(offset, str) or not offset.isascii() or not offset.isdecimal():
                    raise ValueError(f"Invalid ASAR file offset: {'/'.join(path)}")
                offset = int(offset)
                if base + offset + size > archive_size:
                    raise ValueError(f"Truncated ASAR file: {'/'.join(path)}")
                stream.seek(base + offset)
                data = stream.read(size)
            if len(data) != size:
                raise ValueError(f"Truncated ASAR file: {'/'.join(path)}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            print("/".join(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--asar", type=pathlib.Path, default=DEFAULT_ASAR,
        help=f"source app.asar (default: {DEFAULT_ASAR})",
    )
    parser.add_argument(
        "--output", type=pathlib.Path, default=DEFAULT_OUTPUT,
        help="output directory (default: this project's runtime-evidence); existing files are kept",
    )
    args = parser.parse_args()
    try:
        extract(args.asar.expanduser().resolve(), args.output.expanduser())
    except (OSError, ValueError) as error:
        parser.exit(1, f"Extraction failed: {error}\n")


if __name__ == "__main__":
    main()
