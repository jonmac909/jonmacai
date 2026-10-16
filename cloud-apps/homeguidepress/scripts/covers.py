"""Make the landing-page cover for one product from the ebook worker's cover PNGs.

One cover  -> public/covers/<key>.jpg, 680x880.
Two or more -> a fanned set on the page colour, 900x880 (shown without the card shadow).
Usage: python scripts/covers.py <key> <cover1.png> [<cover2.png> ...]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

PAPER = (251, 248, 242)
OUT = Path(__file__).resolve().parent.parent / 'public' / 'covers'


def main(key, paths):
    covers = [Image.open(p).convert('RGB') for p in paths]
    OUT.mkdir(exist_ok=True)
    if len(covers) == 1:
        covers[0].resize((680, 880), Image.LANCZOS).save(OUT / f'{key}.jpg', quality=82, optimize=True, progressive=True)
        return
    w, h = 900, 880
    ch = 640
    cw = round(ch * covers[0].width / covers[0].height)
    step_x = (w - 40 - cw) // (len(covers) - 1)
    step_y = (h - 40 - ch) // (len(covers) - 1)
    canvas = Image.new('RGB', (w, h), PAPER)
    # Back to front: the last book sits top-right, book 1 lands in front, bottom-left.
    for i in reversed(range(len(covers))):
        x, y = 20 + i * step_x, 20 + (len(covers) - 1 - i) * step_y
        shadow = Image.new('L', (w, h), 0)
        ImageDraw.Draw(shadow).rectangle((x + 10, y + 16, x + cw + 10, y + ch + 16), fill=110)
        canvas.paste((60, 45, 30), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
        canvas.paste(covers[i].resize((cw, ch), Image.LANCZOS), (x, y))
    canvas.save(OUT / f'{key}.jpg', quality=82, optimize=True, progressive=True)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
