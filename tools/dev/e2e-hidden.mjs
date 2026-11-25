#!/usr/bin/env node
// dev:hidden: what a player is shown. The Gamemaster draws a symbol, a label and an area revealed,
// then turns "new objects revealed" off with its button and draws the same three hidden. A player,
// on the same Scene, has the revealed three drawn and none of the hidden ones, the Gamemaster still
// sees all six, and an object the Gamemaster reveals-draws while the player watches reaches the
// player without a reload. The player has no Line Map control.
//
// It checks only what is drawn. The hidden objects' data is still in the Scene's flag, which every
// client can read: whether it must not be is an open design question, not asserted here.
import { PROBE_TAG, at, clickAt, dragThrough, probe, probeScene, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const PLAYER = `${PROBE_TAG} Player`
const p = probe('dev:hidden', { watchdogMs: 300000 })

/** On a page: per type, how many objects there are and how many are drawn. */
const shown = (page) => page.evaluate(() => {
  const L = canvas.linemap
  const out = {}
  for (const o of L.objects) {
    const t = o.constructor.type
    out[t] ??= { all: 0, revealed: 0, drawn: 0 }
    out[t].all++
    if (o.isRevealed) out[t].revealed++
    if (t !== 'area' && t !== 'line' && o.sprite?.parent && o.sprite.visible !== false) out[t].drawn++
  }
  // Areas have no sprite: each drawn one is a child of the first container a redraw makes.
  if (out.area) out.area.drawn = L.drawn?.[0]?.children?.length ?? 0
  return out
})

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'hidden')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  await tool(gm, 'selectObject')
  p.check(await gm.evaluate(() => canvas.linemap.revealNewObjects === true), 'new objects start revealed')
  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.25, 0.25))
  await writeLabel(gm, await at(gm, 0.25, 0.45), 'Shown Label')
  await tool(gm, 'drawArea')
  await dragThrough(gm, [await at(gm, 0.15, 0.6), await at(gm, 0.25, 0.7), await at(gm, 0.35, 0.85)])

  await gm.locator('#scene-controls [data-tool="newObjectsRevealed"]').first().click()
  await gm.waitForTimeout(400)
  const toggled = await gm.evaluate(() => ({ value: canvas.linemap.revealNewObjects, button: ui.controls.tools?.newObjectsRevealed?.active }))
  p.check(toggled.value === false && toggled.button === false, 'the "new objects revealed" button turns revealing off, and shows it off', toggled)
  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.65, 0.25))
  await writeLabel(gm, await at(gm, 0.65, 0.45), 'Secret Label')
  await tool(gm, 'drawArea')
  await dragThrough(gm, [await at(gm, 0.55, 0.6), await at(gm, 0.65, 0.7), await at(gm, 0.75, 0.85)])
  await gm.locator('#scene-controls [data-tool="newObjectsRevealed"]').first().click()
  await gm.waitForTimeout(400)

  const saved = await until(gm, () => (canvas.scene.getFlag('linemap', 'serialized')?.objects?.length ?? 0) === 6)
  p.check(saved, "the six objects are saved in the Scene's flag")
  const g = await shown(gm)
  p.check(['symbol', 'text', 'area'].every(t => g[t]?.all === 2 && g[t]?.revealed === 1), 'the Gamemaster has one revealed and one hidden symbol, label and area', g)
  p.check(g.symbol?.drawn === 2 && g.text?.drawn === 2 && g.area?.drawn === 2, 'the Gamemaster sees all six drawn', g)

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.length === 6, null, { timeout: 20000 })
  const v = await shown(pl)
  p.check(v.symbol?.all === 2 && v.text?.all === 2 && v.area?.all === 2, "the player's layer read all six from the Scene", v)
  p.check(v.symbol?.drawn === 1, 'the player is shown the revealed symbol and not the hidden one', v.symbol)
  p.check(v.text?.drawn === 1, 'the player is shown the revealed label and not the hidden one', v.text)
  p.check(v.area?.drawn === 1, 'the player is shown the revealed area and not the hidden one', v.area)
  const labels = await pl.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type === 'text' && o.sprite?.parent).map(o => o.text))
  p.check(JSON.stringify(labels) === JSON.stringify(['Shown Label']), 'the one label drawn for the player is the revealed one', labels)
  p.check(await pl.evaluate(() => !ui.controls.controls?.linemap), 'the player has no Line Map control')

  // Drawn live, while the player watches: their client redraws from the Scene update.
  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.45, 0.15))
  const live = await until(pl, () => {
    const n = canvas.linemap.objects.filter(o => o.constructor.type === 'symbol' && o.sprite?.parent).length
    return n === 2 ? n : null
  }, null, { timeout: 15000 })
  p.check(live === 2, "a revealed symbol drawn while the player watches reaches the player's canvas", live)
} catch (err) {
  await p.threw(err)
}
await p.finish()
