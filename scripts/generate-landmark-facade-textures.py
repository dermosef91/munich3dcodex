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


def haus_der_kunst_sheet(
    file_name: str,
    width: int,
    height: int,
    bays: int,
    *,
    central_entrance: bool = False,
) -> None:
    """Render the neutral travertine colonnade and stepped front wings."""
    image = Image.new("RGB", (width, height), "#b9aa8e")
    draw = ImageDraw.Draw(image)
    stone_dark = "#8e826e"
    stone_mid = "#b9aa8e"
    stone_light = "#d2c5aa"
    recess = "#292d2c"
    glass = "#394442"

    # Subtle horizontal stone joints, kept neutral so lighting comes from PBR.
    joint_step = max(18, height // 28)
    for y in range(0, height, joint_step):
        draw.line((0, y, width, y), fill="#a89a82", width=max(1, height // 500))
    draw.rectangle((0, 0, width, round(height * 0.205)), fill=stone_mid)
    draw.rectangle((0, round(height * 0.175), width, round(height * 0.215)), fill=stone_light)
    draw.rectangle((0, round(height * 0.225), width, round(height * 0.815)), fill=recess)
    draw.rectangle((0, round(height * 0.815), width, height), fill=stone_mid)
    draw.rectangle((0, round(height * 0.885), width, height), fill=stone_dark)
    draw.line((0, round(height * 0.815), width, round(height * 0.815)), fill=stone_light, width=max(3, height // 100))

    bay_width = width / bays
    column_width = max(8, round(bay_width * 0.18))
    for axis in range(bays + 1):
        center_x = round(axis * bay_width)
        left = max(0, center_x - column_width // 2)
        right = min(width, center_x + column_width // 2)
        draw.rectangle((left, round(height * 0.205), right, round(height * 0.835)), fill=stone_mid)
        draw.line((left, round(height * 0.205), left, round(height * 0.835)), fill=stone_light, width=max(2, column_width // 8))
        draw.line((right, round(height * 0.205), right, round(height * 0.835)), fill=stone_dark, width=max(2, column_width // 9))
        capital = max(column_width + 8, round(bay_width * 0.27))
        draw.rectangle((max(0, center_x - capital // 2), round(height * 0.195), min(width, center_x + capital // 2), round(height * 0.235)), fill=stone_light)
        draw.rectangle((max(0, center_x - capital // 2), round(height * 0.800), min(width, center_x + capital // 2), round(height * 0.845)), fill=stone_dark)

    # Dark glass and doors sit behind the columns rather than on their faces.
    for bay in range(bays):
        left = round((bay + 0.20) * bay_width)
        right = round((bay + 0.80) * bay_width)
        draw.rectangle((left, round(height * 0.395), right, round(height * 0.790)), fill=glass)
        draw.line((round((left + right) / 2), round(height * 0.395), round((left + right) / 2), round(height * 0.790)), fill="#1f2827", width=max(2, width // 900))
    if central_entrance:
        center = width // 2
        entrance_width = round(bay_width * 1.45)
        draw.rectangle((center - entrance_width // 2, round(height * 0.340), center + entrance_width // 2, round(height * 0.835)), fill="#202624")
        for offset in (-0.28, 0, 0.28):
            x = round(center + entrance_width * offset)
            draw.line((x, round(height * 0.360), x, round(height * 0.835)), fill="#6e7975", width=max(2, width // 1000))

    output = TEXTURE_ROOT / file_name
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_haus_der_kunst() -> None:
    haus_der_kunst_sheet("haus-der-kunst-prinzregentenstrasse-main.png", 4096, 596, 21, central_entrance=True)
    haus_der_kunst_sheet("haus-der-kunst-prinzregentenstrasse-inner-wing.png", 376, 768, 2)
    haus_der_kunst_sheet("haus-der-kunst-prinzregentenstrasse-outer-wing.png", 728, 768, 4)


def pinakothek_der_moderne_sheet(file_name: str, width: int, height: int, variant: str) -> None:
    """Render one fair-faced-concrete elevation of the modern-art museum."""
    image = Image.new("RGB", (width, height), "#d8d7d1")
    draw = ImageDraw.Draw(image)
    concrete = "#d8d7d1"
    concrete_light = "#e7e5df"
    concrete_shadow = "#b9b9b4"
    seam = "#aaa9a4"
    glass = "#29383d"
    glass_light = "#465b62"

    # Rectangular formwork/panel rhythm is intentionally low contrast.
    panel_x = max(96, width // 18)
    panel_y = max(72, height // 8)
    for x in range(0, width, panel_x):
        draw.line((x, 0, x, height), fill=seam, width=1)
    for y in range(0, height, panel_y):
        draw.line((0, y, width, y), fill=seam, width=1)
    draw.rectangle((0, round(height * 0.900), width, height), fill=concrete_shadow)
    draw.line((0, round(height * 0.895), width, round(height * 0.895)), fill=concrete_light, width=4)

    if variant == "barerstrasse":
        # Address facade: deep glazed hall beneath a broad concrete canopy.
        draw.rectangle((round(width * 0.08), round(height * 0.355), round(width * 0.92), round(height * 0.885)), fill=glass)
        draw.rectangle((round(width * 0.035), round(height * 0.285), round(width * 0.965), round(height * 0.390)), fill=concrete_light)
        draw.rectangle((round(width * 0.035), round(height * 0.382), round(width * 0.965), round(height * 0.410)), fill=concrete_shadow)
        for axis in range(1, 8):
            x = round(width * (0.08 + axis * 0.105))
            draw.rectangle((x - 7, round(height * 0.390), x + 7, round(height * 0.895)), fill=concrete)
            draw.line((x - 5, round(height * 0.410), x - 5, round(height * 0.885)), fill=concrete_light, width=2)
        for x in range(round(width * 0.10), round(width * 0.92), max(35, width // 15)):
            draw.line((x, round(height * 0.430), x, round(height * 0.875)), fill=glass_light, width=2)
        draw.rectangle((round(width * 0.18), round(height * 0.075), round(width * 0.82), round(height * 0.235)), fill=concrete_light)
    elif variant == "marianne":
        # Long Kunstareal face: monolithic walls cut by a horizontal glass band.
        draw.rectangle((round(width * 0.07), round(height * 0.515), round(width * 0.93), round(height * 0.755)), fill=glass)
        draw.rectangle((round(width * 0.04), round(height * 0.455), round(width * 0.96), round(height * 0.535)), fill=concrete_light)
        for axis in range(13):
            x = round(width * (0.08 + axis * 0.07))
            draw.rectangle((x - 5, round(height * 0.525), x + 5, round(height * 0.765)), fill=concrete)
        draw.rectangle((round(width * 0.44), round(height * 0.445), round(width * 0.56), round(height * 0.895)), fill="#253237")
    elif variant == "tuerkenstrasse":
        draw.rectangle((round(width * 0.55), round(height * 0.295), round(width * 0.94), round(height * 0.875)), fill=glass)
        draw.rectangle((round(width * 0.49), round(height * 0.245), round(width * 0.97), round(height * 0.340)), fill=concrete_light)
        for axis in range(5):
            x = round(width * (0.58 + axis * 0.08))
            draw.rectangle((x - 6, round(height * 0.330), x + 6, round(height * 0.895)), fill=concrete)
        draw.rectangle((round(width * 0.13), round(height * 0.580), round(width * 0.36), round(height * 0.740)), fill=glass)
    else:  # gabelsbergerstrasse
        draw.rectangle((round(width * 0.12), round(height * 0.590), round(width * 0.88), round(height * 0.755)), fill=glass)
        for axis in range(10):
            x = round(width * (0.14 + axis * 0.08))
            draw.rectangle((x - 5, round(height * 0.575), x + 5, round(height * 0.780)), fill=concrete)
        draw.rectangle((round(width * 0.71), round(height * 0.470), round(width * 0.82), round(height * 0.895)), fill="#253237")

    output = TEXTURE_ROOT / file_name
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_pinakothek_der_moderne() -> None:
    pinakothek_der_moderne_sheet("pinakothek-der-moderne-marianne.png", 4096, 720, "marianne")
    pinakothek_der_moderne_sheet("pinakothek-der-moderne-tuerkenstrasse.png", 1952, 720, "tuerkenstrasse")
    pinakothek_der_moderne_sheet("pinakothek-der-moderne-gabelsbergerstrasse.png", 4096, 720, "gabelsbergerstrasse")
    pinakothek_der_moderne_sheet("pinakothek-der-moderne-barerstrasse.png", 1952, 720, "barerstrasse")


def nsdoku_sheet(file_name: str, variant: str) -> None:
    """Render one elevation of the white NS documentation centre cube."""
    width, height = 1024, 1244
    image = Image.new("RGB", (width, height), "#e4e3de")
    draw = ImageDraw.Draw(image)
    concrete = "#e4e3de"
    highlight = "#f1f0ec"
    shadow = "#b5b5b1"
    recess = "#222b2e"
    glass = "#334146"

    # Large cast-concrete panels stay visible without turning into a grid.
    for y in range(0, height, 156):
        draw.line((0, y, width, y), fill="#cac9c5", width=2)
    for x in (256, 512, 768):
        draw.line((x, 0, x, height), fill="#d2d1cc", width=1)

    openings: dict[str, tuple[tuple[float, float, float, float], ...]] = {
        "briennerstrasse": (
            (0.12, 0.13, 0.18, 0.19), (0.53, 0.08, 0.27, 0.14),
            (0.29, 0.37, 0.37, 0.12), (0.69, 0.53, 0.18, 0.22),
            (0.08, 0.65, 0.28, 0.12), (0.40, 0.80, 0.25, 0.20),
        ),
        "west": (
            (0.17, 0.09, 0.19, 0.27), (0.58, 0.18, 0.27, 0.12),
            (0.12, 0.48, 0.36, 0.13), (0.62, 0.55, 0.17, 0.26),
            (0.26, 0.78, 0.26, 0.13),
        ),
        "north": (
            (0.11, 0.16, 0.29, 0.12), (0.60, 0.08, 0.16, 0.25),
            (0.33, 0.43, 0.35, 0.13), (0.09, 0.62, 0.18, 0.23),
            (0.56, 0.75, 0.31, 0.13),
        ),
        "east": (
            (0.18, 0.08, 0.16, 0.24), (0.52, 0.19, 0.34, 0.12),
            (0.10, 0.42, 0.25, 0.15), (0.48, 0.55, 0.20, 0.25),
            (0.18, 0.78, 0.25, 0.12), (0.73, 0.80, 0.14, 0.16),
        ),
    }
    for left_f, top_f, width_f, height_f in openings[variant]:
        left = round(width * left_f)
        top = round(height * top_f)
        right = round(width * (left_f + width_f))
        bottom = round(height * (top_f + height_f))
        bevel = 13
        draw.rectangle((left - bevel, top - bevel, right + bevel, bottom + bevel), fill=shadow)
        draw.polygon(((left - bevel, top - bevel), (right + bevel, top - bevel), (right, top), (left, top)), fill=highlight)
        draw.polygon(((left - bevel, top - bevel), (left, top), (left, bottom), (left - bevel, bottom + bevel)), fill="#aaa9a5")
        draw.rectangle((left, top, right, bottom), fill=recess)
        draw.rectangle((left + 8, top + 8, right - 8, bottom - 8), fill=glass)
        draw.line((left + 16, top + 8, left + 16, bottom - 8), fill="#53646a", width=4)

    if variant == "briennerstrasse":
        # Street entrance is a deep ground-level cut, separate from the windows.
        draw.rectangle((round(width * 0.42), round(height * 0.825), round(width * 0.68), height), fill=recess)
        draw.rectangle((round(width * 0.46), round(height * 0.865), round(width * 0.64), height), fill=glass)
        draw.line((round(width * 0.55), round(height * 0.865), round(width * 0.55), height), fill="#66777c", width=4)

    draw.rectangle((0, round(height * 0.985), width, height), fill="#b9b9b5")
    output = TEXTURE_ROOT / file_name
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_nsdoku() -> None:
    nsdoku_sheet("nsdoku-briennerstrasse.png", "briennerstrasse")
    nsdoku_sheet("nsdoku-west.png", "west")
    nsdoku_sheet("nsdoku-north.png", "north")
    nsdoku_sheet("nsdoku-east.png", "east")


def museum_fuenf_kontinente_sheet() -> None:
    """Render the arcaded Maximilianstrasse museum elevation."""
    width, height = 2048, 1352
    image = Image.new("RGB", (width, height), "#a96f4e")
    draw = ImageDraw.Draw(image)
    brick = "#a96f4e"
    brick_dark = "#824e39"
    stone = "#d0b78e"
    stone_light = "#ead6ad"
    stone_shadow = "#a78c67"
    glass = "#283438"

    brick_h = 16
    brick_w = 44
    for y in range(0, height, brick_h):
        draw.line((0, y, width, y), fill=brick_dark, width=1)
        offset = 0 if (y // brick_h) % 2 == 0 else brick_w // 2
        for x in range(offset, width, brick_w):
            draw.line((x, y, x, min(height, y + brick_h)), fill="#925d43", width=1)

    # Heavy Romanesque courses and a small geometric frieze define the silhouette.
    for fraction in (0.09, 0.31, 0.57, 0.86):
        y = round(height * fraction)
        draw.rectangle((0, y, width, y + 18), fill=stone_shadow)
        draw.line((0, y, width, y), fill=stone_light, width=5)
    draw.rectangle((0, round(height * 0.91), width, height), fill=stone_shadow)
    draw.rectangle((0, 0, width, round(height * 0.055)), fill=stone)
    for x in range(18, width, 54):
        y = round(height * 0.115)
        draw.polygon(((x, y), (x + 16, y - 13), (x + 32, y), (x + 16, y + 13)), fill=stone_light)

    bays = 11
    bay_width = width / bays
    for bay in range(bays):
        center_x = round((bay + 0.5) * bay_width)
        pier = max(12, round(bay_width * 0.10))
        draw.rectangle((center_x - pier // 2, round(height * 0.12), center_x + pier // 2, round(height * 0.91)), fill=stone_shadow)
        draw.line((center_x - pier // 2 + 3, round(height * 0.12), center_x - pier // 2 + 3, round(height * 0.91)), fill=stone_light, width=4)

        # Paired upper arched windows.
        for dx in (-0.18, 0.18):
            window_center = round(center_x + bay_width * dx)
            window_width = round(bay_width * 0.23)
            left = window_center - window_width // 2
            right = window_center + window_width // 2
            top = round(height * 0.17)
            bottom = round(height * 0.29)
            radius = window_width // 2
            draw.rectangle((left - 7, top - 7, right + 7, bottom + 7), fill=stone)
            draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
            draw.rectangle((left, top + radius, right, bottom), fill=glass)

        # Tall middle-storey arched opening.
        window_width = round(bay_width * 0.42)
        left = center_x - window_width // 2
        right = center_x + window_width // 2
        top = round(height * 0.36)
        bottom = round(height * 0.55)
        radius = window_width // 2
        draw.rectangle((left - 10, top - 10, right + 10, bottom + 10), fill=stone)
        draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
        draw.rectangle((left, top + radius, right, bottom), fill=glass)
        draw.line((center_x, top + 8, center_x, bottom - 5), fill="#607278", width=4)

        # Ground-floor arcade.
        arch_width = round(bay_width * 0.58)
        left = center_x - arch_width // 2
        right = center_x + arch_width // 2
        top = round(height * 0.64)
        bottom = round(height * 0.90)
        radius = arch_width // 2
        draw.rectangle((left - 12, top - 12, right + 12, bottom + 6), fill=stone)
        draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
        draw.rectangle((left, top + radius, right, bottom), fill=glass)

    # Monumental central entry interrupts the regular arcade.
    center = width // 2
    portal_width = round(bay_width * 0.92)
    left = center - portal_width // 2
    right = center + portal_width // 2
    top = round(height * 0.58)
    bottom = round(height * 0.92)
    radius = portal_width // 2
    draw.rectangle((left - 18, top - 18, right + 18, bottom + 8), fill=stone_light)
    draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill="#202a2d")
    draw.rectangle((left, top + radius, right, bottom), fill="#202a2d")
    draw.line((center, top + 10, center, bottom), fill="#68797d", width=6)

    output = TEXTURE_ROOT / "museum-fuenf-kontinente-maximilianstrasse.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_museum_fuenf_kontinente() -> None:
    museum_fuenf_kontinente_sheet()


def hotel_vier_jahreszeiten_sheet() -> None:
    """Render the formal Maximilianstrasse hotel frontage."""
    width, height = 2048, 1504
    image = Image.new("RGB", (width, height), "#c6aa7a")
    draw = ImageDraw.Draw(image)
    plaster = "#c6aa7a"
    plaster_light = "#dfc99b"
    stone = "#d7c39c"
    stone_shadow = "#a58a61"
    glass = "#263237"
    glass_light = "#60737a"

    # Fine ashlar joints and strong storey courses organize the palatial front.
    for y in range(0, height, 42):
        draw.line((0, y, width, y), fill="#b79969", width=2)
    for fraction in (0.18, 0.38, 0.59, 0.80, 0.91):
        y = round(height * fraction)
        draw.rectangle((0, y, width, y + 16), fill=stone_shadow)
        draw.line((0, y, width, y), fill=plaster_light, width=5)
    draw.rectangle((0, 0, width, round(height * 0.065)), fill=stone)
    draw.rectangle((0, round(height * 0.915), width, height), fill=stone_shadow)

    bays = 9
    bay_width = width / bays
    floor_specs = (
        (0.095, 0.115, False),
        (0.245, 0.125, False),
        (0.435, 0.135, True),
        (0.635, 0.135, True),
    )
    for bay in range(bays):
        center_x = round((bay + 0.5) * bay_width)
        # Subtle colossal pilasters on the central three-bay block.
        if 2 <= bay <= 6:
            draw.rectangle((round(bay * bay_width) - 6, round(height * 0.19), round(bay * bay_width) + 6, round(height * 0.81)), fill=plaster_light)
        for top_f, height_f, arched in floor_specs:
            window_width = round(bay_width * 0.42)
            window_height = round(height * height_f)
            left = center_x - window_width // 2
            top = round(height * top_f)
            right = center_x + window_width // 2
            bottom = top + window_height
            surround = 10
            draw.rectangle((left - surround, top - surround, right + surround, bottom + surround), fill=stone)
            if arched:
                radius = window_width // 2
                draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
                draw.rectangle((left, top + radius, right, bottom), fill=glass)
            else:
                draw.rectangle((left, top, right, bottom), fill=glass)
            draw.line((center_x, top + 5, center_x, bottom - 5), fill="#151d20", width=4)
            draw.line((left + 8, top + 5, left + 8, bottom - 5), fill=glass_light, width=3)
            if top_f in (0.245, 0.435):
                draw.rectangle((left - 16, bottom + 8, right + 16, bottom + 18), fill=stone_shadow)

        # Tall ground-floor shop arcade.
        opening_width = round(bay_width * 0.58)
        left = center_x - opening_width // 2
        right = center_x + opening_width // 2
        top = round(height * 0.825)
        bottom = round(height * 0.955)
        radius = opening_width // 2
        draw.rectangle((left - 12, top - 12, right + 12, bottom + 5), fill=stone)
        draw.pieslice((left, top, right, top + radius * 2), 180, 360, fill=glass)
        draw.rectangle((left, top + radius, right, bottom), fill=glass)

    # Central revolving-door entrance and understated canopy.
    center = width // 2
    entrance_width = round(bay_width * 0.82)
    draw.rectangle((center - entrance_width // 2, round(height * 0.795), center + entrance_width // 2, round(height * 0.975)), fill="#20292c")
    draw.line((center, round(height * 0.815), center, round(height * 0.975)), fill=glass_light, width=6)
    draw.rectangle((center - round(entrance_width * 0.75), round(height * 0.775), center + round(entrance_width * 0.75), round(height * 0.805)), fill="#544a3b")
    draw.line((center - round(entrance_width * 0.75), round(height * 0.775), center + round(entrance_width * 0.75), round(height * 0.775)), fill=plaster_light, width=5)

    output = TEXTURE_ROOT / "hotel-vier-jahreszeiten-maximilianstrasse.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


def generate_hotel_vier_jahreszeiten() -> None:
    hotel_vier_jahreszeiten_sheet()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", choices=(
        "museum-brandhorst",
        "bayerische-staatsbibliothek",
        "haus-der-kunst",
        "pinakothek-der-moderne",
        "ns-dokumentationszentrum",
        "museum-fuenf-kontinente",
        "hotel-vier-jahreszeiten",
    ))
    args = parser.parse_args()
    if args.recipe == "museum-brandhorst":
        generate_brandhorst()
    elif args.recipe == "bayerische-staatsbibliothek":
        generate_staatsbibliothek()
    elif args.recipe == "haus-der-kunst":
        generate_haus_der_kunst()
    elif args.recipe == "pinakothek-der-moderne":
        generate_pinakothek_der_moderne()
    elif args.recipe == "ns-dokumentationszentrum":
        generate_nsdoku()
    elif args.recipe == "museum-fuenf-kontinente":
        generate_museum_fuenf_kontinente()
    elif args.recipe == "hotel-vier-jahreszeiten":
        generate_hotel_vier_jahreszeiten()


if __name__ == "__main__":
    main()
