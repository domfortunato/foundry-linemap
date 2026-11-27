#!/usr/bin/env node
// dev:curves: freehand curved lines and the dotted line style (ROADMAP step 3).
// - With Freehand on, a drag makes one line through many points, drawn as a smooth curve, its two
//   ends linked to the symbols it starts and ends on.
// - Its pixels follow the curve, not the straight chord between its ends.
// - A waypoint drawn on the curve snaps onto it, and the curve's end follows its symbol when moved.
// - The dotted style draws dots with gaps between them.
// - A curve survives a reload, and undo takes one back.
import { at, clickAt, dragThrough, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:curves', { watchdogMs: 300000 })
/** Opaque pixels the layer rendered in a square around a canvas point. */
const opaqueAt = (page, pt, half = 15) => page.evaluate(({ pt, half }) => {
  const L = canvas.linemap
  if (!L.renderTexture) return -1
  const data = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(pt.x - half, pt.y - half, half * 2, half * 2))
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 200) n++
  return n
}, { pt, half })
const lines = (page) => page.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type === 'line').map(o => o.serialized))
const barButton = (page, sel) => page.locator(`#ui-top ${sel}`).first()

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'curves')

  // Two symbols, then a freehand arc from one to the other (narrow enough that the drag stays clear of
  // the scene controls: leaving the canvas cancels a drag).
  const A = await at(page, 0.25, 0.55)
  const B = await at(page, 0.65, 0.55)
  await tool(page, 'drawSymbol')
  await clickAt(page, A)
  await clickAt(page, B)
  const [aId, bId] = await page.evaluate(() => canvas.linemap.objects.map(o => o.id))
  await tool(page, 'drawLine')
  const toggle = barButton(page, '[data-action="toggle-freehand"]')
  const hasToggle = await toggle.count() > 0
  p.check(hasToggle, "the line tool's options bar has a Freehand toggle")
  if (hasToggle) await toggle.click()
  await page.waitForTimeout(scaled(300))
  const arc = []
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 - i / 10)
    arc.push({ x: Math.round((A.x + B.x) / 2 + Math.cos(a) * (B.x - A.x) / 2), y: Math.round(A.y - Math.sin(a) * (B.x - A.x) / 2 * 0.6) })
  }
  await dragThrough(page, arc)
  await page.waitForTimeout(scaled(600))
  const [curve] = await lines(page)
  p.check(curve && curve.smooth === true && curve.points.length >= 4,
    'a freehand drag makes one smooth line through many points', curve && { smooth: curve.smooth, points: curve.points.length })
  p.check(curve && curve.points[0].sourceId === aId && curve.points.at(-1).sourceId === bId,
    'its ends are linked to the symbols it starts and ends on', curve && { first: curve.points[0].sourceId, last: curve.points.at(-1).sourceId, aId, bId })
  const apex = arc[5]
  const chordMid = { x: Math.round((A.x + B.x) / 2), y: A.y }
  const onCurve = await opaqueAt(page, apex)
  const onChord = await opaqueAt(page, chordMid)
  p.check(onCurve > 0 && onChord === 0, "its pixels follow the curve, not the straight chord", { onCurve, onChord })

  // A waypoint on the curve; the curve's end following its symbol.
  await tool(page, 'drawWaypoint')
  await clickAt(page, apex)
  const wp = await page.evaluate(() => {
    const w = canvas.linemap.objects.find(o => o.constructor.type === 'waypoint')
    return w && { sourceId: w.point.sourceObject?.id ?? null, point: w.point.point }
  })
  p.check(wp && wp.sourceId === curve?.id && Math.hypot(wp.point[0] - apex.x, wp.point[1] - apex.y) < 10,
    'a waypoint drawn on the curve snaps onto it', { wp, apex, curve: curve?.id })
  const follows = await page.evaluate(({ aId, cId }) => {
    const L = canvas.linemap
    const a = L.objects.find(o => o.id === aId)
    const [x, y] = a.point.point
    a.point.unconstrainedPoint = [x, y + 60]
    L.redraw()
    const c = L.objects.find(o => o.id === cId)
    const first = c.points[0].point
    const out = { first, symbol: a.point.point }
    a.point.unconstrainedPoint = [x, y]
    L.redraw()
    return out
  }, { aId, cId: curve?.id })
  p.check(Math.hypot(follows.first[0] - follows.symbol[0], follows.first[1] - follows.symbol[1]) < 1, "the curve's end follows its symbol when the symbol moves", follows)

  // Dotted.
  await tool(page, 'drawLine')
  const dotted = barButton(page, '[data-line-style="dotted"]')
  const hasDotted = await dotted.count() > 0
  p.check(hasDotted, 'the line tool offers a dotted style')
  if (hasDotted) await dotted.click()
  if (hasToggle) await toggle.click()
  await page.waitForTimeout(scaled(300))
  const D0 = await at(page, 0.15, 0.85)
  const D1 = await at(page, 0.65, 0.85)
  await dragThrough(page, [D0, D1])
  await page.waitForTimeout(scaled(600))
  const dotLine = (await lines(page)).find(l => l.style === 'dotted')
  const runs = await page.evaluate(({ D0, D1 }) => {
    const L = canvas.linemap
    if (!L.renderTexture) return -1
    const data = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(D0.x + 40, D0.y - 1, D1.x - D0.x - 80, 3))
    const w = D1.x - D0.x - 80
    let changes = 0
    let prev = null
    for (let x = 0; x < w; x++) {
      const on = data[(w + x) * 4 + 3] >= 200
      if (prev !== null && on !== prev) changes++
      prev = on
    }
    return changes
  }, { D0, D1 })
  p.check(dotLine && !dotLine.smooth && runs >= 10, 'a dotted line is dots with gaps between them', { saved: !!dotLine, changes: runs })

  // Reload and undo.
  await reload(page)
  await viewScene(page, sceneId)
  const back = (await lines(page)).find(l => l.id === curve?.id)
  p.check(back && back.smooth === true && back.points.length === curve.points.length && back.points[0].sourceId === aId,
    'the curve is the same after a reload, links and all', back && { smooth: back.smooth, points: back.points.length })
  // Not at the apex: the waypoint drawn there would light those pixels on its own.
  p.check(await opaqueAt(page, arc[3]) > 0, 'and is still drawn along the curve', await opaqueAt(page, arc[3]))
  await tool(page, 'drawLine')
  if (await toggle.count()) await toggle.click()
  await page.waitForTimeout(scaled(300))
  const before = (await lines(page)).length
  await dragThrough(page, [await at(page, 0.3, 0.2), await at(page, 0.4, 0.1), await at(page, 0.5, 0.2), await at(page, 0.6, 0.1)])
  await page.waitForTimeout(scaled(500))
  const drawn = (await lines(page)).length
  await page.evaluate(() => canvas.linemap.undo())
  await page.waitForTimeout(scaled(800))
  const undone = await page.evaluate(() => ({
    canvas: canvas.linemap.objects.filter(o => o.constructor.type === 'line').length,
    saved: (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).filter(o => o.type === 'line').length
  }))
  p.check(drawn === before + 1 && undone.canvas === before && undone.saved === before, 'undo takes a freehand line back', { before, drawn, undone })
} catch (err) {
  await p.threw(err)
}
await p.finish()
