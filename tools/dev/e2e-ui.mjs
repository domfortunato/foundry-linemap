#!/usr/bin/env node
// dev:ui: the module's controls and dialogs, as a Gamemaster meets them.
// - The Line Map control has an order of its own, and sits after core's controls.
// - The right-click menu names its two options (Hide objects, Reveal objects) for a tooltip and a
//   screen reader, not just with an icon.
// - Text typed into the label dialog is not written to the console.
// - With the canvas turned off (core's "Disable Game Canvas"), the module's keys raise no error.
import { at, clickAt, dismissChrome, probe, probeScene, scaled, sweep, tool, writeLabel } from './lib.mjs'

const p = probe('dev:ui', { watchdogMs: 300000 })

try {
  const page = await p.gmPage()
  const logs = []
  page.on('console', m => { if (m.type() === 'log' || m.type() === 'info' || m.type() === 'debug') logs.push(m.text()) })
  await sweep(page)
  await probeScene(p, page, 'ui')
  await tool(page, 'selectObject')

  // The control's order.
  const controls = await page.evaluate(() => {
    const list = Object.values(ui.controls.controls)
    const mine = ui.controls.controls.linemap
    const rendered = [...document.querySelectorAll('#scene-controls [data-control]')].map(e => e.dataset.control)
    return {
      order: mine?.order,
      coreMax: Math.max(...list.filter(c => c.name !== 'linemap' && Number.isFinite(c.order)).map(c => c.order)),
      rendered: [...new Set(rendered)]
    }
  })
  p.check(Number.isFinite(controls.order) && controls.order > controls.coreMax, "the Line Map control has a numeric order after core's controls", controls)
  p.check(controls.rendered.at(-1) === 'linemap' || controls.rendered.indexOf('linemap') > controls.rendered.indexOf('notes'),
    'and is drawn after them', controls.rendered)

  // The right-click menu.
  const S = await at(page, 0.3, 0.3)
  await tool(page, 'drawSymbol')
  await clickAt(page, S)
  await tool(page, 'selectObject')
  await clickAt(page, S)
  await clickAt(page, S, { button: 'right' })
  await page.waitForSelector('#linemap-context-menu .linemap-menu-item', { timeout: scaled(10000) })
  const items = await page.evaluate(() => [...document.querySelectorAll('#linemap-context-menu .linemap-menu-item')]
    .map(a => ({ option: a.dataset.option, label: a.getAttribute('aria-label'), tooltip: a.dataset.tooltip ?? a.dataset.tooltipText ?? null })))
  const want = await page.evaluate(() => ({ left: game.i18n.localize('linemap.menu.hide'), right: game.i18n.localize('linemap.menu.reveal') }))
  p.check(items.length === 2 && items.every(i => i.label === want[i.option] && i.tooltip),
    'the right-click menu labels its options (aria-label and tooltip)', { items, want })
  await page.evaluate(async () => { for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-context-menu') await app.close({ animate: false }) })

  // The label dialog and the console.
  const SECRET = 'Quiet Marsh of Whispers'
  const l0 = logs.length
  await writeLabel(page, await at(page, 0.6, 0.6), SECRET)
  const written = await page.evaluate((t) => canvas.linemap.objects.some(o => o.text === t), SECRET)
  const leaked = logs.slice(l0).filter(t => t.includes(SECRET))
  p.check(written && leaked.length === 0, 'the label is written, and its text never reaches the console', { written, leaked })

  // No canvas.
  await page.evaluate(() => game.settings.set('core', 'noCanvas', true))
  p.cleanup(async () => {
    await page.evaluate(() => game.settings.set('core', 'noCanvas', false)).catch(() => {})
  })
  await page.reload({ waitUntil: 'networkidle', timeout: scaled(60000) })
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: scaled(90000) })
  await dismissChrome(page)
  const e0 = p.errors.length
  const state = await page.evaluate(() => ({ noCanvas: game.settings.get('core', 'noCanvas'), layer: typeof canvas?.linemap }))
  await page.evaluate(() => document.activeElement?.blur?.())
  for (const key of ['v', 'a', 'l', 's', 't', 'r', 'h', 'd', 'b', 'i', 'n', 'Delete', 'Control+z']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(500)
  p.check(state.noCanvas === true && p.errors.length === e0, "with the canvas off, the module's keys raise no error", { state, errors: p.errors.slice(e0, e0 + 3) })
  await page.evaluate(() => game.settings.set('core', 'noCanvas', false))
} catch (err) {
  await p.threw(err)
}
await p.finish()
