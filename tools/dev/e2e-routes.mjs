#!/usr/bin/env node
// dev:routes: travel routes (ROADMAP 7.4). Waypoints mark days of travel, so with two symbols selected
// the route between them along linked lines with the fewest waypoints is highlighted, and its count
// shown.
// - A three-symbol map: a direct road with three waypoints, and a road through a third symbol with one.
//   The route picks the one with fewer waypoints, though it is longer, and says "1 waypoint".
// - A line ending on the middle of another joins it there, and only the waypoints passed count.
// - Two symbols with no road between them say "No route"; one symbol, or another layer, shows nothing.
// - The route follows edits (a line added while two symbols are selected), and the API gives it too.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, scaled, sweep, tool, until } from './lib.mjs'

const p = probe('dev:routes', { watchdogMs: 300000 })

const A = { x: 600, y: 1000 }
const B = { x: 2400, y: 1000 }
const C = { x: 1500, y: 400 }
const D = { x: 1500, y: 1700 }

const shiftClick = async (page, point) => {
  await page.keyboard.down('Shift')
  try { await clickAt(page, point) } finally { await page.keyboard.up('Shift') }
}
/** What the route overlay shows: the route found (or null), and the text of its count. */
const shown = (page) => page.evaluate(() => {
  const R = canvas.linemap.routes
  const s = R?.shown
  const texts = []
  const walk = (c) => { if (typeof c?.text === 'string') texts.push(c.text); for (const k of c?.children ?? []) walk(k) }
  if (R?.container?.visible) walk(R.container)
  return s ? { from: s.from, to: s.to, waypoints: s.route?.waypoints ?? null, lines: s.route?.lines ?? null, texts } : { none: true, texts }
})
/** The overlay's alpha at canvas points, rendered on its own. */
const overlayAlpha = (page, points) => page.evaluate((points) => {
  const R = canvas.linemap.routes
  if (!R?.container) return points.map(() => null)
  const { width, height } = canvas.dimensions
  const rt = PIXI.RenderTexture.create({ width, height })
  canvas.app.renderer.render(R.container, { renderTexture: rt, clear: true, transform: new PIXI.Matrix() })
  const out = points.map(pt => {
    const px = canvas.app.renderer.extract.pixels(rt, new PIXI.Rectangle(Math.round(pt.x) - 2, Math.round(pt.y) - 2, 5, 5))
    let a = 0
    for (let i = 3; i < px.length; i += 4) a = Math.max(a, px[i])
    return a
  })
  rt.destroy(true)
  return out
}, points)
const same = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().join() === [...b].sort().join()

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'routes')

  const ids = await gm.evaluate(async ({ A, B, C, D }) => {
    const api = game.modules.get('linemap').api
    const [a, b, c, d] = await api.add([A, B, C, D].map(pt => api.symbol({ x: pt.x, y: pt.y, symbol: 'minor-site' })))
    const [ab, ac, cb] = await api.add([api.line({ from: a, to: b }), api.line({ from: a, to: c }), api.line({ from: c, to: b })])
    const [w1, w2, w3, wc] = await api.add([
      api.waypoint({ line: ab, t: 0.25 }), api.waypoint({ line: ab, t: 0.5 }), api.waypoint({ line: ab, t: 0.75 }),
      api.waypoint({ line: ac, t: 0.5 })
    ])
    return { a, b, c, d, ab, ac, cb, w1, w2, w3, wc }
  }, { A, B, C, D })

  await tool(gm, 'selectObject')
  await clickAt(gm, A)
  let s = await shown(gm)
  p.check(!!s.none && s.texts.length === 0, 'one symbol selected shows no route', s)

  await shiftClick(gm, B)
  s = await shown(gm)
  p.check(s.from === ids.a && s.to === ids.b, 'two symbols selected: the route between them is shown', s)
  p.check(same(s.waypoints, [ids.wc]) && same(s.lines, [ids.ac, ids.cb]),
    'the route goes through the third symbol, with one waypoint, not along the direct road with three', s)
  p.check(s.texts.includes('1 waypoint'), 'the count is shown: "1 waypoint"', s.texts)
  const [onRoute, offRoute] = await overlayAlpha(gm, [{ x: 825, y: 850 }, { x: 1680, y: 1000 }])
  p.check(onRoute > 100 && offRoute === 0, 'the highlight is drawn along the road through the third symbol, not the direct road', { onRoute, offRoute })
  await p.shot(gm, 'route')

  const fromApi = await gm.evaluate(({ a, b }) => game.modules.get('linemap').api.route(a, b), ids)
  p.check(same(fromApi?.waypoints, [ids.wc]) && same(fromApi?.lines, [ids.ac, ids.cb]) && fromApi.length > 0,
    'api.route gives the same route, with its length', fromApi)

  // No road to D.
  await shiftClick(gm, B)
  await shiftClick(gm, D)
  s = await shown(gm)
  p.check(s.from === ids.a && s.to === ids.d && s.waypoints === null && s.texts.includes('No route'),
    'two symbols with no road between them say "No route"', s)

  // A road from D ending on the middle of the direct road joins it there.
  const dj = await gm.evaluate(async ({ d, ab }) => {
    const api = game.modules.get('linemap').api
    const line = api.line({ from: d, to: [1320, 1000] })
    line.points[1] = { point: null, sourceId: ab, sourceT: 0.4 }
    const [id] = await api.add(line)
    return id
  }, ids)
  await gm.waitForTimeout(scaled(400))
  s = await shown(gm)
  p.check(same(s.waypoints, [ids.w1]) && same(s.lines, [ids.ab, dj]) && s.texts.includes('1 waypoint'),
    'a road added while selected joins the direct road at its middle; the route counts only the waypoint passed', s)
  await p.shot(gm, 'junction')

  // Another layer shows nothing.
  await gm.evaluate(() => ui.controls.activate({ control: 'tokens', tool: 'select' }))
  await gm.waitForTimeout(scaled(400))
  s = await shown(gm)
  p.check(!!s.none && s.texts.length === 0, 'on another layer no route is shown', s)
  const flag = await gm.evaluate(() => JSON.stringify(canvas.scene.flags.linemap ?? {}))
  p.check(!/route/i.test(flag), 'nothing about the route is saved on the Scene')

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
