#!/usr/bin/env node
// dev:lifecycle: the layer across activation, redraws and input, the fixes of Foundry review #1 held
// as regression checks:
// - the stage keeps one set of Line Map listeners however often the layer is switched;
// - GPU framebuffers stay flat across select clicks and canvas redraws;
// - a tool's option bar goes when the layer is left;
// - Line Map is the layer a canvas redraw restores, and still draws afterwards;
// - the "adjusting linked points" button flips the setting and shows it;
// - the N key flips it on the Line Map layer only;
// - a double-click on empty canvas raises no error.
import { at, clickAt, probe, probeScene, sweep, tool, until } from './lib.mjs'

const p = probe('dev:lifecycle', { watchdogMs: 300000 })
const framebuffers = (page) => page.evaluate(() => canvas.app.renderer.framebuffer.managedFramebuffers.length)
const redrawCanvas = async (page) => {
  await page.evaluate(async () => { await canvas.draw() })
  await until(page, () => canvas.ready, null, { timeout: 30000 })
  await page.waitForTimeout(500)
}

try {
  const page = await p.gmPage()
  await sweep(page)
  await probeScene(p, page, 'lifecycle')
  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.3, 0.3))
  p.check(await page.evaluate(() => canvas.linemap.objects.length === 1), 'a symbol to redraw')

  // Listeners: Tokens <-> Line Map five times.
  await tool(page, 'selectObject')
  const lc0 = await page.evaluate(() => canvas.stage.listenerCount('pointermove'))
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => ui.controls.activate({ control: 'tokens' }))
    await page.waitForTimeout(200)
    await tool(page, 'selectObject')
  }
  const lc1 = await page.evaluate(() => canvas.stage.listenerCount('pointermove'))
  p.check(lc0 >= 1 && lc1 === lc0, 'the stage has the same pointermove listeners after five layer switches', `${lc0} -> ${lc1}`)

  // GPU memory: ten select clicks on empty canvas each redraw the map in high quality.
  const empty = await at(page, 0.7, 0.7)
  await clickAt(page, empty)
  const f0 = await framebuffers(page)
  for (let i = 0; i < 10; i++) await clickAt(page, { x: empty.x + i, y: empty.y })
  const f1 = await framebuffers(page)
  p.check(f1 - f0 <= 1, 'framebuffers stay flat over ten select clicks', `${f0} -> ${f1}`)

  // The option bar.
  await tool(page, 'drawLine')
  const bars0 = await until(page, () => document.querySelectorAll('#ui-top .linemap-tool-ui').length || null, null, { timeout: 5000 })
  await page.evaluate(() => ui.controls.activate({ control: 'tokens' }))
  await page.waitForTimeout(500)
  const bars1 = await page.evaluate(() => document.querySelectorAll('#ui-top .linemap-tool-ui').length)
  p.check(bars0 === 1 && bars1 === 0, "the line tool's option bar shows, and goes when the layer is left", `${bars0} -> ${bars1}`)

  // A canvas redraw restores Line Map, with working input.
  await tool(page, 'selectObject')
  await redrawCanvas(page)
  const restored = await page.evaluate(() => ({ layer: canvas.activeLayer?.constructor?.name, control: ui.controls.control?.name }))
  p.check(restored.layer === 'LineMapLayer' && restored.control === 'linemap', 'after canvas.draw() Line Map is still the active layer', restored)
  const lc2 = await page.evaluate(() => canvas.stage.listenerCount('pointermove'))
  p.check(lc2 >= 1, 'the restored layer has its stage listeners back', lc2)
  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.4, 0.3))
  p.check(await page.evaluate(() => canvas.linemap.objects.length === 2), 'the restored layer draws: a click places a second symbol')

  const fa = await framebuffers(page)
  for (let i = 0; i < 3; i++) await redrawCanvas(page)
  const fb = await framebuffers(page)
  p.check(fb - fa <= 2, 'framebuffers stay flat over three canvas redraws', `${fa} -> ${fb}`)

  // The linked-points button.
  await tool(page, 'selectObject')
  const t0 = await page.evaluate(() => canvas.linemap.adjustLinked)
  const seen = []
  for (let i = 0; i < 2; i++) {
    await page.locator('#scene-controls [data-tool="adjustLinked"]').first().click()
    await page.waitForTimeout(300)
    seen.push(await page.evaluate(() => ({ value: canvas.linemap.adjustLinked, button: ui.controls.tools?.adjustLinked?.active })))
  }
  p.check(t0 === true && seen[0].value === false && seen[0].button === false && seen[1].value === true && seen[1].button === true,
    'the "adjusting linked points" button turns the setting off and on, and shows it', { start: t0, seen })

  // The N key, off the layer and on it.
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.evaluate(() => ui.controls.activate({ control: 'tokens' }))
  await page.waitForTimeout(300)
  await page.keyboard.press('n')
  await page.waitForTimeout(300)
  const nTokens = await page.evaluate(() => canvas.linemap.adjustLinked)
  p.check(nTokens === true, 'N on the Tokens layer leaves the setting alone', nTokens)
  await tool(page, 'selectObject')
  await page.keyboard.press('n')
  await page.waitForTimeout(300)
  const nLinemap = await page.evaluate(() => ({ value: canvas.linemap.adjustLinked, button: ui.controls.tools?.adjustLinked?.active }))
  p.check(nLinemap.value === false && nLinemap.button === false, 'N on the Line Map layer turns it off, and the button shows it', nLinemap)
  await page.keyboard.press('n')
  await page.waitForTimeout(300)

  // A double-click on empty canvas.
  const e0 = p.errors.length
  await clickAt(page, await at(page, 0.8, 0.2), { clicks: 2 })
  await page.waitForTimeout(500)
  p.check(p.errors.length === e0, 'a double-click on empty canvas raises no error', p.errors.slice(e0))
} catch (err) {
  await p.threw(err)
}
await p.finish()
