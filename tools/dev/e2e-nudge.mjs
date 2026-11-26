#!/usr/bin/env node
// dev:nudge: the arrow keys move the selection (ROADMAP 7.8).
// - One press moves a selected symbol by one pixel, and the line and the label linked to it follow;
//   with Shift, by ten.
// - A burst of presses is saved once, as one edit that one undo takes back.
// - With nothing selected, the arrow keys still pan the canvas, as core does.
import { clickAt, moduleWarnings, probe, probeScene, scaled, sweep, tool, until } from './lib.mjs'

const p = probe('dev:nudge', { watchdogMs: 240000 })

const A = { x: 800, y: 800 }
const B = { x: 1500, y: 800 }

const live = (page, ids) => page.evaluate((ids) => {
  const L = canvas.linemap
  const get = (id) => L.objects.find(o => o.id === id)
  return {
    a: get(ids.a)?.point.point.map(v => Math.round(v * 100) / 100),
    lineStart: get(ids.road)?.points[0].point.map(v => Math.round(v * 100) / 100),
    lineLinked: get(ids.road)?.points[0].sourceObject === get(ids.a),
    label: get(ids.label)?.point.point.map(v => Math.round(v * 100) / 100)
  }
}, ids)
const savedA = (page, id) => page.evaluate((id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.point.point, id)
const press = async (page, key, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
  await page.waitForTimeout(scaled(150))
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'nudge')
  const ids = await gm.evaluate(async ({ A, B }) => {
    const api = game.modules.get('linemap').api
    const [a, b] = await api.add([api.symbol({ x: A.x, y: A.y, symbol: 'minor-site' }), api.symbol({ x: B.x, y: B.y, symbol: 'minor-site' })])
    const [road] = await api.add(api.line({ from: a, to: b }))
    const [label] = await api.add(api.label({ text: 'Greyhaven', on: a }))
    return { a, b, road, label }
  }, { A, B })

  await tool(gm, 'selectObject')
  await clickAt(gm, A)
  const before = await live(gm, ids)
  const pivot0 = await gm.evaluate(() => [canvas.stage.pivot.x, canvas.stage.pivot.y])
  await press(gm, 'ArrowRight')
  let now = await live(gm, ids)
  p.check(now.a?.[0] === before.a[0] + 1 && now.a?.[1] === before.a[1], 'one press of → moves the selected symbol one pixel right', { before: before.a, now: now.a })
  p.check(now.lineLinked && now.lineStart[0] === now.a[0] && now.label?.[0] === before.label[0] + 1, 'the line and the label linked to it follow', { before, now })
  const pivot1 = await gm.evaluate(() => [canvas.stage.pivot.x, canvas.stage.pivot.y])
  p.check(pivot1[0] === pivot0[0] && pivot1[1] === pivot0[1], 'the canvas does not pan while something is selected', { pivot0, pivot1 })
  const saved = await until(gm, ({ id, x }) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.point.point[0] === x, { id: ids.a, x: before.a[0] + 1 })
  p.check(!!saved, 'the move is saved', await savedA(gm, ids.a))

  await press(gm, 'Shift+ArrowDown')
  now = await live(gm, ids)
  p.check(now.a?.[1] === before.a[1] + 10, 'Shift+↓ moves it ten pixels down', now.a)
  await gm.waitForTimeout(scaled(1200))

  // A burst, one edit.
  const start = (await live(gm, ids)).a
  const records = await gm.evaluate(() => canvas.linemap.undoHistory.length)
  await press(gm, 'ArrowLeft', 5)
  now = await live(gm, ids)
  await until(gm, ({ id, x }) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.point.point[0] === x, { id: ids.a, x: start[0] - 5 })
  const added = (await gm.evaluate(() => canvas.linemap.undoHistory.length)) - records
  p.check(now.a?.[0] === start[0] - 5 && added === 1, 'five presses of ← move it five pixels, saved as one edit', { start, now: now.a, added })
  await press(gm, 'Control+z')
  await gm.waitForTimeout(scaled(500))
  now = await live(gm, ids)
  p.check(now.a?.[0] === start[0] && now.a?.[1] === start[1], 'one undo takes the whole burst back', { start, now: now.a })

  // Nothing selected: core pans.
  await gm.evaluate(() => canvas.linemap.setSelection())
  const p0 = await gm.evaluate(() => [canvas.stage.pivot.x, canvas.stage.pivot.y])
  const a0 = (await live(gm, ids)).a
  await gm.keyboard.down('ArrowRight')
  await gm.waitForTimeout(scaled(400))
  await gm.keyboard.up('ArrowRight')
  await gm.waitForTimeout(scaled(600))
  const p1 = await gm.evaluate(() => [canvas.stage.pivot.x, canvas.stage.pivot.y])
  p.check(p1[0] !== p0[0] && JSON.stringify((await live(gm, ids)).a) === JSON.stringify(a0), 'with nothing selected, → pans the canvas and moves nothing', { p0, p1 })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
