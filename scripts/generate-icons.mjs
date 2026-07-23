/**
 * 使用用户上传的图片生成 Android 应用启动图标
 */
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RES_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')
const SOURCE_IMAGE = path.join(__dirname, '..', '.trae', '1782994648392.jpg')

const SIZES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
}

const FOREGROUND_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
}

async function generateIcons() {
  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error('源图片未找到:', SOURCE_IMAGE)
    process.exit(1)
  }

  console.log('正在使用用户图片生成 Android 应用图标...')

  // 1. 生成方形启动图标
  for (const [density, size] of Object.entries(SIZES)) {
    const dir = path.join(RES_DIR, `mipmap-${density}`)
    fs.mkdirSync(dir, { recursive: true })

    await sharp(SOURCE_IMAGE)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'))

    // 圆形图标
    const circleMask = Buffer.from(
      `<svg><rect width="${size}" height="${size}" rx="${size / 2}" fill="white"/></svg>`
    )
    await sharp(SOURCE_IMAGE)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .composite([{ input: await sharp(circleMask).resize(size, size).png().toBuffer(), blend: 'dest-in' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'))

    console.log(`  ✓ mipmap-${density} (${size}x${size})`)
  }

  // 2. 生成 adaptive icon 前景层
  for (const [density, size] of Object.entries(FOREGROUND_SIZES)) {
    const dir = path.join(RES_DIR, `mipmap-${density}`)
    const innerSize = Math.round(size * 0.6) // 108dp 中安全区域约 66dp
    const offset = Math.round((size - innerSize) / 2)

    await sharp(SOURCE_IMAGE)
      .resize(innerSize, innerSize, { fit: 'cover', position: 'center' })
      .extend({
        top: offset,
        bottom: size - innerSize - offset,
        left: offset,
        right: size - innerSize - offset,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'))

    console.log(`  ✓ mipmap-${density} foreground (${size}x${size})`)
  }

  console.log('图标生成完成！')
}

generateIcons().catch((err) => {
  console.error('图标生成失败:', err)
  process.exit(1)
})