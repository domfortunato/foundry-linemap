#!/usr/bin/env node
// dev:polish: the smaller findings of review #2.
// - Every Line Map key is a Gamemaster's (restricted), so players' Configure Controls do not list
//   actions that can never work for them.
// - The Line Map control's title is translatable, and the "delete all" confirmation has a title.
// - Each choice in a tool's options bar has a name, for a tooltip and a screen reader.
// - A Scene with no map allocates no map-sized render targets (every battlemap paid for three).
// - The map waits for its symbol art before it is first drawn: on a slow connection the symbols
//   were missing until a Gamemaster edited the map.
// - Loading the module fetches no art it never uses (the init hook read every icon into a field
//   nothing read).
import { at, clickAt, probe, probeScene, scaled, sweep, tool, until, viewScene, waitReady } from './lib.mjs'

const p = probe('dev:polish', { watchdogMs: 300000 })

try {
  const gm = await p.gmPage()
  await sweep(gm)

  // Keys.
  const keys = await gm.evaluate(() => [...game.keybindings.actions.entries()]
    .filter(([k]) => k.startsWith('linemap.')).map(([k, a]) => ({ k, restricted: !!a.restricted })))
  p.check(keys.length >= 15 && keys.every(k => k.restricted), "every Line Map key is restricted to Gamemasters", keys.filter(k => !k.restricted).map(k => k.k))

  // An empty Scene.
  const emptyId = await probeScene(p, gm, 'polish empty')
  const empty = await gm.evaluate(() => ({ render: !!canvas.linemap.renderTexture, line: !!canvas.linemap.lineTexture, mask: !!canvas.linemap.maskTexture }))
  p.check(!empty.render && !empty.line && !empty.mask, 'a Scene with no map allocates no render targets for it', empty)
  const S = await at(gm, 0.3, 0.3)
  await tool(gm, 'drawSymbol')
  await clickAt(gm, S)
  const drawn = await gm.evaluate(() => !!canvas.linemap.renderTexture && canvas.linemap.objects.length === 1)
  p.check(drawn, 'and the first symbol drawn there gets them', drawn)

  // Names.
  const title = await gm.evaluate(() => ({ title: ui.controls.controls.linemap?.title, has: game.i18n.has(ui.controls.controls.linemap?.title ?? '') }))
  p.check(title.has, "the Line Map control's title is a translatable key", title)
  const unnamed = {}
  for (const t of ['drawLine', 'drawSymbol', 'drawWaypoint', 'drawArea']) {
    await tool(gm, t)
    await until(gm, () => document.querySelectorAll('#ui-top .linemap-style-select').length > 0, null, { timeout: 5000 })
    unnamed[t] = await gm.evaluate(() => [...document.querySelectorAll('#ui-top .linemap-style-select')]
      .filter(a => !a.getAttribute('aria-label') || !a.dataset.tooltip).length)
  }
  p.check(Object.values(unnamed).every(n => n === 0), "every choice in the tools' options bars has a name and a tooltip", unnamed)

  await tool(gm, 'selectObject')
  await gm.locator('#scene-controls [data-tool="clearObjects"]').first().click()
  const dialog = await until(gm, () => {
    const d = [...document.querySelectorAll('.application.dialog')].find(e => e.offsetParent !== null || e.open)
    return d ? { title: d.querySelector('.window-title')?.textContent?.trim() ?? '' } : null
  }, null, { timeout: 5000 })
  p.check(dialog && dialog.title.length > 0, 'the "delete all" confirmation has a title', dialog)
  await gm.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app instanceof foundry.applications.api.DialogV2) await app.close()
  })
  await gm.waitForTimeout(scaled(400))
  p.check(await gm.evaluate(() => canvas.linemap.objects.length === 1), 'closing it deletes nothing')

  // Slow symbol art. Routing turns the browser's cache off, so every file is fetched again.
  const fetched = []
  // Line style art is only ever shown as an <img> in the options bar; only the init hook fetched it.
  gm.on('request', r => { if (r.url().includes('/modules/linemap/assets/lines/') && r.resourceType() === 'fetch') fetched.push(r.url()) })
  await gm.route('**/modules/linemap/assets/**/*.svg', async (route) => {
    await new Promise(r => setTimeout(r, 12000))
    await route.continue().catch(() => {})
  })
  // Not reload(): it waits for the network to go quiet, which would wait for the delayed art too.
  await gm.reload({ waitUntil: 'domcontentloaded', timeout: scaled(60000) })
  await waitReady(gm, 'after a reload with slow art')
  await viewScene(gm, emptyId)
  const px = await gm.evaluate((pt) => {
    const L = canvas.linemap
    if (!L.renderTexture) return { opaque: -1 }
    const rect = new PIXI.Rectangle(pt.x - 40, pt.y - 40, 80, 80)
    const data = canvas.app.renderer.extract.pixels(L.renderTexture, rect)
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 250) opaque++
    return { opaque }
  }, S)
  p.check(px.opaque > 20, 'with the symbol art slow to arrive, the symbol is drawn once the Scene shows', px)
  p.check(fetched.length === 0, 'loading the module fetches no line style art by script', fetched.slice(0, 3))
  await gm.unroute('**/modules/linemap/assets/**/*.svg')
} catch (err) {
  await p.threw(err)
}
await p.finish()
