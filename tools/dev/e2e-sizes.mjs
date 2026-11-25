#!/usr/bin/env node
// dev:sizes: a size per symbol, waypoint and label (ROADMAP step 4).
// - A symbol or waypoint has a size from 1 to 4, saved as null at 1; a label has one from 0.5 to 4.
// - The right-click menu has a size slider; ] and [ grow and shrink the selection.
// - A symbol at size 4 is four times as wide in pixels, and sharp: its texture is rasterised for the
//   size, so its edges are no softer than its own art's at that size.
// - Its footprint, selection box and snap radius grow with it; a line linked to it still meets it,
//   and a label linked to it stays clear of it when it grows.
// - A size survives a reload, and undo takes one back.
import { at, clickAt, dragThrough, probe, probeScene, reload, scaled, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:sizes', { watchdogMs: 300000 })

/** The bounding box and edge softness of what the layer drew in a square around a canvas point. */
const drawnAt = (page, pt, half) => page.evaluate(({ pt, half }) => {
  const L = canvas.linemap
  if (!L.renderTexture) return null
  const data = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(pt.x - half, pt.y - half, half * 2, half * 2))
  let minX = Infinity; let maxX = -Infinity; let any = 0; let soft = 0
  for (let y = 0; y < half * 2; y++) {
    for (let x = 0; x < half * 2; x++) {
      const a = data[(y * half * 2 + x) * 4 + 3]
      if (a > 8) { any++; if (a < 240) soft++ }
      if (a >= 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x) }
    }
  }
  return { width: any ? maxX - minX + 1 : 0, soft: any ? soft / any : 0 }
}, { pt, half })

/**
 * The edge softness of the symbol's art drawn the old way, from the texture rasterised at its native
 * size and scaled up, at the scale the object is drawn at: what a blurred big symbol looks like.
 */
const blurredSoftness = (page, id, half) => page.evaluate(({ id, half }) => {
  const L = canvas.linemap
  const o = L.objects.find(o => o.id === id)
  const tex = o && L.symbolTextures[o.symbol]?.icon
  const scale = o?.sprite?.scale?.x
  if (!tex || !scale) return null
  const rt = PIXI.RenderTexture.create({ width: half * 2, height: half * 2 })
  const s = new PIXI.Sprite(tex)
  s.anchor.set(0.5); s.x = half; s.y = half; s.scale.set(scale)
  canvas.app.renderer.render(s, { renderTexture: rt, clear: true })
  const data = canvas.app.renderer.extract.pixels(rt)
  s.destroy(); rt.destroy(true)
  let any = 0; let soft = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) { any++; if (data[i] < 240) soft++ }
  return any ? soft / any : 0
}, { id, half })

const saved = (page, id) => page.evaluate((id) => {
  const o = (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)
  return o ? { has: 'size' in o, size: o.size } : null
}, id)
const live = (page, id) => page.evaluate((id) => {
  const o = canvas.linemap.objects.find(o => o.id === id)
  return o && { size: o.size, width: o.sprite?.width ?? 0, height: o.sprite?.height ?? 0, offset: o.offset, point: o.point?.point, selected: o.isSelected }
}, id)
const newest = (page, type) => page.evaluate((type) => canvas.linemap.objects.filter(o => o.constructor.type === type).at(-1)?.id, type)
const select = (page, id) => page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, id)
const sizeSlider = (page) => page.locator('.linemap-menu input[type="range"][name="size"]')

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'sizes')

  const A = await at(page, 0.15, 0.25)
  const B = await at(page, 0.45, 0.25)
  const C = await at(page, 0.45, 0.65)
  const D = await at(page, 0.85, 0.65)
  await tool(page, 'drawSymbol')
  for (const pt of [A, B, C, D]) await clickAt(page, pt)
  const [aId, bId, cId, dId] = await page.evaluate(() => canvas.linemap.objects.map(o => o.id))
  await tool(page, 'drawLine')
  await dragThrough(page, [C, D])
  const lineId = await newest(page, 'line')
  // A's pixels at size 1, before a label sits above it.
  await page.waitForTimeout(scaled(400))
  const small = await drawnAt(page, A, 60)
  // A label on A, linked to it, before A grows.
  await writeLabel(page, A, 'Above')
  const labelA = await newest(page, 'text')
  await page.waitForTimeout(scaled(400))

  const a = await saved(page, aId)
  p.check(a?.has && a.size === null, 'a symbol at size 1 is saved with size null', a)

  // B to 4 with the right-click menu's slider.
  await tool(page, 'selectObject')
  await clickAt(page, B)
  await clickAt(page, B, { button: 'right' })
  const slider = sizeSlider(page)
  const hasSlider = await slider.count() > 0
  p.check(hasSlider, 'the right-click menu has a size slider')
  if (hasSlider) await slider.fill('4')
  else await page.evaluate((id) => { const o = canvas.linemap.objects.find(o => o.id === id); o.size = 4; canvas.linemap.registerHistory(); canvas.linemap.redraw() }, bId)
  await page.mouse.move(10, 10)
  await until(page, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === 4, bId, { timeout: 5000 })
  p.check((await saved(page, bId))?.size === 4, 'the slider sets the size, and it is saved', await saved(page, bId))

  // Four times as wide, and sharp.
  await page.waitForTimeout(scaled(800))
  const big = await drawnAt(page, B, 160)
  const ratio = small?.width ? big.width / small.width : 0
  p.check(ratio > 3.6 && ratio < 4.4, 'a symbol at size 4 is four times as wide in pixels', { small, big, ratio })
  const blurred = await blurredSoftness(page, bId, 160)
  p.check(big && blurred && big.soft < 0.7 * blurred, "and sharp: its edges are harder than its native art's scaled up", { soft: big?.soft, blurred })

  // The selection box grows: a click well outside a size-1 symbol but inside the big one selects it.
  await page.evaluate(() => canvas.linemap.setSelection())
  await clickAt(page, { x: B.x + 70, y: B.y })
  p.check((await live(page, bId))?.selected, 'a click inside the big symbol, away from its centre, selects it', await live(page, bId))

  // C to 4 with ], six presses of 0.5; then its line, footprint and snap radius.
  await select(page, cId)
  for (let i = 0; i < 6; i++) { await page.keyboard.press('BracketRight'); await page.waitForTimeout(scaled(120)) }
  await page.waitForTimeout(scaled(800))
  p.check((await saved(page, cId))?.size === 4, '] grows the selection half a size at a time, up to 4', await saved(page, cId))
  await page.keyboard.press('BracketRight')
  await page.waitForTimeout(scaled(400))
  p.check((await live(page, cId))?.size === 4, 'and no further than 4', await live(page, cId))
  const link = await page.evaluate(({ lineId }) => canvas.linemap.objects.find(o => o.id === lineId)?.serialized.points[0].sourceId, { lineId })
  // The sprite's width: C's pixels run on into its line.
  const cWidth = (await live(page, cId))?.width ?? 0
  const outside = await drawnAt(page, { x: C.x + cWidth / 2 + 10, y: C.y }, 4)
  p.check(link === cId && cWidth > 150 && outside?.width > 0, 'its line is still linked to it and meets its edge', { link, cId, cWidth, outside })
  const masked = await page.evaluate(({ x, y }) => {
    const L = canvas.linemap
    const data = canvas.app.renderer.extract.pixels(L.maskTexture, new PIXI.Rectangle(x, y - 1, 2, 2))
    return data[3]
  }, { x: C.x + 40, y: C.y })
  p.check(masked > 128, "its footprint grows with it, keeping the line out from under it", { alphaAt40px: masked })
  await page.evaluate(() => canvas.linemap.setSelection())
  await tool(page, 'drawLine')
  const E = { x: C.x, y: C.y + 400 }
  await dragThrough(page, [{ x: C.x + 50, y: C.y + 30 }, E])
  const snapped = await page.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type === 'line').at(-1)?.serialized.points[0].sourceId)
  p.check(snapped === cId, 'a line started 58 px from its centre snaps to it (the snap radius grows too)', { snapped, cId })

  // A grows to 2: its label moves up to stay clear of it.
  await tool(page, 'selectObject')
  await select(page, aId)
  await page.keyboard.press('BracketRight')
  await page.keyboard.press('BracketRight')
  await page.waitForTimeout(scaled(800))
  const aNow = await live(page, aId)
  const label = await live(page, labelA)
  const labelBottom = label && A.y + label.offset[1] + label.height / 2
  const symbolTop = aNow && A.y - aNow.height / 2
  p.check(aNow?.size === 2 && labelBottom < symbolTop, "a label linked to a symbol stays clear of it when it grows", { size: aNow?.size, labelBottom, symbolTop })

  // A free label to 2 with ]; down to 0.5 with [.
  const F = await at(page, 0.15, 0.85)
  await writeLabel(page, F, 'Free')
  const free = await newest(page, 'text')
  await tool(page, 'selectObject')
  await select(page, free)
  const w1 = (await live(page, free))?.width ?? 0
  await page.keyboard.press('BracketRight')
  await page.keyboard.press('BracketRight')
  await page.waitForTimeout(scaled(600))
  const w2 = (await live(page, free))?.width ?? 0
  p.check(w1 > 0 && w2 / w1 > 1.8 && w2 / w1 < 2.2 && (await saved(page, free))?.size === 2, 'a label at size 2 is twice as wide', { w1, w2, saved: await saved(page, free) })
  for (let i = 0; i < 5; i++) await page.keyboard.press('BracketLeft')
  await page.waitForTimeout(scaled(600))
  p.check((await live(page, free))?.size === 0.5, '[ shrinks a label down to 0.5', await live(page, free))

  // A waypoint on C-D to 2 with the slider; undo takes it back.
  const W = await at(page, 0.68, 0.65)
  await tool(page, 'drawWaypoint')
  await clickAt(page, W)
  const wp = await newest(page, 'waypoint')
  await tool(page, 'selectObject')
  await select(page, wp)
  const wpBefore = (await live(page, wp))?.width ?? 0
  await clickAt(page, W, { button: 'right' })
  if (await sizeSlider(page).count()) await sizeSlider(page).fill('2')
  await page.mouse.move(10, 10)
  await page.waitForTimeout(scaled(800))
  const wpAfter = await live(page, wp)
  p.check(wpBefore > 0 && wpAfter?.size === 2 && wpAfter.width / wpBefore > 1.8 && wpAfter.width / wpBefore < 2.2, 'a waypoint at size 2 is twice as wide', { wpBefore, wpAfter })
  await page.evaluate(() => canvas.linemap.undo())
  await page.waitForTimeout(scaled(800))
  const undone = { live: await live(page, wp), saved: await saved(page, wp) }
  p.check(undone.live?.size === 1 && undone.saved?.size === null && Math.abs(undone.live.width - wpBefore) < 1, 'undo takes a size change back in one step', undone)

  // Reload.
  await reload(page)
  await viewScene(page, sceneId)
  await page.waitForTimeout(scaled(800))
  const afterReload = { b: await live(page, bId), drawn: await drawnAt(page, B, 160) }
  p.check(afterReload.b?.size === 4 && big?.width > 0 && Math.abs(afterReload.drawn.width - big.width) <= 2 && afterReload.drawn.soft < 0.7 * blurred,
    'a big symbol is the same size, and as sharp, after a reload', { size: afterReload.b?.size, before: big, after: afterReload.drawn })
  const relink = await page.evaluate(({ lineId }) => canvas.linemap.objects.find(o => o.id === lineId)?.serialized.points[0].sourceId, { lineId })
  p.check(relink === cId, 'and its line still linked to it', { relink, cId })
} catch (err) {
  await p.threw(err)
}
await p.finish()
