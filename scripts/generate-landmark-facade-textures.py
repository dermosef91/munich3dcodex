#!/usr/bin/env python3
"""Generate deterministic bitmap facade sheets for pattern-driven landmarks."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
TEXTURE_ROOT = ROOT / "public" / "assets" / "textures" / "landmarks"

BRANDHORST_COLORS = (
    "#f7db95", "#e6a968", "#dd705e", "#c8566c", "#8f506f", "#625778",
    "#425f83", "#3e718c", "#4e8f99", "#6ca29d", "#8ab29c", "#b1bf8e",
    "#d7c67f", "#f0b568", "#ef8f62", "#d8676f", "#a95a80", "#765e8d",
    "#55769d", "#5a91a9", "#76a8ad", "#a0bbb0", "#c8c49b",
)


def _hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def _shade(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel * amount))) for channel in color)


def brandhorst_sheet(
    file_name: str,
    width: int,
    height: int,
    phase: int,
    *,
    entrance: bool = False,
) -> None:
    image = Image.new("RGB", (width, height), "#d9d3c5")
    draw = ImageDraw.Draw(image)
    rod_width = max(5, width // 430)
    segment_height = max(48, height // 13)

    for x in range(-rod_width, width + rod_width, rod_width):
        column = (x // rod_width) + phase
        for segment_y in range(0, height, segment_height):
            segment = segment_y // segment_height
            color = _hex_rgb(BRANDHORST_COLORS[(column * 7 + segment * 5 + phase) % len(BRANDHORST_COLORS)])
            y_end = min(height, segment_y + segment_height + 1)
            draw.rectangle((x, segment_y, x + rod_width - 1, y_end), fill=_shade(color, 0.72))
            draw.rectangle((x + 1, segment_y, x + rod_width - 2, y_end), fill=color)
            draw.line((x + 1, segment_y, x + 1, y_end), fill=_shade(color, 1.18), width=1)
        draw.line((x + rod_width - 1, 0, x + rod_width - 1, height), fill="#283039", width=1)

    if entrance:
        door_left = round(width * 0.23)
        door_right = round(width * 0.77)
        door_top = round(height * 0.59)
        draw.rectangle((door_left, door_top, door_right, height), fill="#282d30")
        draw.rectangle((door_left + 9, door_top + 9, door_right - 9, height), fill="#52636a")
        draw.line((width // 2, door_top + 9, width // 2, height), fill="#20282b", width=max(4, width // 180))
        draw.rectangle((round(width * 0.20), round(height * 0.48), round(width * 0.80), round(height * 0.58)), fill="#edeadf")

    output = TEXTURE_ROOT / file_name
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_brandhorst() -> None:
    brandhorst_sheet("museum-brandhorst-marianne.png", 3200, 768, 3)
    brandhorst_sheet("museum-brandhorst-tuerken.png", 3200, 768, 11)
    brandhorst_sheet("museum-brandhorst-theresien.png", 976, 1024, 17, entrance=True)
    brandhorst_sheet("museum-brandhorst-south.png", 976, 1024, 6)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", choices=("museum-brandhorst",))
    args = parser.parse_args()
    if args.recipe == "museum-brandhorst":
        generate_brandhorst()


if __name__ == "__main__":
    main()
