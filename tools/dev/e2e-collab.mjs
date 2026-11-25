#!/usr/bin/env node
// dev:collab: two Gamemasters on the same map.
// - Each sees what the other draws, without a reload.
// - A Gamemaster's undo takes back only their own edit, never the other's.
// - Two edits saved at the same moment both survive, on both clients and in the Scene's flag (each
//   object is its own flag key, so the server merges the two saves).
import { PROBE_TAG, at, clickAt, probe, probeScene, sweep, tool, until, viewScene } from './lib.mjs'

const GM2 = `${PROBE_TAG} GM2`
const p = probe('dev:collab', { watchdogMs: 300000 })
const ids = (page) => page.evaluate(() => canvas.linemap.objects.map(o => o.id))
/** Add a symbol through the layer's own API, as a tool would. */
const addSymbol = (page, fx, fy) => page.evaluate(({ fx, fy }) => {
  const r = canvas.dimensions.sceneRect
  const data = { type: 'symbol', isRevealed: true, point: { point: [r.x + r.width * fx, r.y + r.height * fy] }, symbol: 'curiosity' }
  const o = CONFIG.linemap.objectTypes.symbol.create(data)
  o.deserialize({ ...data, id: o.id }, {})
  canvas.linemap.addObject(o)
  return o.id
}, { fx, fy })

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'collab')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 4 }) }, GM2)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, GM2))
  const gm2 = await p.pageAs(GM2)
  await viewScene(gm2, sceneId)
  await tool(gm, 'selectObject')
  await tool(gm2, 'selectObject')

  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.25, 0.3))
  const [mine] = await ids(gm)
  const seen2 = await until(gm2, (id) => canvas.linemap.objects.some(o => o.id === id), mine)
  p.check(seen2, "the second Gamemaster sees the first one's symbol without a reload")

  await tool(gm2, 'drawSymbol')
  await clickAt(gm2, await at(gm2, 0.6, 0.3))
  const theirs = (await ids(gm2)).find(id => id !== mine)
  const seen1 = await until(gm, (id) => canvas.linemap.objects.some(o => o.id === id), theirs)
  p.check(theirs && seen1, "the first Gamemaster sees the second one's symbol without a reload")

  await tool(gm, 'selectObject')
  await gm.evaluate(() => document.activeElement?.blur?.())
  await gm.keyboard.press('Control+z')
  await gm.waitForTimeout(1500)
  const after = { gm: await ids(gm), gm2: await ids(gm2), saved: await gm.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).map(o => o.id)) }
  p.check(!after.gm.includes(mine) && after.saved.length === 1 && !after.saved.includes(mine), "the first Gamemaster's undo takes back their own symbol", after)
  p.check(after.gm.includes(theirs) && after.gm2.includes(theirs) && after.saved.includes(theirs), "and leaves the second Gamemaster's symbol", after)
  p.check(!after.gm2.includes(mine), 'the symbol taken back is gone from the second Gamemaster\'s canvas too', after)

  // Both save at once: neither has seen the other's edit when it sends its own.
  const [c, d] = await Promise.all([addSymbol(gm, 0.3, 0.7), addSymbol(gm2, 0.7, 0.7)])
  await gm.waitForTimeout(2500)
  const both = {
    gm: await ids(gm),
    gm2: await ids(gm2),
    saved: await gm.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).map(o => o.id))
  }
  const has = (list) => list.includes(c) && list.includes(d)
  p.check(has(both.saved), "two symbols saved at the same moment are both in the Scene's flag", { c, d, ...both })
  p.check(has(both.gm) && has(both.gm2), 'and both Gamemasters have both', { c, d, ...both })
} catch (err) {
  await p.threw(err)
}
await p.finish()
