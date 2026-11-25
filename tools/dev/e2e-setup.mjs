#!/usr/bin/env node
// dev:setup: what every other probe assumes. The module is active, its canvas layer and scene control
// are registered, its two label fonts are registered and load, its icons were fetched, and the world
// holds no probe leftovers. A red here explains the reds in every other probe.
import { MODULE_ID, PROBE_TAG, probe, probeScene, sweep, until } from './lib.mjs'

const p = probe('dev:setup', { watchdogMs: 180000 })
try {
  const page = await p.gmPage()
  const swept = await sweep(page)
  p.check(true, `joined as the Gamemaster (${swept} leftover probe document(s) swept)`)

  const r = await page.evaluate((id) => {
    const mod = game.modules.get(id)
    return {
      core: game.version,
      system: `${game.system.id} ${game.system.version}`,
      active: mod?.active === true,
      version: mod?.version,
      layer: CONFIG.Canvas.layers.linemap?.layerClass?.name ?? null,
      group: CONFIG.Canvas.layers.linemap?.group ?? null,
      fonts: Object.fromEntries((CONFIG.linemap?.labelFonts ?? []).map(f => [f, CONFIG.fontDefinitions[f]?.fonts?.length ?? 0])),
      objectTypes: Object.keys(CONFIG.linemap?.objectTypes ?? {}).sort(),
      symbols: Object.keys(CONFIG.linemap?.symbols ?? {}).length,
      lineStyles: Object.keys(CONFIG.linemap?.lineStyles ?? {}).length
    }
  }, MODULE_ID)
  console.log(`  note  Foundry ${r.core}, ${r.system}, ${MODULE_ID} ${r.version}`)
  p.check(r.active, `${MODULE_ID} is active in the world`)
  p.check(r.layer === 'LineMapLayer', 'CONFIG.Canvas.layers.linemap is the LineMapLayer', r.layer)
  p.check(['line', 'symbol', 'waypoint', 'area', 'text'].every(t => r.objectTypes.includes(t)), 'the five object types are registered', r.objectTypes)
  p.check(r.symbols > 0 && r.lineStyles > 0, 'symbols and line styles are configured', { symbols: r.symbols, lineStyles: r.lineStyles })
  p.check(JSON.stringify(Object.keys(r.fonts)) === JSON.stringify(['Alegreya', 'IM Fell English']), 'the label fonts are Alegreya, then IM Fell English', Object.keys(r.fonts))
  for (const [font, n] of Object.entries(r.fonts)) p.check(n >= 1, `${font} is in CONFIG.fontDefinitions`, n)

  // Core loads every font definition at startup; each face must have come from this module's files.
  const faces = await until(page, () => {
    const mine = [...document.fonts].filter(f => /Alegreya|IM Fell English/.test(f.family.replace(/"/g, '')))
    return mine.length && mine.every(f => f.status === 'loaded' || f.status === 'error') ? mine.map(f => `${f.family.replace(/"/g, '')} ${f.style} ${f.status}`) : null
  }, null, { timeout: 20000 })
  p.check(Array.isArray(faces) && faces.every(f => f.endsWith('loaded')), 'every Alegreya and IM Fell English face loaded', faces)
  const served = await page.evaluate(async () => {
    const urls = ['Alegreya', 'IM Fell English'].flatMap(f => CONFIG.fontDefinitions[f]?.fonts?.flatMap(d => d.urls) ?? [])
    return Promise.all(urls.map(async u => `${(await fetch(u)).status} ${u}`))
  })
  p.check(served.length >= 4 && served.every(s => s.startsWith('200 ')), "the four font files are served from the module's folder", served)

  // The control and the layer, on a Scene of the probe's own.
  await probeScene(p, page, 'setup')
  const c = await page.evaluate(() => ({
    control: Boolean(ui.controls.controls?.linemap),
    tools: Object.keys(ui.controls.controls?.linemap?.tools ?? {}),
    layer: canvas.linemap?.constructor?.name ?? null,
    onScene: canvas.scene?.name
  }))
  p.check(c.onScene?.startsWith(PROBE_TAG), "the probe's own Scene is on the canvas", c.onScene)
  p.check(c.control, 'the Line Map scene control is there for the Gamemaster')
  p.check(['selectObject', 'adjustObject', 'drawLine', 'drawSymbol', 'drawWaypoint', 'drawArea', 'drawText', 'clearObjects', 'newObjectsRevealed', 'adjustLinked', 'linemapSettings']
    .every(t => c.tools.includes(t)), 'the control has all eleven tools', c.tools)
  p.check(c.layer === 'LineMapLayer', 'canvas.linemap is drawn', c.layer)
  const icons = await page.evaluate(() => [...Object.entries(CONFIG.linemap.lineStyles), ...Object.entries(CONFIG.linemap.symbols)]
    .filter(([, s]) => typeof s.content !== 'string' || !s.content.includes('<svg')).map(([k]) => k))
  p.check(icons.length === 0, 'every line style and symbol icon was fetched at init', icons)
} catch (err) {
  await p.threw(err)
}
await p.finish()
