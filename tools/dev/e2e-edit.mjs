#!/usr/bin/env node
// dev:edit: editing a map that is already drawn, as a Gamemaster does it.
// - The adjust tool: a shift-click adds a point to the selection, to an empty one too, and never
//   adds a point twice.
// - Undo: one Ctrl+Z takes back one label; two edits made in quick succession take two undos, one each.
// - Links: a line drawn from a symbol follows it when the symbol moves. Deleting the symbol leaves
//   the line's end where it was drawn last, in the layer, in the saved flag and after a reload.
import { at, clickAt, dragThrough, probe, probeScene, reload, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:edit', { watchdogMs: 300000 })
const near = (a, b, tol = 2) => !!a && !!b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
const selectedPoints = (page) => page.evaluate(() =>
  canvas.linemap.tools.adjustObject.selectedAdjustmentPoints.map(pt => `${pt.object.id}:${pt.index}`))
const shiftClick = async (page, point) => {
  await page.keyboard.down('Shift')
  try { await clickAt(page, point) } finally { await page.keyboard.up('Shift') }
}
const savedCount = (page) => page.evaluate(() => canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0)

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'edit')

  // The adjust tool's shift-click.
  const A = await at(page, 0.2, 0.2)
  const B = await at(page, 0.4, 0.2)
  await tool(page, 'drawSymbol')
  await clickAt(page, A)
  await clickAt(page, B)
  await tool(page, 'adjustObject')
  await clickAt(page, A)
  const s1 = await selectedPoints(page)
  await shiftClick(page, B)
  const s2 = await selectedPoints(page)
  p.check(s1.length === 1 && s2.length === 2, 'a click selects one point and a shift-click on another adds it', { s1, s2 })
  await shiftClick(page, A)
  const s3 = await selectedPoints(page)
  p.check(s3.length === 2 && new Set(s3).size === 2, 'a shift-click on a point already selected does not add it again', s3)
  await clickAt(page, await at(page, 0.8, 0.8))
  const s4 = await selectedPoints(page)
  await shiftClick(page, A)
  const s5 = await selectedPoints(page)
  p.check(s4.length === 0 && s5.length === 1, 'a shift-click with nothing selected adds the point', { s4, s5 })

  // Undo: one label, one Ctrl+Z.
  await page.evaluate(() => { canvas.linemap.clear(); canvas.linemap.redraw() })
  await until(page, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 0)
  await tool(page, 'selectObject')
  await writeLabel(page, await at(page, 0.5, 0.4), 'Undo Me Once')
  await until(page, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 1)
  await tool(page, 'selectObject')
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(800)
  const afterUndo = await page.evaluate(() => ({ layer: canvas.linemap.objects.length, saved: canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0 }))
  p.check(afterUndo.layer === 0 && afterUndo.saved === 0, 'one Ctrl+Z takes back a label just written', afterUndo)

  // Two edits in quick succession (the second starts before the first is saved), then one undo.
  const quick = await page.evaluate(async () => {
    const L = canvas.linemap
    const mk = (x, y) => {
      const data = { type: 'symbol', isRevealed: true, point: { point: [x, y] }, symbol: 'curiosity' }
      const o = CONFIG.linemap.objectTypes.symbol.create(data)
      o.deserialize({ ...data, id: o.id }, {})
      return o
    }
    const r = canvas.dimensions.sceneRect
    L.addObject(mk(r.x + 600, r.y + 1400))
    L.addObject(mk(r.x + 900, r.y + 1400))
    const end = Date.now() + 5000
    while ((canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) < 2 && Date.now() < end) await new Promise(r => setTimeout(r, 100))
    await new Promise(r => setTimeout(r, 500))
    await L.undo()
    const one = { layer: L.objects.length, saved: canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0 }
    await L.undo()
    const two = { layer: L.objects.length, saved: canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0 }
    return { one, two }
  })
  p.check(quick.one.layer === 1 && quick.one.saved === 1 && quick.two.layer === 0 && quick.two.saved === 0,
    'two quick edits take two undos, one each', quick)

  // Links: a symbol, a line drawn from it, the symbol moved, then deleted.
  const P = await at(page, 0.3, 0.6)
  const P2 = await at(page, 0.3, 0.4)
  const Q = await at(page, 0.6, 0.6)
  await tool(page, 'drawSymbol')
  await clickAt(page, P)
  await tool(page, 'drawLine')
  await dragThrough(page, [P, { x: (P.x + Q.x) / 2, y: P.y }, Q])
  const link = await page.evaluate(() => {
    const L = canvas.linemap
    const sym = L.objects.find(o => o.constructor.type === 'symbol')
    const line = L.objects.find(o => o.constructor.type === 'line')
    return { symbol: sym?.id, source: line?.points?.[0]?.sourceObject?.id ?? null }
  })
  p.check(link.symbol && link.source === link.symbol, "the line's first end is linked to the symbol it was drawn from", link)

  await tool(page, 'selectObject')
  await clickAt(page, P)
  await dragThrough(page, [P, { x: P.x, y: (P.y + P2.y) / 2 }, P2])
  const followed = await page.evaluate(() => canvas.linemap.objects.find(o => o.constructor.type === 'line')?.points[0].point)
  p.check(near(followed, [P2.x, P2.y], 3), "moving the symbol takes the line's end with it", { end: followed, symbolAt: P2 })

  await page.evaluate(() => document.activeElement?.blur?.())
  await page.keyboard.press('Delete')
  await until(page, () => !canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.some(o => o.type === 'symbol'))
  const deleted = await page.evaluate(() => {
    const L = canvas.linemap
    const line = L.objects.find(o => o.constructor.type === 'line')
    const saved = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    const ids = new Set(saved.map(o => o.id))
    const sl = saved.find(o => o.type === 'line')
    return {
      symbols: L.objects.filter(o => o.constructor.type === 'symbol').length,
      layerEnd: line?.points[0].point,
      layerLinked: !!line?.points[0].sourceObject,
      savedEnd: sl?.points?.[0]?.point,
      savedDangling: (sl?.points ?? []).some(pt => pt.sourceId && !ids.has(pt.sourceId))
    }
  })
  p.check(deleted.symbols === 0 && !deleted.layerLinked && near(deleted.layerEnd, [P2.x, P2.y], 3),
    "deleting the symbol unlinks the line's end and leaves it where it was", deleted)
  p.check(!deleted.savedDangling && near(deleted.savedEnd, [P2.x, P2.y], 3),
    'the saved line names no deleted object, and saves its end where it was', deleted)

  await reload(page)
  await viewScene(page, sceneId)
  const reloaded = await until(page, () => canvas.linemap.objects.find(o => o.constructor.type === 'line')?.points[0].point ?? null)
  p.check(near(reloaded, [P2.x, P2.y], 3), "after a reload the line's end is still where it was", { end: reloaded, expected: [P2.x, P2.y] })
} catch (err) {
  await p.threw(err)
}
await p.finish()
