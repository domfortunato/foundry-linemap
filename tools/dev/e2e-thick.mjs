#!/usr/bin/env node
// dev:thick: line thickness, through the size slider (and ] and [) like symbols, waypoints and labels.
// - A selected line's right-click menu has the size slider. At size 3 a major line is drawn three
//   times as thick, saved as 3 (null at 1), and is clicked on three times as far from its middle.
// - Every style scales as a whole: a curved rough line's waves, a dotted line's dots, a barrier.
// - The waypoint and the label on a thickened line stay where they were, linked.
// - ] grows a selected line by half a size; one undo takes a change back; it survives a reload.
import { clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:thick', { watchdogMs: 300000 })

const saved = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id), id)
/** The size of a line's drawn graphics (from the layer's cache, as the map was last drawn). */
const drawn = (page, id) => page.evaluate((id) => {
  const g = canvas.linemap.displayCache.get(id)?.sprite
  if (!g) return null
  const b = g.getLocalBounds()
  return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }
}, id)
/** How many pixels of the rendered map are drawn in a column across a horizontal line. */
const thickness = (page, x, y) => page.evaluate(({ x, y }) => {
  const L = canvas.linemap
  const px = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(x, y - 30, 1, 60))
  let n = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] > 128) n++
  return n
}, { x, y })
/** How far a wavy line's waves reach from its centre line, at most. */
const swing = (page, id) => page.evaluate((id) => {
  const o = canvas.linemap.objects.find(o => o.id === id)
  const c = o.centerline
  const dist = (p) => {
    let best = Infinity
    for (let i = 0; i < c.length - 1; i++) {
      const [a, b] = [c[i], c[i + 1]]
      const d = [b[0] - a[0], b[1] - a[1]]
      const l2 = d[0] * d[0] + d[1] * d[1] || 1
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2))
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]))
    }
    return best
  }
  return Math.round(Math.max(...o.path.map(dist)) * 10) / 10
}, id)
const menuOn = async (page, id, point) => {
  await page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, id)
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
}
const closeMenu = async (page) => {
  await page.mouse.move(10, 10)
  await page.waitForTimeout(scaled(600))
}
const sizeSlider = (page) => page.locator('.linemap-menu input[type="range"][name="size"]')

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'thick')
  const ids = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [major, rough, dotted, barrier] = await api.add([
      api.line({ from: [600, 500], to: [1400, 500], style: 'major' }),
      api.line({ from: [600, 900], via: [[900, 800], [1200, 1000]], to: [1500, 900], style: 'rough', smooth: true }),
      api.line({ from: [600, 1300], to: [1400, 1300], style: 'dotted' }),
      api.line({ from: [600, 1700], to: [1400, 1700], style: 'barrier' })
    ])
    const [wp, label] = await api.add([api.waypoint({ line: major, t: 0.25 }), api.label({ text: 'King’s Road', on: major, t: 0.75 })])
    return { major, rough, dotted, barrier, wp, label }
  })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.displayCache.get(id), ids.barrier)

  const placed = (page) => page.evaluate((ids) => {
    const get = (id) => canvas.linemap.objects.find(o => o.id === id)
    return { wp: get(ids.wp)?.point.point.map(Math.round), label: get(ids.label)?.sprite && [Math.round(get(ids.label).sprite.x), Math.round(get(ids.label).sprite.y)] }
  }, ids)
  const before = { major: await thickness(gm, 1000, 500), rough: await swing(gm, ids.rough), dotted: await drawn(gm, ids.dotted), barrier: await drawn(gm, ids.barrier), placed: await placed(gm) }

  // The major line, from the slider.
  await menuOn(gm, ids.major, { x: 1000, y: 500 })
  const has = await sizeSlider(gm).count()
  p.check(has > 0, "a selected line's right-click menu has the size slider")
  if (!has) throw new Error('no size slider for a line')
  await sizeSlider(gm).fill('3')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === 3, ids.major)
  const majorAfter = await thickness(gm, 1000, 500)
  p.check((await saved(gm, ids.major))?.size === 3 && majorAfter >= before.major * 2.5 && majorAfter <= before.major * 3.5,
    'at size 3 the major line is drawn three times as thick, saved as 3', { before: before.major, after: majorAfter })
  const placedAfter = await placed(gm)
  p.check(JSON.stringify(placedAfter.wp) === JSON.stringify(before.placed.wp) && JSON.stringify(placedAfter.label) === JSON.stringify(before.placed.label) &&
    (await saved(gm, ids.wp)).point.sourceId === ids.major && (await saved(gm, ids.label)).point.sourceId === ids.major,
    'the waypoint and the label on it stay where they were, linked', { before: before.placed, after: placedAfter })

  // Clicked three times as far from its middle (style tolerance 5 px, so 15 at size 3).
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clickAt(gm, { x: 1000, y: 513 })
  const picked = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(picked.length === 1 && picked[0] === ids.major, 'a click 13 px from its middle selects the thick line', picked)

  // A curved rough line: its waves scale.
  await menuOn(gm, ids.rough, { x: 900, y: 800 })
  await sizeSlider(gm).fill('2')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === 2, ids.rough)
  const roughAfter = await swing(gm, ids.rough)
  p.check(roughAfter >= before.rough * 1.7 && roughAfter <= before.rough * 2.3, "a curved rough line's waves reach twice as far at size 2", { before: before.rough, after: roughAfter })

  // A dotted line: its dots.
  await menuOn(gm, ids.dotted, { x: 1000, y: 1300 })
  await sizeSlider(gm).fill('4')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === 4, ids.dotted)
  const dottedAfter = await drawn(gm, ids.dotted)
  p.check(dottedAfter && dottedAfter.h >= before.dotted.h * 3.5, "a dotted line's dots are four times as big at size 4", { before: before.dotted, after: dottedAfter })

  // ] grows a barrier by half a size.
  await gm.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, ids.barrier)
  await gm.mouse.move(800, 400)
  await gm.keyboard.press('BracketRight')
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === 1.5, ids.barrier)
  const barrierAfter = await drawn(gm, ids.barrier)
  p.check((await saved(gm, ids.barrier))?.size === 1.5 && barrierAfter.h >= before.barrier.h * 1.4, '] grows a selected barrier by half a size, ticks and all', { before: before.barrier, after: barrierAfter })

  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.size === null, ids.barrier)
  p.check((await saved(gm, ids.barrier))?.size === null, 'one undo takes it back (saved as null at 1)')

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.displayCache.get(id), ids.major)
  const reloaded = await thickness(gm, 1000, 500)
  p.check(Math.abs(reloaded - majorAfter) <= 1, 'the thick line is the same after a reload', { reloaded, majorAfter })

  const api = await gm.evaluate(() => game.modules.get('linemap').api.line({ from: [0, 0], to: [10, 0], size: 2 }).size)
  p.check(api === 2, 'the API line builder takes a size', api)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
