#!/usr/bin/env node
// dev:copy: duplicate, copy and paste (ROADMAP 7.7).
// - Ctrl+C copies the selection with the links among the copied objects, and without links to
//   objects outside it (those points stay where they were). Ctrl+V pastes it centred on the pointer,
//   with new ids, selected, as one edit.
// - Two symbols, the line between them, a waypoint on it and a label on one symbol, copied to a
//   second Scene, are linked there, with new ids.
// - A line copied without the symbols at its ends is pasted with its ends pinned.
// - Ctrl+X cuts; Duplicate in the right-click menu copies the selection beside itself.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:copy', { watchdogMs: 300000 })

const A = { x: 600, y: 600 }
const B = { x: 1200, y: 600 }
const C = { x: 600, y: 1200 }
const LINE_AT = { x: 750, y: 600 }
const WAYPOINT = { x: 900, y: 600 }

const saved = (page) => page.evaluate(() => canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? [])
const shiftClick = async (page, point) => {
  await page.keyboard.down('Shift')
  try { await clickAt(page, point) } finally { await page.keyboard.up('Shift') }
}
/** Move the pointer over a canvas point (panned there), then press keys. */
const pressAt = async (page, point, keys) => {
  await page.evaluate((pt) => canvas.pan({ x: pt.x, y: pt.y, scale: 1 }), point)
  await page.waitForTimeout(scaled(300))
  const s = await page.evaluate((pt) => canvas.clientCoordinatesFromCanvas(pt), point)
  await page.mouse.move(s.x - 10, s.y - 10)
  await page.mouse.move(s.x, s.y, { steps: 3 })
  await page.waitForTimeout(150)
  await page.keyboard.press(keys)
  await page.waitForTimeout(scaled(700))
}
/** How the objects of a pasted group are linked, by type, in terms of the group's own ids. */
const shapeOf = (objects) => {
  const ids = new Set(objects.map(o => o.id))
  const sym = objects.filter(o => o.type === 'symbol')
  const line = objects.find(o => o.type === 'line')
  const wp = objects.find(o => o.type === 'waypoint')
  const label = objects.find(o => o.type === 'text')
  return {
    counts: objects.length,
    lineEnds: line ? [line.points[0].sourceId, line.points.at(-1).sourceId].map(id => sym.some(s => s.id === id)) : null,
    waypointOnLine: !!wp && wp.point.sourceId === line?.id,
    labelOnSymbol: !!label && sym.some(s => s.id === label.point.sourceId),
    linksInside: objects.every(o => JSON.stringify(o).match(/"sourceId":"([^"]+)"/g)?.every(m => ids.has(m.slice(12, -1))) ?? true)
  }
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'copy')
  const ids = await gm.evaluate(async ({ A, B, C }) => {
    const api = game.modules.get('linemap').api
    const [a, b, c] = await api.add([A, B, C].map(pt => api.symbol({ x: pt.x, y: pt.y, symbol: 'minor-site' })))
    const [ab, ca] = await api.add([api.line({ from: a, to: b }), api.line({ from: c, to: a })])
    const [wp, label] = await api.add([api.waypoint({ line: ab, t: 0.5 }), api.label({ text: 'Greyhaven', on: a })])
    return { a, b, c, ab, ca, wp, label }
  }, { A, B, C })
  const original = new Set(Object.values(ids))

  // Select A, B, the line between them and its waypoint (the label comes as a fifth: shift-click it too).
  await tool(gm, 'selectObject')
  await clickAt(gm, A)
  await shiftClick(gm, B)
  await shiftClick(gm, LINE_AT)
  await shiftClick(gm, WAYPOINT)
  await gm.evaluate((id) => {
    const L = canvas.linemap
    L.setSelection(...L.selection, L.objects.find(o => o.id === id))
  }, ids.label)
  const selected = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(selected.length === 5 && !selected.includes(ids.c) && !selected.includes(ids.ca), 'the two symbols, their line, its waypoint and the label are selected', selected)

  await pressAt(gm, { x: 900, y: 600 }, 'Control+c')
  const target = { x: 2000, y: 1400 }
  await pressAt(gm, target, 'Control+v')
  const afterPaste = await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 12)
  const all = await saved(gm)
  const pasted = all.filter(o => !original.has(o.id))
  p.check(!!afterPaste && pasted.length === 5, 'Ctrl+V pastes the five objects, with new ids', { total: all.length, pasted: pasted.map(o => o.type) })
  const shape = shapeOf(pasted)
  p.check(shape.lineEnds?.every(Boolean) && shape.waypointOnLine && shape.labelOnSymbol && shape.linksInside,
    'the pasted line links the pasted symbols, the waypoint is on the pasted line, the label on a pasted symbol, and nothing links outside', shape)
  const ps = pasted.filter(o => o.type === 'symbol').map(o => o.point.point)
  const centre = ps.length === 2 ? [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2] : null
  p.check(!!centre && Math.abs(ps[0][0] - ps[1][0]) === Math.abs(A.x - B.x) && Math.abs(centre[0] - target.x) < 120 && Math.abs(centre[1] - target.y) < 120,
    'the paste keeps its shape and is centred on the pointer', { ps, target })
  const sel = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id).sort())
  p.check(JSON.stringify(sel) === JSON.stringify(pasted.map(o => o.id).sort()), 'the pasted objects are selected', sel)
  const originals = all.filter(o => original.has(o.id))
  p.check(originals.find(o => o.id === ids.ca)?.points.at(-1).sourceId === ids.a, 'the originals are untouched: the line from the third symbol still links the first')

  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  const undone = await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 7)
  p.check(!!undone, 'one undo takes the paste back')

  // A second Scene.
  const second = await gm.evaluate(async (name) => {
    const scene = await foundry.documents.Scene.create({ name, width: 3000, height: 2000, padding: 0, grid: { type: 0 }, navigation: false })
    return scene.id
  }, `${PROBE_TAG} copy 2`)
  p.cleanup(() => gm.evaluate(async (id) => { await game.scenes.get(id)?.delete() }, second))
  await viewScene(gm, second)
  await tool(gm, 'selectObject')
  await pressAt(gm, { x: 1500, y: 1000 }, 'Control+v')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 5)
  const there = await saved(gm)
  const thereShape = shapeOf(there)
  p.check(there.length === 5 && there.every(o => !original.has(o.id)) && thereShape.lineEnds?.every(Boolean) && thereShape.waypointOnLine && thereShape.labelOnSymbol && thereShape.linksInside,
    'pasted into a second Scene, the objects are linked there, with new ids', thereShape)
  const third = await gm.evaluate(async () => { const L = canvas.linemap; return L.objects.length })
  await pressAt(gm, { x: 1500, y: 1500 }, 'Control+v')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 10)
  const twice = await saved(gm)
  p.check(third === 5 && new Set(twice.map(o => o.id)).size === 10, 'pasted again, it gets new ids again', twice.length)

  // A line alone: its ends are pinned.
  await viewScene(gm, (await gm.evaluate(() => game.scenes.find(s => s.name.endsWith('] copy'))?.id)))
  await tool(gm, 'selectObject')
  await clickAt(gm, LINE_AT)
  await pressAt(gm, LINE_AT, 'Control+c')
  await pressAt(gm, { x: 2000, y: 400 }, 'Control+v')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 8)
  const lone = (await saved(gm)).filter(o => !original.has(o.id))
  p.check(lone.length === 1 && lone[0].type === 'line' && lone[0].points.every(pt => pt.sourceId === null && Array.isArray(pt.point)),
    'a line copied without the symbols at its ends is pasted with its ends pinned', lone)

  // Cut.
  await clickAt(gm, C)
  await pressAt(gm, C, 'Control+x')
  const cut = await saved(gm)
  p.check(!cut.some(o => o.id === ids.c) && cut.find(o => o.id === ids.ca)?.points[0].sourceId === null, 'Ctrl+X removes the symbol, pinning the line that was linked to it', cut.length)
  await pressAt(gm, { x: 2400, y: 1600 }, 'Control+v')
  const back = await saved(gm)
  p.check(back.length === cut.length + 1 && back.some(o => o.type === 'symbol' && Math.abs(o.point.point[0] - 2400) < 4), 'and Ctrl+V puts it down where the pointer is', back.length)

  // Duplicate from the menu.
  await clickAt(gm, B)
  await clickAt(gm, B, { button: 'right' })
  const dup = gm.locator('.linemap-menu [data-option="duplicate"]').first()
  const hasDup = await dup.count()
  if (hasDup) await dup.click()
  await gm.waitForTimeout(scaled(700))
  const dupd = await saved(gm)
  const copyOfB = dupd.find(o => o.type === 'symbol' && !back.some(b => b.id === o.id))
  const selNow = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(!!hasDup && !!copyOfB && copyOfB.point.point[0] > B.x && copyOfB.point.point[1] > B.y && JSON.stringify(selNow) === JSON.stringify([copyOfB.id]),
    'Duplicate in the menu puts a copy beside the symbol, selected', { copyOfB, selNow })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
