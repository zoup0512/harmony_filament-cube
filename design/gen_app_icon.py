# -*- coding: utf-8 -*-
"""生成酷比魔方 app 图标（1024x1024 PNG，薄荷绿主题，元服务圆形裁切安全区）。

用法: python gen_app_icon.py [输出路径]
"""
import math
import sys

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024          # 最终输出尺寸
S = 4                # 超采样倍数（抗锯齿）
W = SIZE * S

INK = (24, 45, 42)        # #182D2A 深墨绿（格线）
CORAL = (224, 101, 79)    # #E0654F 珊瑚红（主题 #A34238 提亮）
LIME = (213, 244, 120)    # #D5F478 青柠高亮


def lerp(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def main(out_path):
    img = Image.new("RGB", (W, W), (251, 253, 249))

    # ---- 背景：垂直渐变 米白 -> 浅薄荷 ----
    top, bottom = (251, 253, 249), (214, 232, 220)
    grad = Image.new("RGB", (1, W))
    for y in range(W):
        grad.putpixel((0, y), lerp(top, bottom, y / (W - 1)))
    img.paste(grad.resize((W, W)))

    # ---- 魔方身后的柔光 ----
    glow = Image.new("L", (W, W), 0)
    gd = ImageDraw.Draw(glow)
    cx0, cy0, r0 = 512 * S, 470 * S, 330 * S
    gd.ellipse([cx0 - r0, cy0 - r0, cx0 + r0, cy0 + r0], fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(120 * S // 4))
    img.paste(Image.new("RGB", (W, W), (255, 255, 255)), (0, 0), glow)

    # ---- 底部投影 ----
    shadow = Image.new("L", (W, W), 0)
    sd = ImageDraw.Draw(shadow)
    sx, sy, rx, ry = 512 * S, 790 * S, 260 * S, 40 * S
    sd.ellipse([sx - rx, sy - ry, sx + rx, sy + ry], fill=60)
    shadow = shadow.filter(ImageFilter.GaussianBlur(45 * S // 4))
    img.paste(Image.new("RGB", (W, W), INK), (0, 0), shadow)

    draw = ImageDraw.Draw(img)

    # ---- 等距立方体几何 ----
    cx, cy = 512 * S, 505 * S
    vx, vy, h = 270 * S, 135 * S, 260 * S
    N = (cx, cy - 2 * vy)
    E = (cx + vx, cy - vy)
    Sc = (cx, cy)                       # 顶面朝下的顶点
    Wp = (cx - vx, cy - vy)
    Sd = (cx, cy + h)                   # 底部顶点
    Ed = (E[0], E[1] + h)
    Wd = (Wp[0], Wp[1] + h)

    def quad(p0, p1, p2, p3):
        return [p0, p1, p2, p3]

    def scale_about(pts, s):
        mx = sum(p[0] for p in pts) / len(pts)
        my = sum(p[1] for p in pts) / len(pts)
        return [(mx + (p[0] - mx) * s, my + (p[1] - my) * s) for p in pts]

    TILE_SHRINK = 0.85  # 留出墨绿色格缝

    def draw_face(origin, ua, ub, color_at, corners):
        """先铺墨绿底（形成格缝），再以 origin 为角点沿 ua/ub 方向贴 3x3 贴片。"""
        draw.polygon(corners, fill=INK)
        pts = {}
        for i in range(4):
            for j in range(4):
                pts[(i, j)] = (origin[0] + ua[0] * i / 3 + ub[0] * j / 3,
                               origin[1] + ua[1] * i / 3 + ub[1] * j / 3)
        for i in range(3):
            for j in range(3):
                tile = quad(pts[(i, j)], pts[(i + 1, j)],
                            pts[(i + 1, j + 1)], pts[(i, j + 1)])
                draw.polygon(scale_about(tile, TILE_SHRINK),
                             fill=color_at(i, j))

    # 顶面：近白（原点取底顶点 Sc，方向指向东/西）
    top_ua = (E[0] - Sc[0], E[1] - Sc[1])
    top_ub = (Wp[0] - Sc[0], Wp[1] - Sc[1])
    draw_face(Sc, top_ua, top_ub, lambda i, j: (252, 254, 250), [Sc, E, N, Wp])

    # 左面：薄荷绿渐变（上浅下深），中部一块青柠
    left_ua = (Sc[0] - Wp[0], Sc[1] - Wp[1])
    left_ub = (0, h)
    LEFT_LIGHT, LEFT_DARK = (152, 224, 190), (85, 187, 141)

    def left_color(i, j):
        if (i, j) == (1, 2):
            return LIME
        return lerp(LEFT_LIGHT, LEFT_DARK, (j + 0.5) / 3)

    draw_face(Wp, left_ua, left_ub, left_color, [Wp, Sc, Sd, Wd])

    # 右面：深绿渐变，中央一块珊瑚红
    right_ua = (E[0] - Sc[0], E[1] - Sc[1])
    right_ub = (0, h)
    RIGHT_LIGHT, RIGHT_DARK = (62, 150, 119), (35, 97, 74)

    def right_color(i, j):
        if (i, j) == (1, 1):
            return CORAL
        return lerp(RIGHT_LIGHT, RIGHT_DARK, (j + 0.5) / 3)

    draw_face(Sc, right_ua, right_ub, right_color, [Sc, E, Ed, Sd])

    # ---- 外轮廓描边 ----
    outline = [N, E, Ed, Sd, Wd, Wp, N]
    lw = round(15 * S)
    draw.line(outline, fill=INK, width=lw, joint="curve")
    dot = lw // 2
    for px, py in outline:
        draw.ellipse([px - dot, py - dot, px + dot, py + dot], fill=INK)

    # ---- 缩到 1024 并输出 ----
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    print(f"saved {out_path} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "app_icon_1024.png")
