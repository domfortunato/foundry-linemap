#!/usr/bin/env node
// dev:over: an area drawn over lines, such as a lake over a road. Areas are drawn under lines; a
// selected area's right-click menu has "Draw over lines", and then "Draw under lines" to go back.
// - A solid blue area over a red line's middle: the line shows through until the area is set over
//   lines, saved as over: true; then the area covers it. Symbols and labels stay above it.
// - "Draw under lines" puts it back (saved as null). One undo takes a change back; a reload keeps it.
import { clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:over', { watchdogMs: 300000 })

const RED = '#b3261e'
const BLUE = '#1f5fa8'
const AREA = { x: 1000, y: 800 }
const SYMBOL = { x: 1100, y: 700 }

const saved = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id), id)
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
const deselect = async (page) => { await page.evaluate(() => canvas.linemap.setSelection()); await page.waitForTimeout(scaled(400)) }
const menuPick = async (page, option, id) => {
  await page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, id)
  await clickAt(page, { x: AREA.x - 150, y: AREA.y + 150 }, { button: 'right' })
  await page.waitForTimeout(scaled(300))
  const item = page.locator(`.linemap-menu [data-option="${option}"]`).first()
  const has = await item.count()
  if (has) await item.click()
  await page.waitForTimeout(scaled(600))
  return has > 0
}
const savedOver = (page, id, value) => until(page, ({ id, value }) =>
  ((canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.over ?? null) === value, { id, value }, { timeout: 10000 })

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'over')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  const ids = await gm.evaluate(async ({ RED, BLUE, AREA, SYMBOL }) => {
    const api = game.modules.get('linemap').api
    const [line] = await api.add(api.line({ from: [500, AREA.y], to: [1500, AREA.y], style: 'major', size: 4, color: RED }))
    const [area, sym] = await api.add([
      api.area({ points: [[AREA.x - 200, AREA.y - 200], [AREA.x + 200, AREA.y - 200], [AREA.x + 200, AREA.y + 200], [AREA.x - 200, AREA.y + 200]], pattern: 'solid', opacity: 1, color: BLUE }),
      api.symbol({ x: SYMBOL.x, y: SYMBOL.y, symbol: 'major-settlement', size: 3 })
    ])
    return { line, area, sym }
  }, { RED, BLUE, AREA, SYMBOL })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.sym)
  await deselect(gm)
  const content = await gm.evaluate(() => canvas.linemap.color)

  const before = await colorAt(gm, AREA, 3)
  p.check(near(before, RED), 'the red line is drawn over the blue area, as areas are drawn under lines', before)
  const over = await menuPick(gm, 'overLines', ids.area)
  await p.shot(gm, 'menu')
  const isOver = await savedOver(gm, ids.area, true)
  await deselect(gm)
  const after = await colorAt(gm, AREA, 3)
  p.check(over && !!isOver && near(after, BLUE), "the menu's Draw over lines puts the area over the line, saved as over: true", { over, after })
  const symColor = await colorAt(gm, SYMBOL, 3)
  p.check(near(symColor, content), 'a symbol on the area is still drawn above it', { symColor, content })
  await p.shot(gm, 'over')

  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await savedOver(gm, ids.area, null)
  await deselect(gm)
  p.check(near(await colorAt(gm, AREA, 3), RED), 'one undo puts it back under the line')
  await gm.evaluate(async () => { await game.modules.get('linemap').api.redo() })
  await savedOver(gm, ids.area, true)

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.sym)
  await tool(gm, 'selectObject')
  await deselect(gm)
  p.check(near(await colorAt(gm, AREA, 3), BLUE), 'it is still over the line after a reload')

  const under = await menuPick(gm, 'underLines', ids.area)
  const isUnder = await savedOver(gm, ids.area, null)
  await deselect(gm)
  p.check(under && !!isUnder && near(await colorAt(gm, AREA, 3), RED), 'Draw under lines puts it back, saved as null', { under })

  const api = await gm.evaluate(() => game.modules.get('linemap').api.area({ points: [[0, 0], [10, 0], [0, 10]], over: true }).over)
  p.check(api === true, 'the API area builder takes over', api)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
