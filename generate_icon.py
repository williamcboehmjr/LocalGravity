"""
Generates high-resolution multi-size Windows icon (.ico) and PNG for LocalGravity.
"""

from pathlib import Path
from PIL import Image, ImageDraw

assets_dir = Path(__file__).resolve().parent / "assets"
assets_dir.mkdir(parents=True, exist_ok=True)

size = 256
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background rounded square / shield
pad = 16
draw.rounded_rectangle(
    [pad, pad, size - pad, size - pad],
    radius=48,
    fill=(18, 18, 20, 255),
    outline=(59, 130, 246, 200),
    width=6,
)

# Glow ring
cx, cy = size // 2, size // 2
draw.ellipse([cx - 72, cy - 72, cx + 72, cy + 72], outline=(6, 182, 212, 180), width=6)
draw.ellipse([cx - 48, cy - 48, cx + 48, cy + 48], fill=(37, 99, 235, 230), outline=(96, 165, 250, 255), width=4)

# Core energy spark
draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=(255, 255, 255, 255))

# Save PNG and multi-size ICO
png_path = assets_dir / "icon.png"
ico_path = assets_dir / "icon.ico"

img.save(png_path, format="PNG")
img.save(
    ico_path,
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print(f"Generated {ico_path} and {png_path} successfully.")
