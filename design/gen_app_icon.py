# -*- coding: utf-8 -*-
"""生成酷比魔方 app 图标（1024x1024 PNG，全息渐变背景 + 等距魔方）。

设计还原自 2026-10 上线的全息渐变版图标：左上紫 -> 右下青对角渐变，
圆角矩形遮罩（透明四角），白描边等距魔方（黄顶/蓝左/红右），半透明白格线。

用法: python gen_app_icon.py [输出路径]
"""
import sys

from PIL import Image, ImageDraw

SIZE = 1024          # 最终输出尺寸
S = 4                # 超采样倍数（抗锯齿）
W = SIZE * S

# ---- 背景渐变（按现图最小二乘拟合，方向为 (1,1) 对角线）----
GRAD_TL = (137, 85, 255)
GRAD_BR = (57, 202, 244)
CORNER_RADIUS = 230  # 圆角矩形遮罩半径

# ---- 魔方几何（描边中心线，1024 尺度；1.0 为原版占幅）----
CUBE_SCALE = 1.20
VX = 276 * CUBE_SCALE   # 顶面菱形半宽
VY = 149 * CUBE_SCALE   # 顶面菱形半高
H = 313 * CUBE_SCALE    # 侧面高度
OUTLINE_W = 6 * CUBE_SCALE
GRID_W = 4.5 * CUBE_SCALE
GRID_ALPHA = 140        # 格线白色不透明度（约 55%）

TOP_COLOR = (255, 213, 79)
LEFT_COLOR = (78, 136, 255)
RIGHT_COLOR = (255, 107, 85)
WHITE = (255, 255, 255)


def clamp(v):
    return max(0, min(255, round(v)))


def main(out_path):
    # ---- 背景：沿对角线的线性渐变 ----
    img = Image.new("RGB", (W, W))
    px = img.load()
    denom = 2 * (W - 1)
    for y in range(W):
        for x in range(W):
            t = (x + y) / denom
            px[x, y] = tuple(clamp(a + (b - a) * t) for a, b in zip(GRAD_TL, GRAD_BR))

    # ---- 魔方（独立图层，便于半透明格线混合）----
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    vx, vy, h = VX * S, VY * S, H * S
    cx = 512 * S
    cy = 512 * S - (h - 2 * vy) / 2  # 让魔方整体垂直居中
    N = (cx, cy - 2 * vy)
    E = (cx + vx, cy - vy)
    Sc = (cx, cy)                    # 顶面朝下的前顶点
    Wp = (cx - vx, cy - vy)
    Sd = (cx, cy + h)
    Ed = (cx + vx, cy - vy + h)
    Wd = (cx - vx, cy - vy + h)

    lw = round(OUTLINE_W * S)
    gw = round(GRID_W * S)

    draw = ImageDraw.Draw(layer)
    draw.polygon([N, E, Sc, Wp], fill=TOP_COLOR)
    draw.polygon([Wp, Sc, Sd, Wd], fill=LEFT_COLOR)
    draw.polygon([Sc, E, Ed, Sd], fill=RIGHT_COLOR)

    def face_grid(origin, ua, ub):
        """沿 ua/ub 两方向画 1/3、2/3 处的半透明白格线。"""
        gdraw = ImageDraw.Draw(layer, "RGBA")
        grid_fill = (*WHITE, GRID_ALPHA)
        pts = {}
        for i in range(4):
            for j in range(4):
                pts[(i, j)] = (origin[0] + ua[0] * i / 3 + ub[0] * j / 3,
                               origin[1] + ua[1] * i / 3 + ub[1] * j / 3)
        for k in (1, 2):
            for (p0, p1) in ((pts[(k, 0)], pts[(k, 3)]),
                             (pts[(0, k)], pts[(3, k)])):
                gdraw.line([p0, p1], fill=grid_fill, width=gw)
        dot = gw / 2
        for i in (1, 2):
            for j in (1, 2):
                x, y = pts[(i, j)]
                gdraw.ellipse([x - dot, y - dot, x + dot, y + dot],
                              fill=grid_fill)

    face_grid(N, (E[0] - N[0], E[1] - N[1]), (Wp[0] - N[0], Wp[1] - N[1]))
    face_grid(Wp, (Sc[0] - Wp[0], Sc[1] - Wp[1]), (0, h))
    face_grid(Sc, (E[0] - Sc[0], E[1] - Sc[1]), (0, h))

    # ---- 白色描边：外轮廓六边形 + 三条内侧棱 ----
    edges = [[N, E], [E, Ed], [Ed, Sd], [Sd, Wd], [Wd, Wp], [Wp, N],
             [Wp, Sc], [Sc, E], [Sc, Sd]]
    for p0, p1 in edges:
        draw.line([p0, p1], fill=WHITE, width=lw)
    dot = lw / 2
    for v in (N, E, Sc, Wp, Sd, Ed, Wd):
        draw.ellipse([v[0] - dot, v[1] - dot, v[0] + dot, v[1] + dot],
                     fill=WHITE)

    img = img.convert("RGBA")
    img.alpha_composite(layer)

    # ---- 圆角矩形遮罩（四角透明）----
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, W - 1, W - 1], radius=CORNER_RADIUS * S, fill=255)
    img.putalpha(mask)

    # ---- 缩到 1024 并输出 ----
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    print(f"saved {out_path} ({SIZE}x{SIZE}, cube scale {CUBE_SCALE})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "app_icon_1024.png")
