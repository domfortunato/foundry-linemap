#!/usr/bin/env node
// dev:setup: what every other probe assumes. The module is active, its canvas layer and scene control
// are registered, its two label fonts are registered and load, its art files are served, and the world
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

  // Core loads every font definition at startup (FontConfig.loadFont adds a face to document.fonts only
  // once it has loaded, and only warns when one fails); each face must have come from this module's files.
  const readFaces = () => page.evaluate(() => {
    const mine = [...document.fonts].filter(f => /Alegreya|IM Fell English/.test(f.family.replace(/"/g, '')))
    return {
      faces: mine.map(f => `${f.family.replace(/"/g, '')} ${f.style} ${f.weight} ${f.status}`),
      check: { Alegreya: document.fonts.check('1rem "Alegreya"'), 'IM Fell English': document.fonts.check('1rem "IM Fell English"') },
      all: document.fonts.size
    }
  })
  await until(page, () => {
    const mine = [...document.fonts].filter(f => /Alegreya|IM Fell English/.test(f.family.replace(/"/g, '')))
    return mine.length >= 4 && mine.every(f => f.status === 'loaded' || f.status === 'error')
  }, null, { timeout: 20000 })
  const faces = await readFaces()
  const fontWarnings = p.warnings.filter(w => /font/i.test(String(w)))
  p.check(faces.faces.length >= 4 && faces.faces.every(f => f.endsWith('loaded')) && faces.check.Alegreya && faces.check['IM Fell English'],
    'every Alegreya and IM Fell English face loaded', { ...faces, fontWarnings })
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
  p.check(['selectObject', 'adjustObject', 'drawLine', 'drawSymbol', 'drawWaypoint', 'drawArea', 'drawText', 'drawImage', 'clearObjects', 'newObjectsRevealed', 'adjustLinked', 'linemapSettings']
    .every(t => c.tools.includes(t)), 'the control has all twelve tools', c.tools)
  p.check(c.layer === 'LineMapLayer', 'canvas.linemap is drawn', c.layer)
  // The art is there to load (the init hook no longer reads it into CONFIG, which nothing used).
  const icons = await page.evaluate(async () => {
    const c = CONFIG.linemap
    const urls = [...Object.values(c.lineStyles).map(s => s.icon), ...Object.values(c.symbols).flatMap(s => [s.icon, s.footprint]),
      ...Object.values(c.waypoints).flatMap(s => [s.icon, s.footprint]), ...Object.values(c.patterns).map(s => s.texture)].filter(Boolean)
    const bad = []
    for (const url of urls) {
      const r = await fetch(url, { method: 'HEAD' })
      if (!r.ok) bad.push(`${url} ${r.status}`)
    }
    return { count: urls.length, bad }
  })
  p.check(icons.count >= 20 && icons.bad.length === 0, `every icon, footprint and pattern file is served (${icons.count})`, icons.bad)
} catch (err) {
  await p.threw(err)
}
await p.finish()
