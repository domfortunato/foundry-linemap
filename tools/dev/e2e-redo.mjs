#!/usr/bin/env node
// dev:redo: redo (ROADMAP 7.6). Undo keeps what it took back, for redo, until a new edit is made.
// - Ctrl+Y (and Ctrl+Shift+Z) brings back an undone symbol, with the same id where it was; a move
//   undone and redone puts it back where it was moved to; a deletion is redone too.
// - Two undos and two redos replay the edits in order. `api.redo()` redoes like the keys.
// - Undo, then a new edit: redo does nothing. Leaving the layer forgets redo, as it forgets undo.
import { clickAt, dragThrough, moduleWarnings, probe, probeScene, scaled, sweep, tool, until } from './lib.mjs'

const p = probe('dev:redo', { watchdogMs: 300000 })

const P = { x: 800, y: 800 }
const Q = { x: 1400, y: 800 }
const R = { x: 1100, y: 1300 }

const symbols = (page) => page.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? [])
  .filter(o => o.type === 'symbol').map(o => ({ id: o.id, at: o.point.point.map(Math.round) })))
const press = async (page, keys) => {
  await page.keyboard.press(keys)
  await page.waitForTimeout(scaled(600))
}
const near = (pt, at, tol = 4) => Array.isArray(at) && Math.abs(at[0] - pt.x) <= tol && Math.abs(at[1] - pt.y) <= tol

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'redo')

  await tool(gm, 'drawSymbol')
  await clickAt(gm, P)
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 1)
  const [first] = await symbols(gm)
  await press(gm, 'Control+z')
  p.check((await symbols(gm)).length === 0, 'Ctrl+Z takes the new symbol back')
  await press(gm, 'Control+y')
  let now = await symbols(gm)
  p.check(now.length === 1 && now[0].id === first.id && near(P, now[0].at), 'Ctrl+Y brings it back, with the same id, where it was', { first, now })

  await press(gm, 'Control+z')
  await press(gm, 'Control+Shift+z')
  now = await symbols(gm)
  p.check(now.length === 1 && now[0].id === first.id, 'Ctrl+Shift+Z redoes too', now)

  // A move.
  await tool(gm, 'selectObject')
  await clickAt(gm, P)
  await dragThrough(gm, [P, { x: (P.x + Q.x) / 2, y: P.y }, Q])
  await until(gm, (q) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).some(o => Math.abs(o.point.point[0] - q.x) < 6), Q)
  await press(gm, 'Control+z')
  const back = await symbols(gm)
  await press(gm, 'Control+y')
  now = await symbols(gm)
  p.check(near(P, back[0]?.at) && near(Q, now[0]?.at, 6) && now[0].id === first.id, 'a move undone and redone puts the symbol where it was moved to', { back, now })

  // Two edits, two undos, two redos.
  await tool(gm, 'drawSymbol')
  await clickAt(gm, R)
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 2)
  await press(gm, 'Control+z')
  await press(gm, 'Control+z')
  const undone = await symbols(gm)
  await press(gm, 'Control+y')
  const once = await symbols(gm)
  await gm.evaluate(async () => { await game.modules.get('linemap').api.redo() })
  await gm.waitForTimeout(scaled(600))
  const twice = await symbols(gm)
  p.check(undone.length === 1 && near(P, undone[0].at) && once.length === 1 && near(Q, once[0].at, 6) && twice.length === 2,
    'two undos and two redos (the second through api.redo) replay the edits in order', { undone, once, twice })

  // A deletion.
  await tool(gm, 'selectObject')
  await clickAt(gm, R)
  await press(gm, 'Delete')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 1)
  await press(gm, 'Control+z')
  const restored = (await symbols(gm)).length
  await press(gm, 'Control+y')
  p.check(restored === 2 && (await symbols(gm)).length === 1, 'a deletion undone and redone is gone again', { restored, now: await symbols(gm) })

  // Undo, then a new edit: nothing to redo.
  await press(gm, 'Control+z')
  await tool(gm, 'drawSymbol')
  await clickAt(gm, { x: 1700, y: 1300 })
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).length === 3)
  const beforeRedo = await symbols(gm)
  await press(gm, 'Control+y')
  const afterRedo = await symbols(gm)
  p.check(JSON.stringify(afterRedo) === JSON.stringify(beforeRedo), 'after undo and a new edit, redo does nothing', { beforeRedo, afterRedo })

  // Leaving the layer forgets redo.
  await press(gm, 'Control+z')
  await gm.evaluate(() => ui.controls.activate({ control: 'tokens', tool: 'select' }))
  await gm.waitForTimeout(scaled(400))
  await tool(gm, 'selectObject')
  const left = await symbols(gm)
  await press(gm, 'Control+y')
  p.check(JSON.stringify(await symbols(gm)) === JSON.stringify(left), 'after leaving the layer, redo does nothing (as undo is forgotten)', { left, now: await symbols(gm) })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
