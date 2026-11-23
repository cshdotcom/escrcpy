/**
 * Image template matching ("智能识别") for scheduled tasks and workflows.
 *
 * Uses OpenCV.js (WASM, works in the main process) + sharp for decoding:
 * a screenshot from the device is matched against a previously captured
 * template with TM_CCOEFF_NORMED; when the score exceeds the threshold the
 * step can either proceed, tap the matched point (followMatchPoint), or
 * keep waiting (wait_image).
 *
 * Templates are stored as PNG files under <userData>/automation-templates/.
 */
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import sharp from 'sharp'

let cvPromise = null

/** Lazily load OpenCV (the WASM init takes ~1s and is reused afterwards). */
function loadOpenCV() {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then((mod) => {
      const cv = mod.default ?? mod
      // The module is a thenable Emscripten bundle.
      return Promise.resolve(cv).then(ready => ready)
    })
  }
  return cvPromise
}

export function getTemplatesDir() {
  const dir = path.join(app.getPath('userData'), 'automation-templates')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Persist a base64 PNG as a template; returns the absolute path. */
export function saveTemplate(name, base64) {
  const safe = String(name || `template-${Date.now()}`)
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.png$/i, '')
  const data = String(base64 || '').replace(/^data:image\/\w+;base64,/, '')
  if (!data)
    throw new Error('Template image data is empty')

  const file = path.join(getTemplatesDir(), `${safe}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

/** List stored templates (name + path + size). */
export function listTemplates() {
  const dir = getTemplatesDir()
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .map((f) => {
      const full = path.join(dir, f)
      return { name: f.replace(/\.png$/i, ''), path: full, size: fs.statSync(full).size }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function toGrayMat(imagePathOrBuffer) {
  const { data, info } = await sharp(imagePathOrBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const cv = await loadOpenCV()
  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1)
  mat.data.set(data)
  return { cv, mat }
}

/**
 * Match a template against an image.
 *
 * @param {object} options
 * @param {string|Buffer} options.source  screenshot (path or PNG buffer)
 * @param {string|Buffer} options.template template image (path or PNG buffer)
 * @param {number} [options.threshold=0.8] score required for a match (0..1)
 * @returns {{ matched: boolean, score: number, x: number, y: number, width: number, height: number }}
 */
export async function matchImageTemplate({ source, template, threshold = 0.8 }) {
  const [src, tpl] = await Promise.all([toGrayMat(source), toGrayMat(template)])
  try {
    const { cv } = src
    if (tpl.mat.cols > src.mat.cols || tpl.mat.rows > src.mat.rows)
      return { matched: false, score: 0, x: 0, y: 0, width: tpl.mat.cols, height: tpl.mat.rows }

    const result = new cv.Mat()
    cv.matchTemplate(src.mat, tpl.mat, result, cv.TM_CCOEFF_NORMED)
    const mm = cv.minMaxLoc(result)
    result.delete()

    return {
      matched: mm.maxVal >= Number(threshold) || 0,
      score: Number(mm.maxVal.toFixed(4)),
      x: mm.maxLoc.x,
      y: mm.maxLoc.y,
      width: tpl.mat.cols,
      height: tpl.mat.rows,
    }
  }
  finally {
    src.mat.delete()
    tpl.mat.delete()
  }
}

/** Take a screenshot on the device and match it against a template. */
export async function matchOnDevice(adbx, deviceId, templatePath, { threshold = 0.8 } = {}) {
  const png = await adbx.screencap(deviceId, { returnBase64: true })
  const buffer = Buffer.from(png, 'base64')
  return matchImageTemplate({ source: buffer, template: templatePath, threshold })
}
