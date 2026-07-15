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
    brandhorst_sheet("museum-brandhorst-theresien.png", 1536, 1024, 17, entrance=True)
    brandhorst_sheet("museum-brandhorst-south.png", 976, 1024, 6)


def staatsbibliothek_sheet() -> None:
    """Render the long Ludwigstrasse elevation at its real-world aspect ratio."""
    width, height = 4096, 664
    image = Image.new("RGB", (width, height), "#a7553d")
    draw = ImageDraw.Draw(image)

    # Warm red blank brick with restrained, staggered mortar joints.
    brick_height = 12
    brick_width = 34
    for y in range(0, height, brick_height):
        draw.line((0, y, width, y), fill="#873f31", width=1)
        offset = 0 if (y // brick_height) % 2 == 0 else brick_width // 2
        for x in range(offset, width, brick_width):
            draw.line((x, y, x, min(height, y + brick_height)), fill="#914735", width=1)

    stone = "#d2b987"
    stone_shadow = "#a88c63"
    stone_light = "#ead7aa"
    glass = "#263339"
    glass_light = "#657980"

    # Plinth and the four long sandstone courses give the facade its scale.
    draw.rectangle((0, round(height * 0.895), width, height), fill="#b79c73")
    draw.rectangle((0, round(height * 0.985), width, height), fill="#8e775a")
    for fraction in (0.225, 0.455, 0.690, 0.875):
        y = round(height * fraction)
        draw.rectangle((0, y, width, y + 7), fill=stone_shadow)
        draw.line((0, y, width, y), fill=stone_light, width=2)

    bays = 31
    bay_width = width / bays
    floor_specs = (
        (0.055, 0.135, False),
        (0.285, 0.130, True),
        (0.515, 0.130, True),
        (0.735, 0.125, True),
    )
    for bay in range(bays):
        center_x = round((bay + 0.5) * bay_width)
        # Narrow sandstone dividers keep the 150 m elevation readable at speed.
        draw.rectangle((center_x - 4, 0, center_x + 4, round(height * 0.895)), fill=stone_shadow)
        draw.line((center_x - 3, 0, center_x - 3, round(height * 0.895)), fill=stone_light, width=2)
        for top_fraction, height_fraction, arched in floor_specs:
            window_width = round(bay_width * 0.43)
            window_height = round(height * height_fraction)
            left = center_x - window_width // 2
            top = round(height * top_fraction)
            right = left + window_width
            bottom = top + window_height
            frame = 7
            draw.rectangle((left - frame, top - frame, right + frame, bottom + frame), fill=stone)
            if arched:
                radius = window_width // 2
                draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
                draw.rectangle((left, top + radius, right, bottom), fill=glass)
            else:
                draw.rectangle((left, top, right, bottom), fill=glass)
            draw.line((center_x, top + 4, center_x, bottom - 2), fill="#11191c", width=3)
            draw.line((left + 5, top + 4, left + 5, bottom - 3), fill=glass_light, width=3)

    # Friedrich von Gaertner's central three-door portal and broad stair.
    portal_left = round(width * 0.432)
    portal_right = round(width * 0.568)
    portal_top = round(height * 0.430)
    portal_bottom = round(height * 0.905)
    draw.rectangle((portal_left, portal_top, portal_right, portal_bottom), fill=stone)
    draw.rectangle((portal_left + 10, portal_top + 10, portal_right - 10, portal_bottom), outline=stone_light, width=5)
    for offset in (-0.036, 0, 0.036):
        center_x = round(width * (0.5 + offset))
        door_width = round(width * 0.025)
        left = center_x - door_width // 2
        right = center_x + door_width // 2
        arch_top = round(height * 0.555)
        door_bottom = round(height * 0.895)
        radius = door_width // 2
        draw.pieslice((left, arch_top, right, arch_top + radius * 2), 180, 360, fill="#20292c")
        draw.rectangle((left, arch_top + radius, right, door_bottom), fill="#20292c")
        draw.line((center_x, arch_top + 10, center_x, door_bottom), fill="#5f6b6d", width=4)
        draw.rectangle((left - 9, arch_top - 18, right + 9, arch_top - 6), fill=stone_light)
    for step in range(7):
        inset = step * round(width * 0.006)
        y = round(height * (0.905 + step * 0.012))
        draw.rectangle((round(width * 0.394) + inset, y, round(width * 0.606) - inset, y + 8), fill=stone if step % 2 == 0 else stone_shadow)

    output = TEXTURE_ROOT / "bayerische-staatsbibliothek-ludwigstrasse.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_staatsbibliothek() -> None:
    staatsbibliothek_sheet()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", choices=("museum-brandhorst", "bayerische-staatsbibliothek"))
    args = parser.parse_args()
    if args.recipe == "museum-brandhorst":
        generate_brandhorst()
    elif args.recipe == "bayerische-staatsbibliothek":
        generate_staatsbibliothek()


if __name__ == "__main__":
    main()
