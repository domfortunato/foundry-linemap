#!/usr/bin/env node
// dev:api: a scripting API (ROADMAP 7.1), `game.modules.get("linemap").api`, as a macro would use it.
// - Builders make an object's data (symbol, line, label, waypoint, area, image); `add` puts objects on
//   a map. On the viewed Scene, an edit goes through the tools' undo record: the tools see the object,
//   and Ctrl+Z takes it back.
// - Lines, labels and waypoints link to objects by id, and follow them when they move (`update`).
// - `hide`, `reveal` and `delete` (which pins what was linked to the deleted object) are edits too.
// - A Scene that is not viewed can be read and edited; its map is saved without an undo record.
// - Hooks: `linemapReady` when the layer has drawn a Scene's map, `linemapObjectsChanged` when a map's
//   objects change, by this API, by the tools, or by another user.
// - A player cannot edit through the API, and data the module does not know is refused, unsaved.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:api', { watchdogMs: 360000 })
const PLAYER = `${PROBE_TAG} Api Player`

const saved = (page, sceneId) => page.evaluate((sceneId) => {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene
  return canvas.linemap.constructor.readFlag(scene)?.objects ?? []
}, sceneId)
const near = (a, b, tol = 1) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'api')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  const shape = await gm.evaluate(() => {
    const api = game.modules.get('linemap')?.api
    return api ? Object.fromEntries(['objects', 'get', 'add', 'update', 'delete', 'reveal', 'hide', 'undo', 'symbol', 'line', 'label', 'waypoint', 'area', 'image'].map(k => [k, typeof api[k]])) : null
  })
  p.check(!!shape && Object.values(shape).every(t => t === 'function'), 'game.modules.get("linemap").api has the reading, editing and building functions', shape)
  if (!shape) throw new Error('there is no API')

  // Hooks, recorded in the page.
  await gm.evaluate(() => {
    window.__lm = { ready: [], changed: [] }
    Hooks.on('linemapReady', (layer, scene) => window.__lm.ready.push({ scene: scene?.id, layer: layer === canvas.linemap }))
    Hooks.on('linemapObjectsChanged', (scene, info) => window.__lm.changed.push({ scene: scene?.id, ...info }))
  })

  // A macro adds a symbol; the tools see it; Ctrl+Z takes it back.
  const id = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [id] = await api.add(api.symbol({ x: 900, y: 700, symbol: 'major-settlement' }))
    return id
  })
  let s = await saved(gm)
  const drawn = await gm.evaluate((id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, id)
  p.check(typeof id === 'string' && s.some(o => o.id === id && o.type === 'symbol' && near(o.point.point, [900, 700])), 'add puts a symbol on the map, saved in the Scene', s)
  p.check(drawn, 'and it is drawn')
  await tool(gm, 'selectObject')
  await clickAt(gm, { x: 900, y: 700 })
  const selected = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  p.check(JSON.stringify(selected) === JSON.stringify([id]), 'the select tool picks it with a click', selected)
  const heard = await until(gm, (id) => window.__lm.changed.some(c => c.changed?.includes(id)), id)
  p.check(!!heard, 'linemapObjectsChanged announces it, with its id', await gm.evaluate(() => window.__lm.changed))
  await gm.keyboard.press('Control+z')
  const undone = await until(gm, (id) => !canvas.linemap.objects.some(o => o.id === id) && !(canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).some(o => o.id === id), id)
  p.check(!!undone, 'Ctrl+Z takes the added symbol back, on the canvas and in the Scene')
  const gone = await until(gm, (id) => window.__lm.changed.some(c => c.deleted?.includes(id)), id)
  p.check(!!gone, 'and linemapObjectsChanged announces it deleted')

  // A small map, linked by id.
  const ids = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [a, b] = await api.add([api.symbol({ x: 600, y: 900 }), api.symbol({ x: 1400, y: 900, symbol: 'minor-site', size: 2 })])
    const [line] = await api.add(api.line({ from: a, to: b, style: 'minor' }))
    const [label, way] = await api.add([api.label({ text: 'Greyhaven', on: a }), api.waypoint({ line, t: 0.5 })])
    return { a, b, line, label, way }
  })
  const model = await gm.evaluate((ids) => {
    const L = canvas.linemap
    const o = (id) => L.objects.find(x => x.id === ids[id])
    const line = o('line')
    return {
      ends: line ? [line.points[0].sourceObject?.id, line.points.at(-1).sourceObject?.id, line.points[0].point, line.points.at(-1).point] : null,
      bSize: o('b')?.size,
      label: o('label') ? { on: o('label').point.sourceObject?.id, text: o('label').text, drawn: !!o('label').sprite } : null,
      way: o('way') ? { on: o('way').point.sourceObject?.id, point: o('way').point.point } : null
    }
  }, ids)
  p.check(!!model.ends && model.ends[0] === ids.a && model.ends[1] === ids.b && near(model.ends[2], [600, 900]) && near(model.ends[3], [1400, 900]), 'a line built from one symbol to another links to both', model)
  p.check(model.bSize === 2, 'a symbol is built at a size', model.bSize)
  p.check(!!model.label && model.label.on === ids.a && model.label.text === 'Greyhaven' && model.label.drawn, 'a label is built on a symbol, linked and drawn', model.label)
  p.check(!!model.way && model.way.on === ids.line && near(model.way.point, [1000, 900]), 'a waypoint is built halfway along the line', model.way)

  // update moves a symbol; what links to it follows.
  await gm.evaluate(async (a) => { await game.modules.get('linemap').api.update({ id: a, point: { point: [600, 500] } }) }, ids.a)
  const moved = await gm.evaluate((ids) => {
    const L = canvas.linemap
    const line = L.objects.find(o => o.id === ids.line)
    const saved = (L.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === ids.a)
    return { start: line.points[0].point, saved: saved?.point?.point }
  }, ids)
  p.check(near(moved.start, [600, 500]) && near(moved.saved, [600, 500]), 'update moves a symbol, saved, and the line linked to it follows', moved)

  // hide and reveal; a player sees what is revealed only.
  await gm.evaluate(async (b) => { await game.modules.get('linemap').api.hide(b) }, ids.b)
  s = await saved(gm)
  p.check(s.find(o => o.id === ids.b)?.isRevealed === false, 'hide hides an object, saved', s.find(o => o.id === ids.b))
  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, (n) => canvas.linemap?.objects?.length === n, s.length, { timeout: 20000 })
  const seen = await pl.evaluate((ids) => {
    const o = (id) => canvas.linemap.objects.find(x => x.id === id)
    return { a: !!o(ids.a)?.sprite, b: !!o(ids.b)?.sprite }
  }, ids)
  p.check(seen.a && !seen.b, 'a player is shown the revealed symbol and not the hidden one', seen)
  await gm.evaluate(async (b) => { await game.modules.get('linemap').api.reveal([b]) }, ids.b)
  const shown = await until(pl, (b) => !!canvas.linemap.objects.find(x => x.id === b)?.sprite, ids.b)
  p.check(!!shown, 'reveal shows it to the player')

  // A player may not edit through the API.
  const refused = await pl.evaluate(async () => {
    const api = game.modules.get('linemap').api
    try { await api.add(api.symbol({ x: 100, y: 100 })); return null } catch (err) { return String(err?.message ?? err) }
  })
  const afterPlayer = await saved(gm)
  p.check(!!refused && afterPlayer.length === s.length, 'a player calling add is refused, and nothing is saved', { refused, count: afterPlayer.length })

  // Unknown data is refused, unsaved.
  const bad = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const out = {}
    for (const [k, data] of Object.entries({ type: { type: 'nonsense' }, point: { type: 'symbol', symbol: 'curiosity' } })) {
      try { await api.add(data); out[k] = null } catch (err) { out[k] = String(err?.message ?? err) }
    }
    return out
  })
  p.check(!!bad.type && !!bad.point && (await saved(gm)).length === s.length, 'add refuses an unknown type and a symbol with no point, saving nothing', bad)

  // delete pins what was linked to the deleted object.
  await gm.evaluate(async (b) => { await game.modules.get('linemap').api.delete(b) }, ids.b)
  const pinned = await gm.evaluate((ids) => {
    const saved = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    const line = saved.find(o => o.id === ids.line)
    return { b: saved.some(o => o.id === ids.b), end: line?.points?.at(-1) }
  }, ids)
  p.check(!pinned.b && pinned.end?.sourceId === null && near(pinned.end?.point, [1400, 900]), 'delete removes an object, and the line end linked to it stays where it was', pinned)

  // The tools' own edits are announced too.
  const before = await gm.evaluate(() => window.__lm.changed.length)
  await tool(gm, 'drawSymbol')
  await clickAt(gm, { x: 1800, y: 1300 })
  const byTool = await until(gm, (n) => window.__lm.changed.length > n && window.__lm.changed.slice(n).some(c => c.changed?.length), before)
  p.check(!!byTool, 'an edit with the tools is announced by linemapObjectsChanged', await gm.evaluate((n) => window.__lm.changed.slice(n), before))

  // Another Scene: read and edited without viewing it.
  const otherId = await gm.evaluate(async (name) => {
    const scene = await foundry.documents.Scene.create({ name, width: 2000, height: 1500, padding: 0, grid: { type: 0 }, navigation: false })
    return scene.id
  }, `${PROBE_TAG} api, other`)
  p.cleanup(() => gm.evaluate(async (id) => { await game.scenes.get(id)?.delete() }, otherId))
  const other = await gm.evaluate(async (otherId) => {
    const api = game.modules.get('linemap').api
    const scene = game.scenes.get(otherId)
    const [id] = await api.add(api.symbol({ x: 500, y: 400, symbol: 'curiosity' }), { scene })
    return { id, read: api.objects(otherId).map(o => o.id), get: api.get(id, { scene: otherId })?.symbol, viewed: canvas.scene.id }
  }, otherId)
  const otherSaved = await saved(gm, otherId)
  p.check(other.viewed === sceneId && otherSaved.some(o => o.id === other.id) && other.read.includes(other.id) && other.get === 'curiosity',
    'add and objects work on a Scene that is not viewed, by document or id', { other, otherSaved })
  await viewScene(gm, otherId)
  const ready = await until(gm, (id) => window.__lm?.ready?.some(r => r.scene === id && r.layer), otherId)
  const shownThere = await gm.evaluate((id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, other.id)
  p.check(!!ready, 'linemapReady announces the layer drawing a Scene', await gm.evaluate(() => window.__lm?.ready))
  p.check(shownThere, 'viewing that Scene shows the symbol added to it')

  // api.undo takes back this user's last edit on the viewed Scene.
  const [extra] = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    return api.add(api.area({ points: [[200, 200], [400, 200], [300, 380]], pattern: 'dots' }))
  })
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  await gm.waitForTimeout(scaled(500))
  const areaGone = !(await saved(gm)).some(o => o.id === extra)
  p.check(typeof extra === 'string' && areaGone, 'an area is built, and api.undo takes it back', { extra })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
