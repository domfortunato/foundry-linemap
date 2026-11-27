#!/usr/bin/env node
// dev:palette: a floating tool palette, instead of the tools column on Foundry's left bar. A client
// setting (Configure Settings, off by default). While it is on and the Line Map layer is active, a
// small draggable window holds the Line Map tools, toggles and buttons, and the left bar's tools
// column is hidden; the Line Map control button itself stays, as Foundry needs it.
// - Off: no palette. On: the palette shows the layer's tools, and the tools column is hidden.
// - A tool picked in the palette is the active tool, marked in the palette; a hotkey's tool is marked
//   too. A toggle flips its setting; a button runs (Layers opens its window).
// - On another layer the palette goes and the tools column is back; back on Line Map it returns.
// - It is dragged by its header and stays there after a reload. Closing it turns the setting off.
import { moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:palette', { watchdogMs: 300000 })

const palette = (page) => page.locator('#linemap-palette')
const visible = async (page) => (await palette(page).count()) > 0 && await palette(page).first().isVisible()
const toolsColumnShown = (page) => page.evaluate(() => {
  const el = document.querySelector('#scene-controls-tools')
  return !!el && getComputedStyle(el).display !== 'none'
})
const pressed = (page, name) => page.locator(`#linemap-palette [data-tool="${name}"]`).first().getAttribute('aria-pressed')
const setPalette = (page, on) => page.evaluate(async (on) => { await game.settings.set('linemap', 'floatingPalette', on) }, on)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'palette')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })
  p.cleanup(() => gm.evaluate(async () => {
    await game.settings.set('linemap', 'floatingPalette', false)
    await game.settings.set('linemap', 'palettePosition', {})
  }).catch(() => {}))
  await tool(gm, 'selectObject')

  const registered = await gm.evaluate(() => game.settings.settings.has('linemap.floatingPalette') && game.settings.get('linemap', 'floatingPalette') === false)
  p.check(registered && !(await visible(gm)) && await toolsColumnShown(gm), 'off by default: no palette, the tools column on the left bar', registered)
  if (!registered) throw new Error('no floatingPalette setting')

  await setPalette(gm, true)
  await until(gm, () => !!document.querySelector('#linemap-palette'))
  await gm.waitForTimeout(scaled(400))
  const names = await gm.evaluate(() => [...document.querySelectorAll('#linemap-palette [data-tool]')].map(b => b.dataset.tool))
  const expected = await gm.evaluate(() => Object.values(ui.controls.controls.linemap.tools).filter(t => t.visible !== false).map(t => t.name))
  await p.shot(gm, 'palette')
  p.check(await visible(gm) && expected.every(n => names.includes(n)), 'on: the palette shows every Line Map tool, toggle and button', { names, expected })
  p.check(!(await toolsColumnShown(gm)) && (await gm.locator('#scene-controls [data-control="linemap"]').count()) > 0,
    'the tools column is hidden; the Line Map control button stays')

  // A tool, a hotkey, a toggle, a button.
  await gm.locator('#linemap-palette [data-tool="drawLine"]').first().click()
  await gm.waitForTimeout(scaled(400))
  const lineTool = await gm.evaluate(() => ({ tool: ui.controls.tool?.name, layer: canvas.linemap.activeTool?.constructor?.name }))
  p.check(lineTool.tool === 'drawLine' && (await pressed(gm, 'drawLine')) === 'true' && (await pressed(gm, 'selectObject')) === 'false',
    'a tool picked in the palette is the active tool, and marked there', lineTool)
  await gm.mouse.move(800, 500)
  await gm.keyboard.press('KeyS')
  await until(gm, () => ui.controls.tool?.name === 'drawSymbol')
  await gm.waitForTimeout(scaled(300))
  p.check((await pressed(gm, 'drawSymbol')) === 'true', "a hotkey's tool is marked in the palette too")
  const linked = await gm.evaluate(() => canvas.linemap.adjustLinked)
  await gm.locator('#linemap-palette [data-tool="adjustLinked"]').first().click()
  await gm.waitForTimeout(scaled(400))
  const flipped = await gm.evaluate(() => canvas.linemap.adjustLinked)
  p.check(flipped === !linked && (await pressed(gm, 'adjustLinked')) === String(flipped), 'a toggle in the palette flips its setting, and shows it', { linked, flipped })
  await gm.locator('#linemap-palette [data-tool="adjustLinked"]').first().click()
  await gm.locator('#linemap-palette [data-tool="linemapLayers"]').first().click()
  const layers = await until(gm, () => !!document.querySelector('#linemap-layers'), null, { timeout: 8000 }).catch(() => false)
  p.check(!!layers, 'a button in the palette runs (Layers opens its window)')
  await gm.evaluate(async () => { await foundry.applications.instances.get('linemap-layers')?.close() })

  // Another layer, and back.
  await gm.evaluate(() => ui.controls.activate({ control: 'tokens' }))
  await gm.waitForTimeout(scaled(600))
  const away = { palette: await visible(gm), column: await toolsColumnShown(gm) }
  await gm.evaluate(() => ui.controls.activate({ control: 'linemap' }))
  await until(gm, () => !!document.querySelector('#linemap-palette'))
  await gm.waitForTimeout(scaled(400))
  p.check(!away.palette && away.column && await visible(gm), 'on another layer the palette goes and the tools column is back; on Line Map it returns', away)

  // Dragged by its header; kept after a reload.
  const header = gm.locator('#linemap-palette .window-header').first()
  const box = await header.boundingBox()
  await gm.mouse.move(box.x + 30, box.y + box.height / 2)
  await gm.mouse.down()
  await gm.mouse.move(box.x + 230, box.y + box.height / 2 + 150, { steps: 12 })
  await gm.mouse.up()
  await gm.waitForTimeout(scaled(800))
  const moved = await gm.evaluate(() => { const r = document.querySelector('#linemap-palette').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) } })
  await reload(gm)
  await viewScene(gm, sceneId)
  await tool(gm, 'selectObject')
  await until(gm, () => !!document.querySelector('#linemap-palette'), null, { timeout: 15000 })
  await gm.waitForTimeout(scaled(600))
  const kept = await gm.evaluate(() => { const r = document.querySelector('#linemap-palette').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) } })
  p.check(Math.abs(moved.left - box.x - 200) < 40 && Math.abs(kept.left - moved.left) <= 4 && Math.abs(kept.top - moved.top) <= 4,
    'dragged by its header, the palette stays where it was put after a reload', { box: { x: Math.round(box.x), y: Math.round(box.y) }, moved, kept })

  // Closing it turns it off.
  await gm.locator('#linemap-palette [data-action="close"]').first().click()
  await gm.waitForTimeout(scaled(600))
  const off = await gm.evaluate(() => game.settings.get('linemap', 'floatingPalette'))
  p.check(off === false && !(await visible(gm)) && await toolsColumnShown(gm), "closing the palette turns the setting off and brings the tools column back", off)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
