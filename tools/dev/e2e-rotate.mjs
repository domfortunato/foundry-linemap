#!/usr/bin/env node
// dev:rotate: a rotation slider in the right-click menu, for labels.
// - A selected label's menu has a rotation slider at 0. Sliding it turns the label in place: it is
//   drawn at that angle, saved in degrees (null at 0), and clicked on along its turned length.
// - A label on a symbol turns where it is; a label on a line turns from the line's direction.
// - One undo takes a rotation back; a double-click on the slider puts it back to 0. A symbol's menu
//   has no rotation slider. The angle survives a reload, and players see it.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:rotate', { watchdogMs: 300000 })
const PLAYER = `${PROBE_TAG} Rotate Player`

const FREE = { x: 1000, y: 700 }
const TOWN = { x: 1800, y: 700 }
const LINE_FROM = [800, 1400]
const LINE_TO = [1600, 1000] // rises at about 26.6 degrees

const saved = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id), id)
const sprite = (page, id) => page.evaluate((id) => {
  const o = canvas.linemap.objects.find(o => o.id === id)
  return o?.sprite ? { x: Math.round(o.sprite.x), y: Math.round(o.sprite.y), rotation: o.sprite.rotation, width: o.sprite.width, height: o.sprite.height } : null
}, id)
const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10
const slider = (page, name) => page.locator(`.linemap-menu input[type="range"][name="${name}"]`)
/** Select one object with the select tool and open its menu at a point. */
const menuOn = async (page, id, point) => {
  await page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, id)
  await clickAt(page, point, { button: 'right' })
  await page.waitForTimeout(scaled(300))
}
const closeMenu = async (page) => {
  await page.mouse.move(10, 10)
  await page.waitForTimeout(scaled(600))
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'rotate')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  const ids = await gm.evaluate(async ({ FREE, TOWN, LINE_FROM, LINE_TO }) => {
    const api = game.modules.get('linemap').api
    const [town] = await api.add(api.symbol({ x: TOWN.x, y: TOWN.y, symbol: 'minor-site' }))
    const [road] = await api.add(api.line({ from: LINE_FROM, to: LINE_TO }))
    const [free, onTown, onRoad] = await api.add([
      api.label({ text: 'The Long Mire of Sorrows', x: FREE.x, y: FREE.y }),
      api.label({ text: 'Greyhaven', on: town }),
      api.label({ text: 'Old Road', on: road, t: 0.5 })
    ])
    return { town, road, free, onTown, onRoad }
  }, { FREE, TOWN, LINE_FROM, LINE_TO })
  await tool(gm, 'selectObject')
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.onRoad)

  // The free label.
  const before = await sprite(gm, ids.free)
  await menuOn(gm, ids.free, FREE)
  const has = await slider(gm, 'rotation').count()
  const start = has ? await slider(gm, 'rotation').inputValue() : null
  p.check(has > 0 && Number(start) === 0, "a label's right-click menu has a rotation slider, at 0", { has, start })
  if (!has) throw new Error('there is no rotation slider')
  await slider(gm, 'rotation').fill('45')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.rotation === 45, ids.free)
  const turned = await sprite(gm, ids.free)
  p.check((await saved(gm, ids.free))?.rotation === 45 && Math.abs(deg(turned.rotation) - 45) < 0.5 && turned.x === before.x && turned.y === before.y,
    'sliding to 45 turns the label 45 degrees where it was, saved as 45', { before, turned })

  // Clicked along its turned length: a point well outside its unturned box.
  const along = { x: FREE.x + Math.cos(Math.PI / 4) * before.width * 0.4, y: FREE.y + Math.sin(Math.PI / 4) * before.width * 0.4 }
  await gm.evaluate(() => canvas.linemap.setSelection())
  await clickAt(gm, along)
  const picked = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(picked.length === 1 && picked[0] === ids.free, 'a click along the turned label selects it', { along, picked, halfHeight: before.height / 2 })

  // A label on a symbol turns where it is.
  const townBefore = await sprite(gm, ids.onTown)
  await menuOn(gm, ids.onTown, { x: townBefore.x, y: townBefore.y })
  await slider(gm, 'rotation').fill('-90')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.rotation === -90, ids.onTown)
  const townAfter = await sprite(gm, ids.onTown)
  p.check(Math.abs(deg(townAfter.rotation) + 90) < 0.5 && townAfter.x === townBefore.x && townAfter.y === townBefore.y && (await saved(gm, ids.onTown)).point.sourceId === ids.town,
    'a label on a symbol turns in place, still linked to it', { townBefore, townAfter })

  // A label on a line turns from the line's direction.
  const roadBefore = await sprite(gm, ids.onRoad)
  await menuOn(gm, ids.onRoad, { x: roadBefore.x, y: roadBefore.y })
  await slider(gm, 'rotation').fill('20')
  await closeMenu(gm)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.rotation === 20, ids.onRoad)
  const roadAfter = await sprite(gm, ids.onRoad)
  p.check(Math.abs(deg(roadAfter.rotation) - (deg(roadBefore.rotation) + 20)) < 0.5 && Math.abs(deg(roadBefore.rotation) + 26.6) < 1,
    "a label on a line turns from the line's direction", { line: deg(roadBefore.rotation), now: deg(roadAfter.rotation) })

  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.rotation === null, ids.onRoad)
  p.check((await saved(gm, ids.onRoad))?.rotation === null && Math.abs(deg((await sprite(gm, ids.onRoad)).rotation) - deg(roadBefore.rotation)) < 0.5,
    'one undo takes the rotation back (saved as null at 0)', await saved(gm, ids.onRoad))

  // Double-click resets; a symbol has no rotation slider.
  await menuOn(gm, ids.onTown, { x: townBefore.x, y: townBefore.y })
  // An event, not a real double-click: a click in the middle of the slider would set 0 by itself.
  await slider(gm, 'rotation').dispatchEvent('dblclick')
  await closeMenu(gm)
  const reset = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.rotation === null, ids.onTown)
  p.check(!!reset, 'a double-click on the slider puts the label back to 0', await saved(gm, ids.onTown))
  await menuOn(gm, ids.town, TOWN)
  const symbolSliders = { rotation: await slider(gm, 'rotation').count(), size: await slider(gm, 'size').count() }
  p.check(symbolSliders.rotation === 0 && symbolSliders.size === 1, "a symbol's menu has a size slider and no rotation slider", symbolSliders)
  await closeMenu(gm)

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, ids.free)
  p.check(Math.abs(deg((await sprite(gm, ids.free)).rotation) - 45) < 0.5, 'the angle is the same after a reload')

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, (id) => !!canvas.linemap?.objects?.find(o => o.id === id)?.sprite, ids.free, { timeout: 20000 })
  p.check(Math.abs(deg((await sprite(pl, ids.free)).rotation) - 45) < 0.5, 'a player sees the label turned')

  const api = await gm.evaluate(() => game.modules.get('linemap').api.label({ text: 'x', x: 0, y: 0, rotation: 30 }).rotation)
  p.check(api === 30, 'the API label builder takes a rotation', api)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
