#!/usr/bin/env node
// dev:solid: a solid fill for areas, with a fill opacity. The area tool's shelf and the right-click
// menu's row of patterns have a "Solid" one, drawn as an even wash in the area's colour; a selected
// area's menu has a fill opacity slider (any pattern), saved as null at the pattern's default.
// - Drawn with the area tool after picking Solid: saved with pattern "solid", filled at 35% by default.
// - The opacity slider fills it at 80%, saved as 0.8; a double-click puts it back (null, 35%).
// - A red solid area is filled red. A hatched area at 50% draws its hatching half see-through.
// - The menu's row of patterns turns a hatched area solid. One undo takes a change back; a reload keeps it.
import { clickAt, dragThrough, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:solid', { watchdogMs: 300000 })

const square = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]
const RED = '#b3261e'
const HATCH = { x: 1800, y: 700 }
const REDAREA = { x: 1800, y: 1400 }

const saved = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id), id)
/** The drawn map's pixels in a box inside an area, away from its outline: the most common alpha and colour, and the greatest alpha. */
const fill = (page, box) => page.evaluate((box) => {
  const px = canvas.app.renderer.extract.pixels(canvas.linemap.renderTexture, new PIXI.Rectangle(Math.round(box.x), Math.round(box.y), box.w, box.h))
  const alphas = new Map(), colors = new Map()
  let max = 0
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]
    max = Math.max(max, a)
    if (a < 8) continue
    const ak = Math.round(a / 8) * 8
    alphas.set(ak, (alphas.get(ak) ?? 0) + 1)
    const ck = '#' + [px[i], px[i + 1], px[i + 2]].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0').slice(-2)).join('')
    colors.set(ck, (colors.get(ck) ?? 0) + 1)
  }
  const top = (m) => { let best = null, n = 0; for (const [k, c] of m) if (c > n) { best = k; n = c } return best }
  return { alpha: top(alphas), color: top(colors), max, covered: [...alphas.values()].reduce((a, b) => a + b, 0) / (box.w * box.h) }
}, box)
const near = (drawn, want, tol = 32) => {
  if (!drawn) return false
  const a = [1, 3, 5].map(i => parseInt(drawn.slice(i, i + 2), 16))
  const b = [1, 3, 5].map(i => parseInt(want.slice(i, i + 2), 16))
  return a.every((v, i) => Math.abs(v - b[i]) <= tol)
}
const select = (page, ...ids) => page.evaluate((ids) => { const L = canvas.linemap; L.setSelection(...L.objects.filter(o => ids.includes(o.id))) }, ids)
const menuAt = async (page, point) => {
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
}
const closeMenu = async (page) => {
  await page.mouse.move(10, 10)
  await page.waitForTimeout(scaled(600))
}
const slider = (page) => page.locator('.linemap-menu input[type="range"][name="opacity"]')
const savedField = (page, id, field, value) => until(page, ({ id, field, value }) =>
  (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.[field] === value, { id, field, value }, { timeout: 10000 })

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'solid')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })

  // Drawn with the area tool, Solid picked on its shelf.
  await tool(gm, 'drawArea')
  const button = gm.locator('#linemap-tool-options [data-area-pattern="solid"]').first()
  await button.waitFor({ timeout: scaled(10000) }).catch(() => {})
  const onShelf = await button.count()
  p.check(onShelf > 0, "the area tool's shelf has a Solid pattern")
  if (!onShelf) throw new Error('no Solid pattern on the shelf')
  await button.click()
  await dragThrough(gm, [{ x: 600, y: 500 }, { x: 900, y: 700 }, { x: 1100, y: 900 }])
  const drawnId = await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'area')?.id)
  p.check((await saved(gm, drawnId))?.pattern === 'solid', 'an area drawn after picking Solid is saved with pattern "solid"', await saved(gm, drawnId))
  await tool(gm, 'selectObject')
  await gm.evaluate(() => canvas.linemap.setSelection())
  await gm.waitForTimeout(scaled(400))
  const box = { x: 800, y: 650, w: 100, h: 100 }
  const plain = await fill(gm, box)
  p.check(plain.covered > 0.95 && Math.abs(plain.alpha - 0.35 * 255) <= 16 && near(plain.color, await gm.evaluate(() => canvas.linemap.color)),
    'it is filled evenly in the content colour, 35% opaque', plain)

  // The fill opacity slider.
  await select(gm, drawnId)
  await menuAt(gm, { x: 850, y: 700 })
  const has = await slider(gm).count()
  const value = has ? Number(await slider(gm).first().inputValue()) : null
  await p.shot(gm, 'menu')
  p.check(has > 0 && Math.abs(value - 0.35) < 0.01, "a selected area's right-click menu has a fill opacity slider, at 35%", { has, value })
  if (!has) throw new Error('no fill opacity slider')
  await slider(gm).fill('0.8')
  await closeMenu(gm)
  await savedField(gm, drawnId, 'opacity', 0.8)
  await gm.evaluate(() => canvas.linemap.setSelection())
  await gm.waitForTimeout(scaled(400))
  const strong = await fill(gm, box)
  p.check((await saved(gm, drawnId))?.opacity === 0.8 && Math.abs(strong.alpha - 0.8 * 255) <= 16, 'at 80% it is filled 80% opaque, saved as 0.8', strong)
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  const undone = await savedField(gm, drawnId, 'opacity', null)
  p.check(!!undone, 'one undo takes it back (null: the pattern default)')
  await gm.evaluate(async () => { await game.modules.get('linemap').api.redo() })
  await savedField(gm, drawnId, 'opacity', 0.8)
  await select(gm, drawnId)
  await menuAt(gm, { x: 850, y: 700 })
  await slider(gm).dispatchEvent('dblclick')
  await closeMenu(gm)
  const reset = await savedField(gm, drawnId, 'opacity', null)
  p.check(!!reset, 'a double-click on the slider puts it back to the default, saved as null')

  // Colour, and a hatched area at 50%.
  const ids = await gm.evaluate(async ({ hatch, red, RED }) => {
    const api = game.modules.get('linemap').api
    const [hatched, redArea] = await api.add([
      api.area({ points: hatch, pattern: 'diagonal1' }),
      api.area({ points: red, pattern: 'solid', color: RED })
    ])
    return { hatched, redArea }
  }, { hatch: square(HATCH.x, HATCH.y, 200), red: square(REDAREA.x, REDAREA.y, 200), RED })
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.redArea)
  await gm.evaluate(() => canvas.linemap.setSelection())
  await gm.waitForTimeout(scaled(400))
  const red = await fill(gm, { x: REDAREA.x - 50, y: REDAREA.y - 50, w: 100, h: 100 })
  p.check(near(red.color, RED) && red.covered > 0.95, 'a red solid area is filled red', red)
  const hatchBox = { x: HATCH.x - 100, y: HATCH.y - 100, w: 200, h: 200 }
  const hatchFull = await fill(gm, hatchBox)
  await select(gm, ids.hatched)
  await menuAt(gm, HATCH)
  const hatchValue = Number(await slider(gm).first().inputValue().catch(() => NaN))
  await slider(gm).fill('0.5')
  await closeMenu(gm)
  await savedField(gm, ids.hatched, 'opacity', 0.5)
  await gm.evaluate(() => canvas.linemap.setSelection())
  await gm.waitForTimeout(scaled(400))
  const hatchHalf = await fill(gm, hatchBox)
  p.check(hatchValue === 1 && hatchFull.max >= 240 && hatchHalf.max <= 150 && hatchHalf.max >= 100,
    "a hatched area's slider starts at 100%, and at 50% its hatching is drawn half see-through", { hatchValue, full: hatchFull.max, half: hatchHalf.max })

  // The menu's row of patterns turns it solid.
  await select(gm, ids.hatched)
  await menuAt(gm, HATCH)
  const look = gm.locator('.linemap-menu [data-look="solid"]').first()
  const inRow = await look.count()
  if (inRow) await look.click()
  await savedField(gm, ids.hatched, 'pattern', 'solid')
  await gm.evaluate(() => canvas.linemap.setSelection())
  await gm.waitForTimeout(scaled(400))
  const turned = await fill(gm, hatchBox)
  p.check(inRow > 0 && (await saved(gm, ids.hatched))?.pattern === 'solid' && turned.covered > 0.95 && Math.abs(turned.alpha - 0.5 * 255) <= 16,
    "the menu's row of patterns turns it solid, keeping its 50%", { inRow, turned })

  await gm.evaluate(() => canvas.pan({ x: 1300, y: 1000, scale: 0.45 }))
  await gm.waitForTimeout(scaled(500))
  await p.shot(gm, 'areas')

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id), ids.redArea)
  await gm.waitForTimeout(scaled(500))
  const after = await fill(gm, hatchBox)
  p.check(Math.abs(after.alpha - turned.alpha) <= 8 && after.covered > 0.95, 'the fills are the same after a reload', after)

  const api = await gm.evaluate(() => game.modules.get('linemap').api.area({ points: [[0, 0], [10, 0], [0, 10]], pattern: 'solid', opacity: 0.6 }).opacity)
  p.check(api === 0.6, 'the API area builder takes an opacity', api)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
