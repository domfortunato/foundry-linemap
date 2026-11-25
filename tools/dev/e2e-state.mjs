#!/usr/bin/env node
// dev:state: the layer's state holds across redraws, tool changes and windows (review #2).
// - A canvas redraw that restores Line Map restores its tool too: its option bar, and its keys.
// - A tool switched twice in one moment leaves no option bar of the first behind.
// - A tool change in the middle of a drag ends the drag cleanly: no error, nothing half-moved.
// - A drag released off the canvas leaves the map as the Scene holds it (PIXI still delivers the
//   release, so the drop happens; kept as a regression check).
// - The right-click menu closes with Escape (which then does not open Foundry's main menu) and with a
//   click elsewhere.
// - A label being edited when another Gamemaster saves keeps the edit.
// - The scene settings window, left open while another Scene is viewed, never writes the first
//   Scene's settings into the second.
import { PROBE_TAG, at, clickAt, probe, probeScene, screenAt, scaled, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const GM2 = `${PROBE_TAG} GM2`
const FORM = '#linemap-scene-properties'
const p = probe('dev:state', { watchdogMs: 300000 })
const bars = (page) => page.evaluate(() => document.querySelectorAll('#ui-top .linemap-tool-ui').length)
const redrawCanvas = async (page) => {
  await page.evaluate(async () => { await canvas.draw() })
  await until(page, () => canvas.ready, null, { timeout: 30000 })
  await page.waitForTimeout(scaled(600))
}
/** The symbol's point on the canvas and as saved. */
const where = (page, id) => page.evaluate((id) => ({
  canvas: canvas.linemap.objects.find(o => o.id === id)?.serialized?.point?.point,
  saved: (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.point?.point
}), id)
const menuOpen = (page) => page.evaluate(() => !!document.querySelector('#linemap-context-menu'))

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneA = await probeScene(p, gm, 'state A')
  const S = await at(gm, 0.3, 0.3)
  await tool(gm, 'drawSymbol')
  await clickAt(gm, S)
  const sid = await gm.evaluate(() => canvas.linemap.objects[0]?.id)
  p.check(!!sid, 'a symbol to work on')

  // 1. A redraw restores the tool.
  await tool(gm, 'drawLine')
  await redrawCanvas(gm)
  const restored = { tool: await gm.evaluate(() => canvas.linemap.activeTool === canvas.linemap.tools.drawLine), bars: await bars(gm) }
  p.check(restored.tool && restored.bars === 1, "after a canvas redraw the line tool is active again, with its option bar", restored)
  await tool(gm, 'selectObject')
  await clickAt(gm, S)
  await redrawCanvas(gm)
  await gm.evaluate(() => document.activeElement?.blur?.())
  await gm.evaluate((id) => canvas.linemap.setSelection(canvas.linemap.objects.find(o => o.id === id)), sid)
  await gm.keyboard.press('h')
  await gm.waitForTimeout(scaled(800))
  const hidden = await gm.evaluate((id) => canvas.linemap.objects.find(o => o.id === id)?.isRevealed, sid)
  p.check(hidden === false, 'and after a redraw H hides the selected symbol', hidden)
  await gm.keyboard.press('r')
  await gm.waitForTimeout(scaled(500))

  // 2. Two tool changes in one moment.
  await gm.evaluate(() => {
    canvas.linemap.activateTool('drawLine')
    canvas.linemap.activateTool('selectObject')
  })
  await gm.waitForTimeout(scaled(1500))
  p.check(await bars(gm) === 0, 'switching to the line tool and straight on leaves no line option bar behind', await bars(gm))
  await tool(gm, 'selectObject')

  // 3. A tool change mid-drag.
  const e0 = p.errors.length
  const before = await where(gm, sid)
  await clickAt(gm, S)
  const c = await screenAt(gm, S)
  await gm.mouse.move(c.x, c.y)
  await gm.mouse.down()
  await gm.mouse.move(c.x + 40, c.y + 20, { steps: 6 })
  await gm.mouse.move(c.x + 80, c.y + 40, { steps: 6 })
  await gm.keyboard.press('l')
  await gm.waitForTimeout(scaled(400))
  await gm.mouse.move(c.x + 120, c.y + 60, { steps: 6 })
  await gm.mouse.up()
  await gm.waitForTimeout(scaled(800))
  const midSelect = await where(gm, sid)
  p.check(p.errors.length === e0, 'switching to the line tool in the middle of a move raises no error', p.errors.slice(e0, e0 + 2))
  p.check(JSON.stringify(midSelect.canvas) === JSON.stringify(before.saved) && JSON.stringify(midSelect.saved) === JSON.stringify(before.saved),
    'and the symbol is where it was, on the canvas and in the Scene', { before, after: midSelect })
  const e1 = p.errors.length
  const L0 = await at(gm, 0.6, 0.6)
  const l = await screenAt(gm, L0)
  await gm.mouse.move(l.x, l.y)
  await gm.mouse.down()
  await gm.mouse.move(l.x + 60, l.y, { steps: 6 })
  await gm.keyboard.press('v')
  await gm.waitForTimeout(scaled(400))
  await gm.mouse.move(l.x + 120, l.y + 30, { steps: 6 })
  await gm.mouse.up()
  await gm.waitForTimeout(scaled(800))
  const midLine = await where(gm, sid)
  const lines = await gm.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type === 'line').length)
  p.check(p.errors.length === e1 && JSON.stringify(midLine.canvas) === JSON.stringify(before.saved) && lines === 0,
    'switching to the select tool in the middle of a line draws nothing, moves nothing, raises no error', { errors: p.errors.slice(e1, e1 + 2), midLine, lines })

  // 4. A drag that leaves the canvas.
  await tool(gm, 'selectObject')
  await clickAt(gm, S)
  const c2 = await screenAt(gm, S)
  await gm.mouse.move(c2.x, c2.y)
  await gm.mouse.down()
  await gm.mouse.move(c2.x + 60, c2.y + 30, { steps: 8 })
  const side = await gm.evaluate(() => { const r = document.querySelector('#sidebar')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
  await gm.mouse.move(side?.x ?? 1590, side?.y ?? 500, { steps: 12 })
  await gm.mouse.up()
  await gm.mouse.move(c2.x - 100, c2.y + 100, { steps: 12 })
  await gm.waitForTimeout(scaled(1000))
  const out = await where(gm, sid)
  p.check(JSON.stringify(out.canvas) === JSON.stringify(out.saved), 'a move released off the canvas leaves the symbol where the Scene has it', out)

  // 5. The right-click menu.
  await tool(gm, 'selectObject')
  await gm.evaluate((id) => canvas.linemap.setSelection(canvas.linemap.objects.find(o => o.id === id)), sid)
  await clickAt(gm, S, { button: 'right' })
  const opened = await until(gm, () => !!document.querySelector('#linemap-context-menu'), null, { timeout: 5000 })
  await gm.keyboard.press('Escape')
  await gm.waitForTimeout(scaled(600))
  const esc = { menu: await menuOpen(gm), mainMenu: await gm.evaluate(() => !!ui.menu?.rendered) }
  p.check(opened && !esc.menu && !esc.mainMenu, 'Escape closes the right-click menu, and does not open the main menu', { opened, ...esc })
  if (esc.mainMenu) await gm.evaluate(() => ui.menu.close())
  await clickAt(gm, S, { button: 'right' })
  await until(gm, () => !!document.querySelector('#linemap-context-menu'), null, { timeout: 5000 })
  const menuInfo = () => gm.evaluate(() => {
    const t = canvas.linemap.tools.selectObject
    const app = foundry.applications.instances.get('linemap-context-menu')
    return { held: !!t.menu, heldRendered: t.menu?.rendered, same: t.menu === app, app: !!app, appState: app?.state, menuAt: t.menuAt, active: game.activeTool, dom: document.querySelectorAll('#linemap-context-menu').length }
  })
  const m0 = await menuInfo()
  // A raw screen point: clickAt pans its target to the middle of the screen, where the menu is.
  await gm.mouse.move(m0.menuAt.x - 300, m0.menuAt.y - 200, { steps: 8 })
  await gm.mouse.down()
  await gm.mouse.up()
  await gm.waitForTimeout(scaled(500))
  const m1 = await menuInfo()
  p.check(!(await menuOpen(gm)), 'a click elsewhere on the canvas closes it', { before: m0, after: m1 })
  await gm.evaluate(async () => { for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-context-menu') await app.close({ animate: false }) })

  // 6. A label edit while another Gamemaster saves.
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 4 }) }, GM2)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, GM2))
  const gm2 = await p.pageAs(GM2)
  await viewScene(gm2, sceneA)
  const T = await at(gm, 0.5, 0.75)
  await writeLabel(gm, T, 'Old Ford')
  await tool(gm, 'selectObject')
  await clickAt(gm, T, { clicks: 2 })
  await gm.waitForSelector('textarea.linemap-text-content', { timeout: scaled(10000) })
  await gm2.evaluate(() => {
    const r = canvas.dimensions.sceneRect
    const data = { type: 'symbol', isRevealed: true, point: { point: [r.x + r.width * 0.8, r.y + r.height * 0.3] }, symbol: 'curiosity' }
    const o = CONFIG.linemap.objectTypes.symbol.create(data)
    o.deserialize({ ...data, id: o.id }, {})
    canvas.linemap.addObject(o)
  })
  await until(gm, () => canvas.linemap.objects.length >= 3, null, { timeout: 8000 })
  await gm.fill('textarea.linemap-text-content', 'New Ford')
  await gm.keyboard.press('Enter')
  await gm.waitForTimeout(scaled(1500))
  const label = await gm.evaluate(() => ({
    canvas: canvas.linemap.objects.filter(o => o.constructor.type === 'text').map(o => o.text),
    saved: (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).filter(o => o.type === 'text').map(o => o.text)
  }))
  p.check(label.canvas.join() === 'New Ford' && label.saved.join() === 'New Ford', "a label edited while another Gamemaster saves keeps the new text, on the canvas and in the Scene", label)

  // 7. The settings window across Scenes.
  await gm.evaluate(async () => {
    canvas.linemap.color = '#00aa00'
    canvas.linemap.redraw()
    await canvas.linemap.dataChanged()
  })
  await tool(gm, 'selectObject')
  await gm.locator('#scene-controls [data-tool="linemapSettings"]').first().click()
  await gm.waitForSelector(`${FORM} select[name="labelFont"]`, { timeout: scaled(10000) })
  // Viewed without the probe helpers, which close every framed window on the way.
  const sceneB = await gm.evaluate(async (name) => (await foundry.documents.Scene.create({
    name, width: 3000, height: 2000, padding: 0, grid: { type: 0 }, navigation: false
  })).id, `${PROBE_TAG} state B`)
  p.cleanup(() => gm.evaluate(async (id) => { await game.scenes.get(id)?.delete() }, sceneB))
  await gm.evaluate(async (id) => { await game.scenes.get(id).view() }, sceneB)
  await until(gm, (id) => canvas.ready && canvas.scene?.id === id, sceneB, { timeout: 60000 })
  await gm.waitForTimeout(scaled(800))
  const stillOpen = await gm.evaluate((FORM) => !!document.querySelector(`${FORM} select[name="labelFont"]`), FORM)
  if (stillOpen) {
    const other = await gm.evaluate((FORM) => [...document.querySelectorAll(`${FORM} select[name="labelFont"] option`)].map(o => o.value).find(v => v !== canvas.linemap.labelFont), FORM)
    await gm.selectOption(`${FORM} select[name="labelFont"]`, other)
    await gm.waitForTimeout(scaled(1200))
  }
  const b = await gm.evaluate(() => ({ saved: canvas.linemap.constructor.readFlag(canvas.scene)?.color ?? null, shown: canvas.linemap.color }))
  p.check(stillOpen, 'the settings window is still open after another Scene is viewed', stillOpen)
  p.check(b.saved !== '#00aa00' && b.shown !== '#00aa00', "and a change in it never gives that Scene the first Scene's colour", b)
  await gm.evaluate(async () => { for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-scene-properties') await app.close({ animate: false }) })
} catch (err) {
  await p.threw(err)
}
await p.finish()
