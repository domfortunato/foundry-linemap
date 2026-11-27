#!/usr/bin/env node
// dev:corners: an area drawn corner by corner. With the area tool, a click on empty map places the
// first corner and each click the next, with a preview to the pointer; a double-click, Enter or a click
// on the first corner finishes (3 corners at least); Backspace takes back a corner; Escape cancels.
// A drag still draws a rectangle, and an existing area's corners are edited as before.
import { clickAt, dragThrough, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:corners', { watchdogMs: 360000 })

const areas = (page) => page.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).filter(o => o.type === 'area'))
const round = (pts) => (pts ?? []).map(pt => pt.map(Math.round))
const newArea = async (page, before) => {
  const got = await until(page, (n) => {
    const a = (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).filter(o => o.type === 'area')
    return a.length > n ? a[a.length - 1] : null
  }, before, { timeout: 8000 }).catch(() => null)
  return got || null
}
const previewCount = (page) => page.evaluate(() => canvas.linemap.preview?.children?.length ?? 0)
const clicks = async (page, points) => { for (const pt of points) await clickAt(page, pt) }

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'corners')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  await tool(gm, 'drawArea')
  await gm.waitForTimeout(scaled(600))
  const pattern = await gm.evaluate(() => {
    const b = document.querySelector('#linemap-tool-options [data-area-pattern="dots"]')
    b?.click()
    return b ? 'dots' : null
  })
  await gm.waitForTimeout(scaled(300))

  // A trapezoid: three clicks and a double-click.
  const trapezoid = [[700, 900], [1500, 900], [1300, 500], [900, 500]]
  let n = (await areas(gm)).length
  await clicks(gm, trapezoid.slice(0, 2).map(([x, y]) => ({ x, y })))
  const drafting = await previewCount(gm)
  await clickAt(gm, { x: trapezoid[2][0], y: trapezoid[2][1] })
  await gm.mouse.move(400, 300)
  await gm.waitForTimeout(scaled(200))
  await p.shot(gm, 'drafting')
  await clickAt(gm, { x: trapezoid[3][0], y: trapezoid[3][1] }, { clicks: 2 })
  const trap = await newArea(gm, n)
  p.check(drafting > 0, 'after two clicks the tool shows a preview', drafting)
  p.check(!!trap && JSON.stringify(round(trap.points)) === JSON.stringify(trapezoid) && trap.pattern === (pattern ?? trap.pattern),
    'three clicks and a double-click draw a trapezoid with exactly those corners, in the picked pattern', trap && { points: round(trap.points), pattern: trap.pattern })
  const selected = await gm.evaluate((id) => canvas.linemap.selection.map(o => o.id).includes(id), trap?.id)
  p.check(selected, 'the new area is selected')

  // Enter finishes.
  n = (await areas(gm)).length
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clicks(gm, [{ x: 2000, y: 500 }, { x: 2400, y: 500 }, { x: 2200, y: 800 }])
  await gm.keyboard.press('Enter')
  const tri = await newArea(gm, n)
  p.check(!!tri && tri.points.length === 3, 'three clicks and Enter draw a triangle', tri && round(tri.points))

  // A click on the first corner closes the shape.
  n = (await areas(gm)).length
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clicks(gm, [{ x: 700, y: 1300 }, { x: 1100, y: 1300 }, { x: 900, y: 1600 }, { x: 702, y: 1302 }])
  const closed = await newArea(gm, n)
  p.check(!!closed && closed.points.length === 3, 'a click on the first corner closes the shape', closed && round(closed.points))

  // Escape cancels.
  n = (await areas(gm)).length
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clicks(gm, [{ x: 1600, y: 1300 }, { x: 2000, y: 1300 }])
  await gm.keyboard.press('Escape')
  await gm.waitForTimeout(scaled(600))
  const afterEscape = (await areas(gm)).length
  p.check(afterEscape === n && (await previewCount(gm)) === 0, 'Escape cancels the shape: no area, no preview', { afterEscape, n })

  // Backspace takes back a corner.
  n = (await areas(gm)).length
  await clicks(gm, [{ x: 1600, y: 1500 }, { x: 2000, y: 1500 }, { x: 2000, y: 1800 }, { x: 2300, y: 1900 }])
  await gm.keyboard.press('Backspace')
  await gm.waitForTimeout(scaled(200))
  await gm.keyboard.press('Enter')
  const back = await newArea(gm, n)
  p.check(!!back && back.points.length === 3 && !round(back.points).some(([x, y]) => x === 2300 && y === 1900), 'Backspace takes back the last corner', back && round(back.points))

  // A drag still draws a rectangle.
  n = (await areas(gm)).length
  await gm.evaluate(() => canvas.linemap.setSelection())
  await dragThrough(gm, [{ x: 2500, y: 400 }, { x: 2700, y: 600 }, { x: 2900, y: 800 }])
  const rect = await newArea(gm, n)
  const isRect = !!rect && rect.points.length === 4 && new Set(rect.points.map(pt => Math.round(pt[0]))).size === 2 && new Set(rect.points.map(pt => Math.round(pt[1]))).size === 2
  p.check(isRect, 'a drag still draws a rectangle', rect && round(rect.points))

  // One click on empty map, then a click on an area's edge: that area is selected, nothing drawn.
  n = (await areas(gm)).length
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clickAt(gm, { x: 2600, y: 1300 })
  await clickAt(gm, { x: 1100, y: 900 })
  await gm.waitForTimeout(scaled(400))
  const picked = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(picked.length === 1 && picked[0] === trap?.id && (await areas(gm)).length === n, 'one corner, then a click on an area\'s edge, selects that area and draws nothing', picked)

  // Its corners are still edited as before: a double-click on its edge adds one.
  await clickAt(gm, { x: 1400, y: 700 }, { clicks: 2 })
  const grown = await until(gm, (id) => ((canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.points?.length ?? 0) === 5, trap?.id, { timeout: 8000 }).catch(() => false)
  p.check(!!grown, "a double-click on a selected area's edge still adds a corner")

  // Undo, reload.
  n = (await areas(gm)).length
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await gm.waitForTimeout(scaled(600))
  const undone = await gm.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.points?.length, trap?.id)
  p.check(undone === 4, 'one undo takes the added corner back', undone)
  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (n) => canvas.linemap.objects.filter(o => o.constructor.type === 'area').length === n, n)
  const kept = await gm.evaluate((id) => canvas.linemap.objects.find(o => o.id === id)?.points?.map(pt => pt.map(Math.round)), trap?.id)
  p.check(JSON.stringify(kept) === JSON.stringify(trapezoid), 'the trapezoid is the same after a reload', kept)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
