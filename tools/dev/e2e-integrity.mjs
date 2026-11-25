#!/usr/bin/env node
// dev:integrity: what is saved is what every Gamemaster sees, however edits meet (review #2).
// - Settings saved on a Scene with nothing drawn yet are read back, by another client live and by
//   this one after a reload.
// - An edit and its undo, made faster than the server answers, leave the Scene as the canvas shows
//   it: Foundry's client drops an update that matches its not-yet-updated copy of the Scene.
// - Two Gamemasters editing the same object at once end with the same object as the Scene holds.
// - A broken entry in the Scene's flag (no type, or an id that is not its key, as a delete crossing
//   an edit can leave) is not loaded as an object, and the next save removes it.
// - A line linked to an object this build does not know keeps that link when it is edited.
import { PROBE_TAG, probe, probeScene, reload, sweep, until, viewScene } from './lib.mjs'

const GM2 = `${PROBE_TAG} GM2`
const p = probe('dev:integrity', { watchdogMs: 300000 })
const saved = (page) => page.evaluate(() => canvas.linemap.constructor.readFlag(canvas.scene) ?? null)
const savedIds = async (page) => ((await saved(page))?.objects ?? []).map(o => o.id)
const canvasIds = (page) => page.evaluate(() => canvas.linemap.objects.map(o => o.id))
/** Add a symbol through the layer's own API, as the symbol tool does. */
const addSymbol = (page, fx, fy) => page.evaluate(({ fx, fy }) => {
  const r = canvas.dimensions.sceneRect
  const data = { type: 'symbol', isRevealed: true, point: { point: [r.x + r.width * fx, r.y + r.height * fy] }, symbol: 'curiosity' }
  const o = CONFIG.linemap.objectTypes.symbol.create(data)
  o.deserialize({ ...data, id: o.id }, {})
  canvas.linemap.addObject(o)
  return o.id
}, { fx, fy })
const settle = (page, ms = 2000) => page.waitForTimeout(ms)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'integrity')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 4 }) }, GM2)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, GM2))
  const gm2 = await p.pageAs(GM2)
  await viewScene(gm2, sceneId)

  // 1. Settings before anything is drawn.
  const e0 = p.errors.length
  await gm.evaluate(async () => {
    canvas.linemap.color = '#ff0000'
    canvas.linemap.redraw()
    await canvas.linemap.dataChanged()
  })
  await settle(gm, 1500)
  p.check((await saved(gm))?.color === '#ff0000', 'a colour set on a Scene with nothing drawn reads back from the Scene', await saved(gm))
  const live = await until(gm2, () => canvas.linemap.color === '#ff0000', null, { timeout: 5000 })
  p.check(live && p.errors.length === e0, 'and another Gamemaster takes it live, with no error', { color: await gm2.evaluate(() => canvas.linemap.color), errors: p.errors.slice(e0, e0 + 2) })
  await reload(gm)
  await viewScene(gm, sceneId)
  p.check(await gm.evaluate(() => canvas.linemap.color) === '#ff0000', 'and it is still the colour after a reload', await gm.evaluate(() => canvas.linemap.color))

  // 2. An edit and its undo inside one round trip.
  const fast = await gm.evaluate(async () => {
    const L = canvas.linemap
    const r = canvas.dimensions.sceneRect
    const data = { type: 'symbol', isRevealed: true, point: { point: [r.x + r.width * 0.2, r.y + r.height * 0.2] }, symbol: 'curiosity' }
    const o = CONFIG.linemap.objectTypes.symbol.create(data)
    o.deserialize({ ...data, id: o.id }, {})
    L.addObject(o)
    await L.undo()
    return o.id
  })
  await settle(gm)
  p.check(!(await savedIds(gm)).includes(fast) && !(await canvasIds(gm2)).includes(fast),
    'a symbol drawn and undone at once is in neither the Scene nor the other canvas', { saved: await savedIds(gm), gm2: await canvasIds(gm2) })

  const kept = await addSymbol(gm, 0.4, 0.2)
  await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).some(o => o.id === id), kept)
  await settle(gm, 800)
  await gm.evaluate(async (id) => {
    const L = canvas.linemap
    L.deleteObjects(L.objects.find(o => o.id === id))
    await L.undo()
  }, kept)
  await settle(gm)
  p.check((await savedIds(gm)).includes(kept) && (await canvasIds(gm2)).includes(kept),
    'a symbol deleted and undone at once is still in the Scene and on the other canvas', { saved: await savedIds(gm), gm2: await canvasIds(gm2) })

  // 3. The same object edited by both at once.
  const both = await addSymbol(gm, 0.6, 0.2)
  await until(gm2, (id) => canvas.linemap.objects.some(o => o.id === id), both)
  await settle(gm, 800)
  await Promise.all([
    gm.evaluate((id) => {
      const L = canvas.linemap
      L.objects.find(o => o.id === id).isRevealed = false
      L.registerHistory()
    }, both),
    gm2.evaluate((id) => {
      const L = canvas.linemap
      const r = canvas.dimensions.sceneRect
      L.objects.find(o => o.id === id).point.unconstrainedPoint = [r.x + r.width * 0.65, r.y + r.height * 0.4]
      L.registerHistory()
    }, both)
  ])
  await settle(gm, 3000)
  const view = (page) => page.evaluate((id) => {
    const o = canvas.linemap.objects.find(o => o.id === id)?.serialized
    const s = (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)
    return { canvas: o && { isRevealed: o.isRevealed, point: o.point.point }, scene: s && { isRevealed: s.isRevealed, point: s.point.point } }
  }, both)
  const v1 = await view(gm)
  const v2 = await view(gm2)
  p.check(JSON.stringify(v1.canvas) === JSON.stringify(v1.scene) && JSON.stringify(v2.canvas) === JSON.stringify(v2.scene),
    'after both edit one symbol at once, each canvas shows the symbol the Scene holds', { gm: v1, gm2: v2 })

  // 4. A broken entry in the flag.
  await gm.evaluate(async () => {
    await canvas.scene.update({
      'flags.linemap.objects.fragment00000001': { isRevealed: true },
      'flags.linemap.objects.misfiled00000001': { id: 'otherId000000001', type: 'symbol', isRevealed: true, point: { point: [100, 100] }, symbol: 'curiosity' }
    })
    canvas.linemap.fetchData()
    canvas.linemap.redraw()
  })
  const loadedIds = await canvasIds(gm)
  p.check(!loadedIds.some(id => !(id === kept || id === both)), 'broken flag entries are not loaded as objects', loadedIds)
  await addSymbol(gm, 0.8, 0.2)
  await settle(gm)
  const keys = await gm.evaluate(() => Object.keys(canvas.scene.flags.linemap?.objects ?? {}))
  p.check(!keys.includes('fragment00000001') && !keys.includes('misfiled00000001'), 'and the next save removes them from the Scene', keys)

  // 5. A link to an object of a type this build does not know.
  await gm.evaluate(async () => {
    const r = canvas.dimensions.sceneRect
    await canvas.scene.update({
      'flags.linemap.objects.unknownType00001': { id: 'unknownType00001', type: 'no-such-type', isRevealed: true, sort: 50, extra: 7 },
      'flags.linemap.objects.linkedLine000001': {
        id: 'linkedLine000001', type: 'line', isRevealed: true, sort: 51, style: 'major',
        points: [{ point: [r.x + 300, r.y + 1500], sourceId: 'unknownType00001', sourceT: 0 }, { point: [r.x + 900, r.y + 1500], sourceId: null, sourceT: null }]
      }
    })
    canvas.linemap.fetchData()
    canvas.linemap.redraw()
  })
  await until(gm2, () => canvas.linemap.objects.some(o => o.id === 'linkedLine000001'))
  await gm2.evaluate(() => {
    const L = canvas.linemap
    const line = L.objects.find(o => o.id === 'linkedLine000001')
    line.isRevealed = !line.isRevealed
    L.registerHistory()
  })
  await settle(gm)
  await addSymbol(gm, 0.8, 0.5)
  await settle(gm)
  const link = await gm.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === 'linkedLine000001')?.points?.[0])
  p.check(link?.sourceId === 'unknownType00001', 'a line linked to an unknown object keeps the link through edits by both Gamemasters', link)
} catch (err) {
  await p.threw(err)
}
await p.finish()
