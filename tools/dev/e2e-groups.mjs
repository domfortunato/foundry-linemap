#!/usr/bin/env node
// dev:groups: show, hide and lock a group of objects, for the GM editing (players' views don't change).
// The Line Map controls have a Layers button; its window has a row per group (images, areas, lines,
// symbols and waypoints, labels), each with an eye and a lock.
// - Hiding areas stops drawing them for this user; they are still in the map and saved, a click where
//   one is selects nothing, and a player still sees them. Showing them draws them again.
// - Locking lines keeps them drawn but unclickable: a click on one selects nothing, a box over a line
//   and a symbol selects the symbol only, and the adjust tool doesn't grab its ends.
// - Hiding or locking a group deselects its objects. The state survives a reload.
import { PROBE_TAG, clickAt, dragThrough, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:groups', { watchdogMs: 360000 })
const PLAYER = `${PROBE_TAG} Groups Player`
const RED = '#b3261e'

const AREA = { x: 900, y: 700 }
const LINE_Y = 1300
const SYMBOL = { x: 1500, y: 1300 }

/** How many pixels of the drawn map are opaque in a box. */
const inked = (page, box) => page.evaluate((box) => {
  const px = canvas.app.renderer.extract.pixels(canvas.linemap.renderTexture, new PIXI.Rectangle(Math.round(box.x), Math.round(box.y), box.w, box.h))
  let n = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] > 64) n++
  return n
}, box)
const selected = (page) => page.evaluate(() => canvas.linemap.selection.map(o => o.id))
const savedIds = (page) => page.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).map(o => o.id))
const row = (page, group, action) => page.locator(`#linemap-layers [data-group="${group}"] [data-action="${action}"]`).first()
const pressed = (page, group, action) => row(page, group, action).getAttribute('aria-pressed')
const openLayers = async (page) => {
  if (await page.locator('#linemap-layers').count()) return true
  const button = page.locator('#scene-controls [data-tool="linemapLayers"]').first()
  if (!(await button.count())) return false
  await button.click()
  await page.locator('#linemap-layers').first().waitFor({ timeout: scaled(10000) }).catch(() => {})
  return (await page.locator('#linemap-layers').count()) > 0
}
const toggle = async (page, group, action) => {
  await row(page, group, action).click()
  await page.waitForTimeout(scaled(600))
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'groups')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))
  // Whatever a failed run left, every group shown and unlocked.
  p.cleanup(() => gm.evaluate(async () => { await game.settings.set('linemap', 'groups', { hidden: [], locked: [] }) }).catch(() => {}))

  const ids = await gm.evaluate(async ({ AREA, LINE_Y, SYMBOL, RED }) => {
    const api = game.modules.get('linemap').api
    const [area, line, sym] = await api.add([
      api.area({ points: [[AREA.x - 200, AREA.y - 200], [AREA.x + 200, AREA.y - 200], [AREA.x + 200, AREA.y + 200], [AREA.x - 200, AREA.y + 200]], pattern: 'solid', opacity: 1, color: RED }),
      api.line({ from: [500, LINE_Y], to: [1200, LINE_Y], style: 'major', size: 2 }),
      api.symbol({ x: SYMBOL.x, y: SYMBOL.y, symbol: 'major-settlement' })
    ])
    return { area, line, sym }
  }, { AREA, LINE_Y, SYMBOL, RED })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.sym)
  const areaBox = { x: AREA.x - 50, y: AREA.y - 50, w: 100, h: 100 }
  const lineBox = { x: 840, y: LINE_Y - 10, w: 20, h: 20 }

  const opened = await openLayers(gm)
  p.check(opened, 'the Line Map controls have a Layers button that opens the Layers window')
  if (!opened) throw new Error('no Layers window')
  const rows = await gm.evaluate(() => [...document.querySelectorAll('#linemap-layers [data-group]')].map(r => r.dataset.group))
  await p.shot(gm, 'window')
  p.check(['images', 'areas', 'lines', 'symbols', 'labels'].every(g => rows.includes(g)), 'it has a row per group', rows)

  // Hide areas.
  await gm.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, ids.area)
  const areaBefore = await inked(gm, areaBox)
  await toggle(gm, 'areas', 'toggleHidden')
  const areaHidden = await inked(gm, areaBox)
  p.check(areaBefore > 9000 && areaHidden === 0 && (await inked(gm, lineBox)) > 0 && (await pressed(gm, 'areas', 'toggleHidden')) === 'true',
    'hiding areas stops drawing them for the GM; lines are still drawn; the eye shows it', { areaBefore, areaHidden })
  p.check((await selected(gm)).length === 0 && (await savedIds(gm)).includes(ids.area) && (await gm.evaluate((id) => !!canvas.linemap.objects.find(o => o.id === id), ids.area)),
    'the hidden area is deselected, but still in the map and saved')
  await clickAt(gm, AREA)
  p.check((await selected(gm)).length === 0, 'a click where the hidden area is selects nothing', await selected(gm))

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, (id) => !!canvas.linemap?.objects?.find(o => o.id === id)?.sprite, ids.sym, { timeout: 20000 })
  await pl.waitForTimeout(scaled(500))
  p.check((await inked(pl, areaBox)) > 9000, 'a player still sees the area')

  await openLayers(gm)
  await toggle(gm, 'areas', 'toggleHidden')
  p.check((await inked(gm, areaBox)) > 9000, 'showing areas draws them again')

  // Lock lines.
  await openLayers(gm)
  await gm.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, ids.line)
  await toggle(gm, 'lines', 'toggleLocked')
  p.check((await selected(gm)).length === 0 && (await pressed(gm, 'lines', 'toggleLocked')) === 'true' && (await inked(gm, lineBox)) > 0,
    'locking lines deselects them and keeps them drawn; the lock shows it')
  await clickAt(gm, { x: 850, y: LINE_Y })
  p.check((await selected(gm)).length === 0, 'a click on a locked line selects nothing', await selected(gm))
  await dragThrough(gm, [{ x: 450, y: LINE_Y - 100 }, { x: 1000, y: LINE_Y }, { x: 1600, y: LINE_Y + 100 }])
  const boxed = await selected(gm)
  p.check(boxed.length === 1 && boxed[0] === ids.sym, 'a box over the locked line and a symbol selects the symbol only', boxed)
  await gm.evaluate(() => canvas.linemap.setSelection())
  await tool(gm, 'adjustObject')
  await dragThrough(gm, [{ x: 500, y: LINE_Y }, { x: 500, y: LINE_Y + 150 }, { x: 500, y: LINE_Y + 300 }])
  const end = await gm.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.points?.[0]?.point, ids.line)
  p.check(!!end && Math.round(end[1]) === LINE_Y, "the adjust tool doesn't grab a locked line's end", end)
  await tool(gm, 'selectObject')

  // A reload keeps it.
  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.sym)
  await tool(gm, 'selectObject')
  await clickAt(gm, { x: 850, y: LINE_Y })
  const afterReload = await selected(gm)
  await openLayers(gm)
  p.check(afterReload.length === 0 && (await pressed(gm, 'lines', 'toggleLocked')) === 'true', 'lines are still locked after a reload, and the window shows it', afterReload)
  await toggle(gm, 'lines', 'toggleLocked')
  await clickAt(gm, { x: 850, y: LINE_Y })
  p.check(JSON.stringify(await selected(gm)) === JSON.stringify([ids.line]), 'unlocked, a click selects the line again', await selected(gm))

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
