#!/usr/bin/env node
// dev:order: bring to front and send to back, for any object, within its group (images, areas,
// lines, symbols and labels keep their stacking: an area never goes over a line by this).
// - Two overlapping solid areas: the newer covers the older. "Bring to front" on the older puts it on
//   top, saved with the highest order; "Send to back" puts it under again.
// - Two crossing lines likewise. Two selected objects brought to front keep their order between them.
// - One undo takes a change back; it survives a reload.
import { clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:order', { watchdogMs: 300000 })

const RED = '#b3261e'
const BLUE = '#1f5fa8'
const GREEN = '#2e7d32'
const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]

const sortOf = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.sort, id)
/** The most common opaque colour of the drawn map in a small box. */
const colorAt = (page, pt, r = 4) => page.evaluate(({ pt, r }) => {
  const px = canvas.app.renderer.extract.pixels(canvas.linemap.renderTexture, new PIXI.Rectangle(Math.round(pt.x - r), Math.round(pt.y - r), 2 * r, 2 * r))
  const counts = new Map()
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue
    const key = '#' + [px[i], px[i + 1], px[i + 2]].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0').slice(-2)).join('')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = null, n = 0
  for (const [k, c] of counts) if (c > n) { best = k; n = c }
  return best
}, { pt, r })
const near = (drawn, want, tol = 32) => {
  if (!drawn) return false
  const a = [1, 3, 5].map(i => parseInt(drawn.slice(i, i + 2), 16))
  const b = [1, 3, 5].map(i => parseInt(want.slice(i, i + 2), 16))
  return a.every((v, i) => Math.abs(v - b[i]) <= tol)
}
const select = (page, ...ids) => page.evaluate((ids) => { const L = canvas.linemap; L.setSelection(...L.objects.filter(o => ids.includes(o.id))) }, ids)
const deselect = async (page) => { await page.evaluate(() => canvas.linemap.setSelection()); await page.waitForTimeout(scaled(400)) }
/** Right-click at a point with these objects selected, and pick a menu option; whether it was there. */
const menuPick = async (page, point, option, ...ids) => {
  await select(page, ...ids)
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
  const item = page.locator(`.linemap-menu [data-option="${option}"]`).first()
  const has = await item.count()
  if (has) await item.click()
  await page.waitForTimeout(scaled(600))
  return has > 0
}
const sortChanged = (page, id, before) => until(page, ({ id, before }) =>
  (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.sort !== before, { id, before }, { timeout: 10000 })

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'order')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  const ids = await gm.evaluate(async ({ RED, BLUE, GREEN, a, b, c }) => {
    const api = game.modules.get('linemap').api
    const [areaRed, areaBlue, areaGreen] = await api.add([
      api.area({ points: a, pattern: 'solid', opacity: 1, color: RED }),
      api.area({ points: b, pattern: 'solid', opacity: 1, color: BLUE }),
      api.area({ points: c, pattern: 'solid', opacity: 1, color: GREEN })
    ])
    const [lineRed, lineBlue] = await api.add([
      api.line({ from: [600, 1500], to: [1400, 1500], style: 'major', size: 4, color: RED }),
      api.line({ from: [1000, 1200], to: [1000, 1800], style: 'major', size: 4, color: BLUE })
    ])
    return { areaRed, areaBlue, areaGreen, lineRed, lineBlue }
  }, { RED, BLUE, GREEN, a: rect(600, 400, 1000, 800), b: rect(800, 600, 1200, 1000), c: rect(1100, 400, 1500, 800) })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.lineBlue)
  await deselect(gm)

  // Areas: red under blue where they overlap.
  const overlap = { x: 900, y: 700 }
  const before = await colorAt(gm, overlap)
  p.check(near(before, BLUE), 'the newer blue area covers the older red one', before)
  const redSort = await sortOf(gm, ids.areaRed)
  const front = await menuPick(gm, { x: 700, y: 500 }, 'bringToFront', ids.areaRed)
  await p.shot(gm, 'front')
  await sortChanged(gm, ids.areaRed, redSort)
  await deselect(gm)
  const afterFront = await colorAt(gm, overlap)
  const sorts = await gm.evaluate(() => Math.max(...(canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).map(o => o.sort)))
  p.check(front && near(afterFront, RED) && (await sortOf(gm, ids.areaRed)) === sorts,
    "the menu's Bring to front puts the red area on top, saved with the highest order", { front, afterFront })
  const frontSort = await sortOf(gm, ids.areaRed)
  const back = await menuPick(gm, { x: 700, y: 500 }, 'sendToBack', ids.areaRed)
  await sortChanged(gm, ids.areaRed, frontSort)
  await deselect(gm)
  const afterBack = await colorAt(gm, overlap)
  p.check(back && near(afterBack, BLUE), 'Send to back puts it under the blue one again', { back, afterBack })

  // One undo.
  const backSort = await sortOf(gm, ids.areaRed)
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await sortChanged(gm, ids.areaRed, backSort)
  await deselect(gm)
  p.check(near(await colorAt(gm, overlap), RED), 'one undo puts it back on top')
  await gm.evaluate(async () => { await game.modules.get('linemap').api.redo() })
  await gm.waitForTimeout(scaled(600))

  // Two selected keep their order: green over blue at their overlap (green is newer), both over red.
  const greenBlue = { x: 1150, y: 700 }
  const blueSort = await sortOf(gm, ids.areaBlue)
  await menuPick(gm, { x: 1050, y: 900 }, 'bringToFront', ids.areaBlue, ids.areaGreen)
  await sortChanged(gm, ids.areaBlue, blueSort)
  await deselect(gm)
  const both = { greenBlue: await colorAt(gm, greenBlue), redBlue: await colorAt(gm, overlap) }
  const order = { red: await sortOf(gm, ids.areaRed), blue: await sortOf(gm, ids.areaBlue), green: await sortOf(gm, ids.areaGreen) }
  p.check(near(both.greenBlue, GREEN) && near(both.redBlue, BLUE) && order.green > order.blue && order.blue > order.red,
    'two areas brought to front together keep their order between them', { both, order })

  // Lines: the blue line crosses over the red one; bring the red to front.
  const crossing = { x: 1000, y: 1500 }
  const lineBefore = await colorAt(gm, crossing, 3)
  const lineRedSort = await sortOf(gm, ids.lineRed)
  const lineFront = await menuPick(gm, { x: 750, y: 1500 }, 'bringToFront', ids.lineRed)
  await sortChanged(gm, ids.lineRed, lineRedSort)
  await deselect(gm)
  const lineAfter = await colorAt(gm, crossing, 3)
  p.check(lineFront && near(lineBefore, BLUE) && near(lineAfter, RED), 'a line brought to front crosses over the other', { lineBefore, lineAfter })

  // Areas stay under lines whatever their order.
  const lateArea = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [id] = await api.add(api.area({ points: [[900, 1400], [1100, 1400], [1100, 1600], [900, 1600]], pattern: 'solid', opacity: 1, color: '#2e7d32' }))
    return id
  })
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), lateArea)
  await deselect(gm)
  p.check(near(await colorAt(gm, crossing, 3), RED), 'a newer area is still drawn under the lines (order is within a group)')

  // Symbols: an uncoloured one brought in front of a newer red one (each colour is painted apart).
  const syms = await gm.evaluate(async (RED) => {
    const api = game.modules.get('linemap').api
    const [plain] = await api.add(api.symbol({ x: 1800, y: 1500, symbol: 'major-settlement', size: 3 }))
    const [red] = await api.add(api.symbol({ x: 1810, y: 1500, symbol: 'major-settlement', size: 3, color: RED }))
    return { plain, red }
  }, RED)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, syms.red)
  await deselect(gm)
  const content = await gm.evaluate(() => canvas.linemap.color)
  const symPt = { x: 1805, y: 1500 }
  const symBefore = await colorAt(gm, symPt, 6)
  const plainSort = await sortOf(gm, syms.plain)
  const symFront = await menuPick(gm, { x: 1795, y: 1500 }, 'bringToFront', syms.plain)
  await sortChanged(gm, syms.plain, plainSort)
  await deselect(gm)
  const symAfter = await colorAt(gm, symPt, 6)
  p.check(symFront && near(symBefore, RED) && near(symAfter, content), 'an uncoloured symbol brought to front is drawn over a red one', { symBefore, symAfter, content })

  await gm.evaluate(() => canvas.pan({ x: 1200, y: 1100, scale: 0.5 }))
  await gm.waitForTimeout(scaled(500))
  await p.shot(gm, 'order')

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.lineBlue)
  await gm.waitForTimeout(scaled(500))
  p.check(near(await colorAt(gm, greenBlue), GREEN) && near(await colorAt(gm, crossing, 3), RED), 'the order is the same after a reload')

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
