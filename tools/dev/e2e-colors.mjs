#!/usr/bin/env node
// dev:colors: per-object colours. The right-click menu has a row of colours for the selection: lines,
// symbols, waypoints, areas and labels can each take their own; the "scene colour" swatch puts them
// back to following the scene's content colour.
// - A line picked red is drawn red, saved as "#b3261e"; another line stays in the content colour.
// - A symbol, a label and an area take their colours too (read back from the drawn map).
// - The custom swatch asks for any colour. Several objects change as one edit, which one undo takes back.
// - Changing the scene's content colour moves the uncoloured objects only.
// - Duplicating keeps the colour, and so does changing a line's style. It survives a reload; players
//   see it.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:colors', { watchdogMs: 360000 })
const PLAYER = `${PROBE_TAG} Colors Player`
const RED = '#b3261e'
const BLUE = '#1f5fa8'
const GREEN = '#2e7d32'
const GOLD = '#c9a227'

const SYMBOL = { x: 600, y: 500 }
const LABEL_TEXT = 'Greyhaven'
const AREA = { x: 1900, y: 1300 }

const saved = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id), id)
/** The colour of the drawn map's opaque pixels in a box (the most common one, as #rrggbb), or null. */
const colorIn = (page, box) => page.evaluate((box) => {
  const L = canvas.linemap
  const px = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(Math.round(box.x), Math.round(box.y), box.w, box.h))
  const counts = new Map()
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 250) continue
    const key = '#' + [px[i], px[i + 1], px[i + 2]].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0').slice(-2)).join('')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = null, n = 0
  for (const [k, c] of counts) if (c > n) { best = k; n = c }
  return best
}, box)
/** Whether a drawn colour is near a #rrggbb one. */
const near = (drawn, want, tol = 24) => {
  if (!drawn) return false
  const a = [1, 3, 5].map(i => parseInt(drawn.slice(i, i + 2), 16))
  const b = [1, 3, 5].map(i => parseInt(want.slice(i, i + 2), 16))
  return a.every((v, i) => Math.abs(v - b[i]) <= tol)
}
const select = (page, ...ids) => page.evaluate((ids) => { const L = canvas.linemap; L.setSelection(...L.objects.filter(o => ids.includes(o.id))) }, ids)
const deselect = (page) => page.evaluate(() => canvas.linemap.setSelection())
const menuAt = async (page, point) => {
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
}
const swatches = (page) => page.evaluate(() => [...document.querySelectorAll('.linemap-menu [data-color]')].map(a => [a.dataset.color, a.classList.contains('active')]))
const pickColor = async (page, color) => {
  const s = page.locator(`.linemap-menu [data-color="${color}"]`).first()
  if (!(await s.count())) return false
  await s.click()
  await page.waitForTimeout(scaled(600))
  return true
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'colors')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  const ids = await gm.evaluate(async ({ SYMBOL, AREA, LABEL_TEXT }) => {
    const api = game.modules.get('linemap').api
    const [sym] = await api.add(api.symbol({ x: SYMBOL.x, y: SYMBOL.y, symbol: 'major-settlement', size: 2 }))
    const [road, river] = await api.add([
      api.line({ from: [600, 900], to: [1400, 900], style: 'major', size: 3 }),
      api.line({ from: [600, 1200], to: [1400, 1200], style: 'major', size: 3 })
    ])
    const [label, area] = await api.add([
      api.label({ text: LABEL_TEXT, x: 1400, y: 500, size: 2, style: 'bold' }),
      api.area({ points: [[AREA.x - 200, AREA.y - 200], [AREA.x + 200, AREA.y - 200], [AREA.x + 200, AREA.y + 200], [AREA.x - 200, AREA.y + 200]], pattern: 'diagonal1' })
    ])
    return { sym, road, river, label, area }
  }, { SYMBOL, AREA, LABEL_TEXT })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.label)
  const content = await gm.evaluate(() => canvas.linemap.color)
  const roadBox = { x: 990, y: 890, w: 20, h: 20 }
  const riverBox = { x: 990, y: 1190, w: 20, h: 20 }

  // The road, red.
  await select(gm, ids.road)
  await menuAt(gm, { x: 1000, y: 900 })
  const row = await swatches(gm)
  p.check(row.some(([c]) => c === RED) && row.some(([c, active]) => c === 'default' && active) && row.some(([c]) => c === 'custom'),
    "a selected line's menu has a row of colours, the scene colour marked, and a custom one", row)
  await pickColor(gm, RED)
  await until(gm, ({ id, RED }) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.color === RED, { id: ids.road, RED })
  await deselect(gm)
  const roadColor = await colorIn(gm, roadBox)
  const riverColor = await colorIn(gm, riverBox)
  p.check((await saved(gm, ids.road))?.color === RED && near(roadColor, RED) && near(riverColor, content),
    'the road is drawn red and saved so; the other line keeps the content colour', { roadColor, riverColor, content })

  // A symbol, a label and an area.
  await select(gm, ids.sym)
  await menuAt(gm, SYMBOL)
  await pickColor(gm, BLUE)
  await select(gm, ids.label)
  await menuAt(gm, { x: 1400, y: 500 })
  await pickColor(gm, GREEN)
  await select(gm, ids.area)
  await menuAt(gm, AREA)
  await pickColor(gm, GOLD)
  await deselect(gm)
  await gm.waitForTimeout(scaled(500))
  const symColor = await colorIn(gm, { x: SYMBOL.x - 40, y: SYMBOL.y - 40, w: 80, h: 80 })
  const labelColor = await colorIn(gm, { x: 1300, y: 470, w: 200, h: 60 })
  const areaColor = await colorIn(gm, { x: AREA.x - 150, y: AREA.y - 150, w: 300, h: 300 })
  p.check(near(symColor, BLUE) && (await saved(gm, ids.sym))?.color === BLUE, 'a symbol is drawn in its colour', symColor)
  p.check(near(labelColor, GREEN) && (await saved(gm, ids.label))?.color === GREEN, 'a label is drawn in its colour', labelColor)
  p.check(near(areaColor, GOLD) && (await saved(gm, ids.area))?.color === GOLD, "an area's pattern is drawn in its colour", areaColor)
  await p.shot(gm, 'colors')

  // Custom.
  await select(gm, ids.river)
  await menuAt(gm, { x: 1000, y: 1200 })
  await pickColor(gm, 'custom')
  const input = gm.locator('.application.dialog input[name="color"]').first()
  await input.waitFor({ timeout: scaled(10000) })
  await input.fill('#123456')
  await gm.locator('.application.dialog button[data-action="ok"]').first().click()
  const custom = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.color === '#123456', ids.river)
  p.check(!!custom, 'the custom swatch asks for any colour, and the line takes it')

  // Two at once back to the scene colour, one edit; one undo.
  await select(gm, ids.road, ids.river)
  await menuAt(gm, { x: 1000, y: 900 })
  await pickColor(gm, 'default')
  const both = await until(gm, (ids) => {
    const o = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    return ids.every(id => o.find(x => x.id === id)?.color === null)
  }, [ids.road, ids.river])
  p.check(!!both, 'the scene-colour swatch puts both selected lines back (saved as null)')
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await until(gm, ({ id, RED }) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.color === RED, { id: ids.road, RED })
  p.check((await saved(gm, ids.road))?.color === RED && (await saved(gm, ids.river))?.color === '#123456', 'one undo gives both their colours back')

  // The scene's content colour moves the uncoloured objects only.
  await gm.evaluate(async (ids) => {
    const api = game.modules.get('linemap').api
    await api.update({ id: ids.river, color: null })
    const L = canvas.linemap
    L.color = '#7a4a1e'
    L.redraw()
    await L.dataChanged()
  }, ids)
  await deselect(gm)
  await gm.waitForTimeout(scaled(500))
  const roadNow = await colorIn(gm, roadBox)
  const riverNow = await colorIn(gm, riverBox)
  p.check(near(roadNow, RED) && near(riverNow, '#7a4a1e'), 'a new content colour moves the uncoloured line, not the red one', { roadNow, riverNow })

  // Duplicate, and a change of style, keep the colour.
  await select(gm, ids.road)
  await menuAt(gm, { x: 1000, y: 900 })
  const dup = gm.locator('.linemap-menu [data-option="duplicate"]').first()
  if (await dup.count()) await dup.click()
  await gm.waitForTimeout(scaled(600))
  const copy = await gm.evaluate((ids) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'line' && !Object.values(ids).includes(o.id)), ids)
  p.check(copy?.color === RED, 'a duplicate keeps the colour', copy?.color)
  await select(gm, ids.road)
  await menuAt(gm, { x: 1000, y: 900 })
  const rough = gm.locator('.linemap-menu [data-look="rough"]').first()
  if (await rough.count()) await rough.click()
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.style === 'rough', ids.road)
  p.check((await saved(gm, ids.road))?.color === RED, 'changing the line to rough keeps it red')

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.label)
  p.check(near(await colorIn(gm, { x: SYMBOL.x - 40, y: SYMBOL.y - 40, w: 80, h: 80 }), BLUE), 'the colours are the same after a reload')

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, (id) => !!canvas.linemap?.objects?.find(o => o.id === id)?.sprite, ids.label, { timeout: 20000 })
  p.check(near(await colorIn(pl, { x: 1300, y: 470, w: 200, h: 60 }), GREEN), 'a player sees the label green')

  const api = await gm.evaluate(() => game.modules.get('linemap').api.line({ from: [0, 0], to: [10, 0], color: '#ff0000' }).color)
  p.check(api === '#ff0000', 'the API builders take a colour', api)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
