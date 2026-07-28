#!/usr/bin/env python3
"""Erzeugt die PWA-Icons aus einer einzigen Quelle.

Aufruf: python3 scripts/generate-icons.py

Bewusst ein Skript statt eingecheckter Binärdateien: Wenn wir die Marke je
anpassen, ändert man hier zwei Zeilen statt vier PNGs neu zu zeichnen.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BRAND = (30, 58, 95)  # brand-800, identisch zur theme_color im Manifest
WHITE = (255, 255, 255)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def draw_icon(size: int, *, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        # Maskable-Icons werden von Android beschnitten. Die Fläche geht bis an
        # den Rand, das "M" bleibt in der sicheren Zone (mittlere 80 %).
        draw.rectangle([0, 0, size, size], fill=BRAND)
        glyph_size = int(size * 0.42)
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BRAND)
        glyph_size = int(size * 0.56)

    font = load_font(glyph_size)
    # anchor="mm" zentriert am Mittelpunkt – zuverlässiger als von Hand
    # gerechnete Offsets, die je nach Schrift danebenliegen.
    draw.text((size / 2, size / 2 - size * 0.02), "M", font=font, fill=WHITE, anchor="mm")
    return img


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    draw_icon(192, maskable=False).save(ICONS / "icon-192.png")
    draw_icon(512, maskable=False).save(ICONS / "icon-512.png")
    draw_icon(512, maskable=True).save(ICONS / "icon-maskable-512.png")
    draw_icon(180, maskable=False).save(PUBLIC / "apple-touch-icon.png")

    favicon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="rgb{BRAND}"/>
  <text x="32" y="33" font-family="system-ui, sans-serif" font-size="38"
        font-weight="700" fill="white" text-anchor="middle"
        dominant-baseline="central">M</text>
</svg>
"""
    (PUBLIC / "favicon.svg").write_text(favicon, encoding="utf-8")

    print("Icons erzeugt:")
    for path in sorted(PUBLIC.rglob("*")):
        if path.is_file():
            print(f"  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
