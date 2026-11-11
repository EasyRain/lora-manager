# -*- coding: utf-8 -*-
"""生成 LoRA 管理器的程序图标（多尺寸 .ico）。

图形：深色圆角底 + 三张叠起来的卡片，最上面一张是浅色"提示词卡"，
带三条正文线和右上角一颗琥珀色强度角标。缩小到 16px 仍能看出"一摞卡片"。

用法： python make-icon.py [输出路径]
"""
import sys
import os
from PIL import Image, ImageDraw

S = 4                 # 超采样倍数
N = 256 * S           # 画布边长
BG_TOP = (30, 40, 58)
BG_BOT = (12, 17, 26)
CARD_BACK = (38, 52, 78)
CARD_MID = (52, 72, 106)
CARD_FRONT = (232, 238, 248)
LINE = (58, 78, 112)
ACCENT = (224, 163, 58)


def rr(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make():
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景渐变
    for y in range(N):
        t = y / (N - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (N, y)], fill=c + (255,))

    # 圆角裁切
    mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.21), fill=255)
    img.putalpha(mask)

    # 卡片几何：整摞居中
    w, h, r = int(N * 0.46), int(N * 0.32), int(N * 0.05)
    step = int(N * 0.062)
    x0 = int((N - (w + step)) / 2)
    y0 = int((N - (h + 2 * step)) / 2)

    # 背后一层柔光
    glow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse([x0 - w * 0.40, y0 - h * 0.55, x0 + w + step + w * 0.40, y0 + h + 2 * step + h * 0.55],
               fill=(90, 150, 235, 16))
    img.alpha_composite(glow)

    # 三张卡片
    rr(d, [x0 + step, y0 + step * 2, x0 + step + w, y0 + step * 2 + h], r, CARD_BACK)
    rr(d, [x0 + int(step * 0.5), y0 + step, x0 + int(step * 0.5) + w, y0 + step + h], r, CARD_MID)
    rr(d, [x0, y0, x0 + w, y0 + h], r, CARD_FRONT)

    # 正文三条线（左边距统一，长度递减）
    lx = x0 + int(w * 0.11)
    lh = int(h * 0.075)
    gap = int(h * 0.155)
    ly = y0 + int(h * 0.30)
    for i, frac in enumerate((0.58, 0.70, 0.40)):
        d.rounded_rectangle([lx, ly + i * (lh + gap), lx + int(w * frac), ly + i * (lh + gap) + lh],
                            radius=lh // 2, fill=LINE)

    # 右上角强度角标
    b = int(h * 0.19)
    bx = x0 + w - int(w * 0.10) - b
    by = y0 + int(h * 0.13)
    d.rounded_rectangle([bx, by, bx + b, by + b], radius=b // 2, fill=ACCENT)

    return img


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "shell", "app.ico")
    img = make()
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    imgs = [img.resize((s, s), Image.LANCZOS) for s in sizes]
    imgs[-1].save(out, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
    print("已生成", out, os.path.getsize(out), "字节")
    # 顺便存一张 png 预览
    png = os.path.splitext(out)[0] + "-preview.png"
    imgs[-1].resize((256, 256), Image.LANCZOS).save(png)
    print("预览", png)


if __name__ == "__main__":
    main()
