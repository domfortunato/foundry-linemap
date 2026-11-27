#!/usr/bin/env node
// dev:export: export the map as PNG, WebP or PDF. The Line Map controls have an Export map button;
// its window takes the whole scene or a dragged area, a format, a size (1×, 2×, 4×), a background, and
// whether hidden objects go in. The image is drawn afresh, without the selection.
// - A whole-scene PNG has the scene's size; a dragged area's has the area's; 2× doubles both sides.
// - A red line's pixels are red where the line is (selected or not).
// - A hidden symbol is left out unless asked for. A white background leaves no transparent pixel.
// - WebP is WebP. The window's Export downloads the file; PDF opens the image for the print dialog.
// - No texture is left behind by an export.
import { clickAt, dragThrough, moduleWarnings, probe, probeScene, scaled, sweep, tool, until } from './lib.mjs'

const p = probe('dev:export', { watchdogMs: 360000 })

/** Export through the API and read the image back: its type, size, and pixels at image points. */
const exported = (page, opts, points = []) => page.evaluate(async ({ opts, points }) => {
  const sr = canvas.dimensions.sceneRect
  const o = { ...opts }
  if (o.rect) o.rect = { x: sr.x + o.rect.x, y: sr.y + o.rect.y, width: o.rect.width, height: o.rect.height }
  const blob = await game.modules.get('linemap').api.exportImage(o)
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const all = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  let transparent = 0
  for (let i = 3; i < all.length; i += 4) if (all[i] < 255) transparent++
  const at = points.map(([x, y]) => {
    const d = ctx.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data
    let best = [0, 0, 0, 0]
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > best[3]) best = [d[i], d[i + 1], d[i + 2], d[i + 3]]
    return best
  })
  return { type: blob.type, width: bmp.width, height: bmp.height, transparent, at, scene: [sr.width, sr.height] }
}, { opts, points })
const isRed = (px) => px && px[3] > 200 && px[0] > 140 && px[1] < 80 && px[2] < 80

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'export')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  // Map points are given from the scene's top-left corner.
  const ids = await gm.evaluate(async () => {
    const sr = canvas.dimensions.sceneRect
    const api = game.modules.get('linemap').api
    const [line, sym] = await api.add([
      api.line({ from: [sr.x + 200, sr.y + 300], to: [sr.x + 800, sr.y + 300], style: 'major', size: 3, color: '#d01010' }),
      api.symbol({ x: sr.x + 1000, y: sr.y + 300, symbol: 'major-settlement', size: 2, revealed: false })
    ])
    return { line, sym }
  })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.sym)
  await gm.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, ids.line)

  // The whole scene, 1×.
  const whole = await exported(gm, {}, [[500, 300], [1000, 300]])
  p.check(whole.type === 'image/png' && whole.width === whole.scene[0] && whole.height === whole.scene[1],
    'a whole-scene PNG has the scene\'s size', { type: whole.type, size: [whole.width, whole.height], scene: whole.scene })
  p.check(isRed(whole.at[0]), 'the selected red line is drawn red where it is (not in the selection colour)', whole.at[0])
  p.check(whole.at[1][3] < 30, 'the hidden symbol is left out', whole.at[1])

  // 2×, and hidden objects asked for.
  const double = await exported(gm, { scale: 2, hidden: true }, [[1000, 600], [2000, 600]])
  p.check(double.width === whole.width * 2 && double.height === whole.height * 2 && isRed(double.at[0]),
    '2× doubles both sides, the line where it should be', { size: [double.width, double.height], px: double.at[0] })
  p.check(double.at[1][3] > 200, 'with hidden objects asked for, the hidden symbol is drawn', double.at[1])

  // An area, on white.
  const part = await exported(gm, { rect: { x: 100, y: 200, width: 600, height: 300 }, background: 'white' }, [[400, 100]])
  p.check(part.width === 600 && part.height === 300 && isRed(part.at[0]) && part.transparent === 0,
    'an area exports at its size, the line in it, on white with no transparent pixel', { size: [part.width, part.height], px: part.at[0], transparent: part.transparent })

  const webp = await exported(gm, { type: 'image/webp', rect: { x: 0, y: 0, width: 400, height: 400 } })
  p.check(webp.type === 'image/webp', 'WebP is WebP', webp.type)

  // No texture left behind (the second of two identical exports).
  const leak = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const count = () => canvas.app.renderer.texture.managedTextures.length
    await api.exportImage({ scale: 2 })
    const before = count()
    await api.exportImage({ scale: 2 })
    await api.exportImage({ scale: 2 })
    return { before, after: count() }
  })
  p.check(leak.after <= leak.before, 'exports leave no texture behind', leak)

  // The window: a dragged area, then Export downloads a PNG.
  const button = gm.locator('#scene-controls [data-tool="linemapExport"]').first()
  const has = await button.count()
  if (has) await button.click()
  await gm.locator('#linemap-export').first().waitFor({ timeout: scaled(10000) }).catch(() => {})
  const opened = (await gm.locator('#linemap-export').count()) > 0
  p.check(has > 0 && opened, 'the Line Map controls have an Export map button that opens its window')
  if (!opened) throw new Error('no Export map window')
  await p.shot(gm, 'window')
  await gm.locator('#linemap-export [data-action="pick"]').first().click()
  await gm.waitForTimeout(scaled(600))
  const sr = await gm.evaluate(() => { const r = canvas.dimensions.sceneRect; return { x: r.x, y: r.y } })
  await dragThrough(gm, [{ x: sr.x + 150, y: sr.y + 150 }, { x: sr.x + 500, y: sr.y + 300 }, { x: sr.x + 850, y: sr.y + 450 }])
  await gm.waitForTimeout(scaled(800))
  const picked = await gm.evaluate(() => ({
    checked: document.querySelector('#linemap-export input[name="area"][value="picked"]')?.checked,
    pixels: document.querySelector('#linemap-export .linemap-export-pixels')?.textContent?.trim()
  }))
  p.check(picked.checked && /700\D+300/.test(picked.pixels ?? ''), 'dragging an area picks it: the window shows its size', picked)
  const [download] = await Promise.all([
    gm.waitForEvent('download', { timeout: scaled(20000) }),
    gm.locator('#linemap-export [data-action="export"]').first().click()
  ])
  const name = download.suggestedFilename()
  p.check(/\.png$/.test(name), 'Export downloads a PNG named after the scene', name)

  // PDF: the image in a window for the print dialog.
  await gm.evaluate(() => {
    window.__printDoc = document.implementation.createHTMLDocument('print')
    window.open = () => ({ document: window.__printDoc, print: () => {}, addEventListener: () => {} })
  })
  await gm.locator('#linemap-export select[name="format"]').first().selectOption('pdf')
  await gm.waitForTimeout(scaled(600))
  await gm.locator('#linemap-export [data-action="export"]').first().click()
  const pdf = await until(gm, () => {
    const d = window.__printDoc
    const img = d?.querySelector('img')
    return img && { src: img.src.slice(0, 5), page: /@page/.test(d.querySelector('style')?.textContent ?? '') }
  })
  p.check(!!pdf && pdf.src === 'blob:' && pdf.page, 'PDF opens the image alone on a page, for the print dialog', pdf)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
