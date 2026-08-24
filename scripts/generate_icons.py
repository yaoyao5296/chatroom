#!/usr/bin/env python3
"""
ChatRoom Android 图标生成脚本（优化版）
- 先画一张 512x512 大图，再缩放到各尺寸
- 风格：深蓝渐变星空 + 月亮 + ChatRoom 发光文字
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import random
import math

# ========== 颜色 ==========
SKY_TOP = (10, 15, 40)
SKY_BOTTOM = (25, 50, 120)
MOON_COLOR = (245, 240, 220)
MOON_GLOW = (230, 225, 200)
STAR_COLOR = (255, 255, 255)
TEXT_GLOW = (100, 180, 255)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(BASE, 'android', 'app', 'src', 'main', 'res')

# ========== 尺寸表 ==========
LAUNCHER_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

random.seed(42)


# ========== 图像生成 ==========
def make_radial_gradient(size):
    """生成径向渐变背景（深蓝中心向外扩散）"""
    img = Image.new('RGB', (size, size), SKY_TOP)
    pixels = img.load()
    cx, cy = size / 2, size / 2
    max_r = size * 0.7
    for y in range(size):
        for x in range(size):
            r = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(1.0, r / max_r)
            # 中心亮蓝 → 边缘深蓝
            R = int(SKY_BOTTOM[0] * (1 - t) + SKY_TOP[0] * t)
            G = int(SKY_BOTTOM[1] * (1 - t) + SKY_TOP[1] * t)
            B = int(SKY_BOTTOM[2] * (1 - t) + SKY_TOP[2] * t)
            pixels[x, y] = (R, G, B)
    return img


def add_stars(img, density=0.004):
    """画随机星星（小亮点）"""
    w, h = img.size
    draw = ImageDraw.Draw(img, 'RGBA')
    count = int(w * h * density)
    for _ in range(count):
        x = random.randint(0, w - 1)
        y = random.randint(0, h - 1)
        # 星星尺寸：小的 1x1，偶尔 2x2
        if random.random() < 0.15:
            r = 2
        else:
            r = 1
        brightness = random.randint(150, 255)
        alpha = random.randint(160, 255)
        draw.ellipse([x, y, x + r, y + r], fill=(brightness, brightness, brightness, alpha))
    return img


def add_moon(img):
    """右上角画一个发光的月亮"""
    w, h = img.size
    cx = int(w * 0.73)
    cy = int(h * 0.30)
    moon_r = int(w * 0.13)

    draw = ImageDraw.Draw(img, 'RGBA')

    # 多层外发光
    for i in range(5, 0, -1):
        r = moon_r + i * int(w * 0.012)
        alpha = int(60 * (1 - i / 6))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(MOON_GLOW[0], MOON_GLOW[1], MOON_GLOW[2], alpha))

    # 月亮主体
    draw.ellipse([cx - moon_r, cy - moon_r, cx + moon_r, cy + moon_r], fill=MOON_COLOR)

    # 月牙：从右侧裁掉一部分
    offset = int(moon_r * 0.40)
    draw.ellipse([cx - moon_r + offset, cy - moon_r, cx + moon_r + offset, cy + moon_r],
                 fill=(SKY_TOP[0], SKY_TOP[1], SKY_TOP[2], 255))
    return img


def get_font(size_px):
    """加载字体（如果找不到就用默认位图字体）"""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size_px)
            except:
                continue
    return None


def add_text_glow(img, text="ChatRoom"):
    """画带多层发光的 ChatRoom 文字"""
    w, h = img.size
    font_size = int(w * 0.20)
    font = get_font(font_size)
    if font is None:
        # 找不到字体就画一个蓝色圆形作为占位
        draw = ImageDraw.Draw(img, 'RGBA')
        r = int(w * 0.28)
        draw.ellipse([w/2 - r, h/2 - r, w/2 + r, h/2 + r], fill=(100, 180, 255, 100))
        return img

    draw = ImageDraw.Draw(img, 'RGBA')
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (w - tw) / 2 - bbox[0]
    ty = (h - th) / 2 - bbox[1]

    # 多层发光（从外到内）
    glow_steps = [
        (int(w * 0.06), (100, 180, 255, 15)),
        (int(w * 0.04), (100, 200, 255, 35)),
        (int(w * 0.025), (120, 220, 255, 70)),
        (int(w * 0.012), (180, 230, 255, 150)),
    ]
    for step_size, color in glow_steps:
        for dx in range(-step_size, step_size + 1, max(1, step_size // 3)):
            for dy in range(-step_size, step_size + 1, max(1, step_size // 3)):
                draw.text((tx + dx, ty + dy), text, font=font, fill=color)

    # 白色主文字
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # 底部装饰线
    line_y = int(ty + th + w * 0.07)
    line_w = int(tw * 0.35)
    line_x = (w - line_w) / 2
    draw.rectangle([line_x, line_y, line_x + line_w, line_y + max(2, int(w * 0.008))],
                   fill=(180, 220, 255, 200))
    return img


def make_circular(img):
    """裁剪为圆形"""
    size = img.size[0]
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    bg = Image.new('RGB', (size, size), SKY_TOP)
    bg.paste(img, mask=mask)
    return bg


def make_foreground(size):
    """前景层（透明背景 + 图案）"""
    # 先画一个 512 尺寸的再缩放
    big = 512
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    img = add_stars(img, density=0.003)
    img = add_moon(img)
    img = add_text_glow(img)
    return img.resize((size, size), Image.LANCZOS)


def make_full_icon(size):
    """完整方形图标（背景+星星+月亮+文字）"""
    big = 512
    img = make_radial_gradient(big)
    img = add_stars(img)
    img = add_moon(img)
    img = add_text_glow(img)
    # 轻微模糊，让文字更柔和
    img = img.filter(ImageFilter.SMOOTH)
    return img.resize((size, size), Image.LANCZOS)


def main():
    print(f"🚀 ChatRoom 图标生成中...")
    print(f"   输出: {RES}")

    count = 0
    for density, size in LAUNCHER_SIZES.items():
        outdir = os.path.join(RES, f'mipmap-{density}')
        os.makedirs(outdir, exist_ok=True)

        # 方形图标
        icon = make_full_icon(size)
        icon.save(os.path.join(outdir, 'ic_launcher.png'), 'PNG', optimize=True)
        # 圆角图标
        make_circular(icon).save(os.path.join(outdir, 'ic_launcher_round.png'), 'PNG', optimize=True)
        count += 2
        print(f"   ✔ {density} -> {size}x{size}")

    for density, size in FOREGROUND_SIZES.items():
        outdir = os.path.join(RES, f'mipmap-{density}')
        os.makedirs(outdir, exist_ok=True)

        make_foreground(size).save(os.path.join(outdir, 'ic_launcher_foreground.png'), 'PNG', optimize=True)
        count += 1

    print(f"\n✅ 共生成 {count} 个图标文件")
    print(f"\n📦 下一步: 执行以下命令打包 APK:")
    print(f"   cd {BASE}")
    print(f"   npx vite build")
    print(f"   npx cap sync android")
    print(f"   cd android && ./gradlew assembleDebug")


if __name__ == '__main__':
    main()
