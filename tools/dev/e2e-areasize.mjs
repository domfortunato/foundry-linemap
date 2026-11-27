#!/usr/bin/env node
// dev:areasize: areas in the right-click menu's size slider. An area has no size of its own, so its
// slider scales it around its middle, from how it was when the menu opened (1: as it was).
// - A selected area's menu has the slider at 1. At 2 the area is twice as wide and tall, its middle
//   where it was, its points saved so; at 0.5 half as wide. A double-click puts it back as it was.
// - Two areas scale each around its own middle. With a symbol too, the menu has both sliders.
// - The slider's edit is one undo. ] grows a selected area by a quarter, [ takes that back.
// - The area keeps its pattern and outline; it survives a reload.
import { clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:areasize', { watchdogMs: 300000 })

const square = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]
const A = { x: 900, y: 800 }
const B = { x: 1800, y: 800 }
const SYMBOL = { x: 900, y: 1500 }

/** An area's bounds (saved, or as the map has it now): width, height and middle. */
const bounds = (page, id, live = false) => page.evaluate(({ id, live }) => {
  const o = live
    ? canvas.linemap.objects.find(o => o.id === id)
    : (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)
  if (!o) return null
  const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1])
  const r = (v) => Math.round(v * 10) / 10
  return { w: r(Math.max(...xs) - Math.min(...xs)), h: r(Math.max(...ys) - Math.min(...ys)), cx: r((Math.max(...xs) + Math.min(...xs)) / 2), cy: r((Math.max(...ys) + Math.min(...ys)) / 2) }
}, { id, live })
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const select = (page, ...ids) => page.evaluate((ids) => { const L = canvas.linemap; L.setSelection(...L.objects.filter(o => ids.includes(o.id))) }, ids)
const menuAt = async (page, point) => {
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
}
const closeMenu = async (page) => {
  await page.mouse.move(10, 10)
  await page.waitForTimeout(scaled(600))
}
const slider = (page, name) => page.locator(`.linemap-menu input[type="range"][name="${name}"]`)
const sliderNames = (page) => page.evaluate(() => [...document.querySelectorAll('.linemap-menu input[type="range"]')].map(i => i.name))
/** Wait until the saved area is w wide. */
const savedAt = (page, id, w) => until(page, ({ id, w }) => {
  const o = (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)
  if (!o) return false
  const xs = o.points.map(p => p[0])
  return Math.abs(Math.max(...xs) - Math.min(...xs) - w) <= 1
}, { id, w }, { timeout: 10000 }).catch(() => false)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'areasize')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  const ids = await gm.evaluate(async ({ a, b, s }) => {
    const api = game.modules.get('linemap').api
    const [areaA, areaB, sym] = await api.add([
      api.area({ points: a, pattern: 'diagonal1' }),
      api.area({ points: b, pattern: 'diagonal1' }),
      api.symbol({ x: s.x, y: s.y, symbol: 'major-settlement' })
    ])
    return { areaA, areaB, sym }
  }, { a: square(A.x, A.y, 200), b: square(B.x, B.y, 150), s: SYMBOL })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.sym)
  const startA = await bounds(gm, ids.areaA)
  const startB = await bounds(gm, ids.areaB)

  // One area, from the slider.
  await select(gm, ids.areaA)
  await menuAt(gm, A)
  const has = await slider(gm, 'scale').count()
  const value = has ? await slider(gm, 'scale').first().inputValue() : null
  await p.shot(gm, 'menu')
  p.check(has > 0 && Number(value) === 1, "a selected area's right-click menu has a size slider, at 1", { has, value })
  if (!has) throw new Error('no size slider for an area')
  await slider(gm, 'scale').fill('2')
  await gm.waitForTimeout(scaled(300))
  const doubled = await bounds(gm, ids.areaA, true)
  p.check(near(doubled.w, startA.w * 2) && near(doubled.h, startA.h * 2) && near(doubled.cx, startA.cx) && near(doubled.cy, startA.cy),
    'at 2 the area is twice as wide and tall, its middle where it was', { startA, doubled })
  await slider(gm, 'scale').fill('0.5')
  await slider(gm, 'scale').dispatchEvent('change')
  const halved = await savedAt(gm, ids.areaA, startA.w / 2)
  p.check(!!halved && near((await bounds(gm, ids.areaA)).cx, startA.cx), 'at 0.5 it is half as wide, from how it was when the menu opened, and saved so', await bounds(gm, ids.areaA))
  await slider(gm, 'scale').dispatchEvent('dblclick')
  const back = await savedAt(gm, ids.areaA, startA.w)
  p.check(!!back && JSON.stringify(await bounds(gm, ids.areaA)) === JSON.stringify(startA), 'a double-click puts it back as it was', await bounds(gm, ids.areaA))
  await slider(gm, 'scale').fill('1.5')
  await closeMenu(gm)
  await savedAt(gm, ids.areaA, startA.w * 1.5)
  const grownA = await bounds(gm, ids.areaA)

  // One undo for the slider's edit.
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  const undone = await savedAt(gm, ids.areaA, startA.w)
  p.check(!!undone, 'one undo takes the slider back', await bounds(gm, ids.areaA))
  await gm.evaluate(async () => { await game.modules.get('linemap').api.redo() })
  await savedAt(gm, ids.areaA, startA.w * 1.5)

  // Two areas, each around its own middle; with a symbol, both sliders.
  await select(gm, ids.areaA, ids.areaB, ids.sym)
  await menuAt(gm, B)
  const names = await sliderNames(gm)
  p.check(names.includes('scale') && names.includes('size'), 'with a symbol selected too, the menu has the symbol size slider and the area one', names)
  if (names.includes('scale')) await slider(gm, 'scale').fill('2')
  await closeMenu(gm)
  await savedAt(gm, ids.areaB, startB.w * 2)
  const a2 = await bounds(gm, ids.areaA), b2 = await bounds(gm, ids.areaB)
  const symSize = await gm.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size ?? 1, ids.sym)
  p.check(near(a2.w, grownA.w * 2) && near(a2.cx, startA.cx) && near(b2.w, startB.w * 2) && near(b2.cx, startB.cx) && near(b2.cy, startB.cy) && symSize === 1,
    'two areas each grow around their own middle; the symbol keeps its size', { a2, b2, symSize })

  // ] and [.
  await select(gm, ids.areaB)
  await gm.mouse.move(800, 400)
  await gm.keyboard.press('BracketRight')
  const keyed = await savedAt(gm, ids.areaB, startB.w * 2 * 1.25)
  p.check(!!keyed && near((await bounds(gm, ids.areaB)).cx, startB.cx), '] grows a selected area by a quarter, around its middle', await bounds(gm, ids.areaB))
  await gm.keyboard.press('BracketLeft')
  const unkeyed = await savedAt(gm, ids.areaB, startB.w * 2)
  p.check(!!unkeyed, '[ takes it back', await bounds(gm, ids.areaB))

  // Still drawn: an outline and a pattern each.
  await gm.evaluate(() => { canvas.linemap.setSelection(); canvas.pan({ x: 1350, y: 900, scale: 0.4 }) })
  await gm.waitForTimeout(scaled(500))
  // Each drawn area adds one outline (a PIXI.Graphics) and a pattern mesh to the first container a redraw makes.
  const drawn = await gm.evaluate(() => {
    const c = canvas.linemap.drawn?.[0]?.children ?? []
    return { outlines: c.filter(x => x instanceof PIXI.Graphics).length, meshes: c.filter(x => x instanceof PIXI.Mesh).length }
  })
  await p.shot(gm, 'areas')
  p.check(drawn.meshes >= 2 && drawn.outlines >= 2, 'both areas are still drawn with their pattern and outline', drawn)

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.areaB)
  const reloaded = await bounds(gm, ids.areaB, true)
  p.check(near(reloaded.w, startB.w * 2), 'the area is the same size after a reload', reloaded)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
