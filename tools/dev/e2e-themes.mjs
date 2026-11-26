#!/usr/bin/env node
// dev:themes: themes shipped with the module (ROADMAP step 6). A theme is a preset: picking one in
// the scene settings sets the map's colour, label font, halo and background picture, and the symbol
// and line sets its tools show. The values it sets stay editable.
// - Sci-fi: a starfield background, Orbitron labels, its own symbols (namespaced `scifi:` keys) and
//   lane and jump lines. Its symbols draw, and lines link to them.
// - Fantasy: today's symbols, a parchment background, IM Fell English, dark brown.
// - A map made in one theme still loads and draws after switching to the other, after a reload, and
//   for a player; switching replaces the theme's background instead of stacking another.
import { PROBE_TAG, at, clickAt, dragThrough, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:themes', { watchdogMs: 420000 })
const FORM = '#linemap-scene-properties'
const PLAYER = `${PROBE_TAG} Themes Player`

const openSettings = async (page) => {
  await tool(page, 'selectObject')
  await page.locator('#scene-controls [data-tool="linemapSettings"]').first().click()
  await page.waitForSelector(`${FORM} select[name="labelFont"]`, { timeout: 10000 })
  await page.waitForTimeout(300)
}
const closeSettings = (page) => page.evaluate(async () => {
  for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-scene-properties') await app.close({ animate: false })
})
const themeOptions = (page) => page.evaluate((FORM) => [...document.querySelectorAll(`${FORM} select[name="theme"] option`)].map(o => o.value), FORM)
const pickTheme = async (page, id) => {
  await openSettings(page)
  await page.locator(`${FORM} select[name="theme"]`).first().selectOption(id)
  const ok = await until(page, (id) => canvas.scene.flags?.linemap?.map?.theme === id &&
    canvas.linemap.objects.some(o => o.constructor.type === 'image' && o.src === CONFIG.linemap.themes[id]?.background), id)
  await page.waitForTimeout(scaled(800))
  await closeSettings(page)
  return !!ok
}
const map = (page) => page.evaluate(() => {
  const L = canvas.linemap
  const m = canvas.scene.flags?.linemap?.map ?? {}
  const backgrounds = L.objects.filter(o => o.constructor.type === 'image').map(o => ({ src: o.src, rect: o.rect, sort: o.sort }))
  const lowest = Math.min(...L.objects.map(o => o.sort))
  return { saved: m, color: L.color, labelFont: L.labelFont, halo: L.halo, backgrounds, lowest, count: L.objects.length, sceneRect: [canvas.dimensions.sceneRect.x, canvas.dimensions.sceneRect.y, canvas.dimensions.sceneRect.width, canvas.dimensions.sceneRect.height] }
})
/** The colour the map rendered at an empty spot of the Scene, and its luma. */
const backdrop = (page) => page.evaluate(() => {
  const L = canvas.linemap
  L.setSelection()
  L.redraw()
  const s = canvas.dimensions.sceneRect
  const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + s.width - 120, s.y + s.height - 120, 40, 40))
  let r = 0, g = 0, b = 0, a = 0
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3] }
  const n = d.length / 4
  const rgb = [r / n, g / n, b / n]
  return { rgb: rgb.map(Math.round), alpha: Math.round(a / n), luma: Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) }
})
/** How many pixels around each symbol are near the map's colour (the symbol drawn over the background). */
const symbolsDrawn = (page) => page.evaluate(() => {
  const L = canvas.linemap
  L.setSelection()
  L.redraw()
  const want = foundry.utils.Color.from(L.color).rgb.map(v => v * 255)
  return L.objects.filter(o => o.constructor.type === 'symbol').map(o => {
    const [x, y] = o.point.point
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(Math.round(x) - 30, Math.round(y) - 30, 60, 60))
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 240 && [0, 1, 2].every(k => Math.abs(d[i + k] - want[k]) <= 30)) n++
    return { symbol: o.symbol, pixels: n }
  })
})
const shelf = async (page, toolName, action) => {
  await tool(page, toolName)
  await page.waitForSelector(`#linemap-tool-options [data-action="${action}"]`, { timeout: 10000 })
  return page.evaluate((action) => [...document.querySelectorAll(`#linemap-tool-options [data-action="${action}"]`)].map(e => e.dataset.lineStyle), action)
}
const labelInfo = (page) => page.evaluate(() => {
  const t = canvas.linemap.objects.find(o => o.constructor.type === 'text')
  const font = t?.sprite?.style?.fontFamily
  const family = Array.isArray(font) ? font[0] : String(font ?? '').split(',')[0]
  return { family, width: t?.sprite?.width ?? 0, loaded: document.fonts.check(`36px "${family}"`) }
})

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'themes')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  const w0 = p.warnings.length
  await openSettings(gm)
  const options = await themeOptions(gm)
  await closeSettings(gm)
  p.check(options.includes('fantasy') && options.includes('scifi'), 'the scene settings offer the fantasy and sci-fi themes', options)
  if (!options.includes('scifi')) throw new Error('there is no theme to pick')

  // Sci-fi.
  const applied = await pickTheme(gm, 'scifi')
  let m = await map(gm)
  const scifi = await gm.evaluate(() => CONFIG.linemap.themes.scifi)
  p.check(applied && m.saved.theme === 'scifi', "picking sci-fi saves it as the Scene's theme", m.saved)
  p.check(m.color === scifi.color && m.labelFont === 'Orbitron' && m.halo === true, 'it sets the colour, the Orbitron label font and the halo', m)
  const bg = m.backgrounds.find(b => b.src === scifi.background)
  p.check(!!bg && JSON.stringify(bg.rect) === JSON.stringify(m.sceneRect) && bg.sort === m.lowest, 'and puts its starfield under the map, covering the Scene', m)
  const dark = await until(gm, () => {
    const L = canvas.linemap
    const s = canvas.dimensions.sceneRect
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + s.width - 100, s.y + s.height - 100, 1, 1))
    return d[3] > 240
  })
  let back = await backdrop(gm)
  p.check(!!dark && back.alpha > 240 && back.luma < 60, 'the starfield is drawn: an empty spot of the Scene is dark', back)

  const symbols = await shelf(gm, 'drawSymbol', 'set-symbol')
  p.check(symbols.length >= 6 && symbols.every(k => k.startsWith('scifi:')), "the symbol tool shows the sci-fi set, its keys namespaced", symbols)
  const pick = async (key) => {
    await gm.locator(`#linemap-tool-options [data-action="set-symbol"][data-line-style="${key}"]`).first().click()
    await gm.waitForTimeout(scaled(300))
  }
  const A = await at(gm, 0.3, 0.35)
  const B = await at(gm, 0.6, 0.35)
  await pick('scifi:station')
  await clickAt(gm, A)
  await pick('scifi:planet')
  await clickAt(gm, B)
  const lines = await shelf(gm, 'drawLine', 'set-line-style')
  p.check(lines.includes('lane') && lines.includes('jump'), 'the line tool shows lane and jump lines', lines)
  await gm.locator('#linemap-tool-options [data-action="set-line-style"][data-line-style="lane"]').first().click()
  await gm.waitForTimeout(scaled(300))
  await dragThrough(gm, [A, { x: (A.x + B.x) / 2, y: A.y + 2 }, B])
  await writeLabel(gm, await at(gm, 0.45, 0.6), 'Kepler Reach')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 5)
  const linked = await gm.evaluate(() => {
    const L = canvas.linemap
    const syms = L.objects.filter(o => o.constructor.type === 'symbol')
    const line = L.objects.find(o => o.constructor.type === 'line')
    return {
      symbols: syms.map(s => s.symbol),
      style: line?.style,
      ends: line ? [line.points[0].sourceObject?.symbol ?? null, line.points.at(-1).sourceObject?.symbol ?? null] : null
    }
  })
  p.check(JSON.stringify(linked.symbols) === JSON.stringify(['scifi:station', 'scifi:planet']), 'the sci-fi symbols are placed with their keys', linked)
  p.check(linked.style === 'lane' && JSON.stringify(linked.ends) === JSON.stringify(['scifi:station', 'scifi:planet']), 'a lane drawn between them links to both', linked)
  let drawn = await symbolsDrawn(gm)
  p.check(drawn.length === 2 && drawn.every(d => d.pixels > 40), 'the sci-fi symbols draw in the map colour over the starfield', drawn)
  const orbitron = await labelInfo(gm)
  p.check(orbitron.family === 'Orbitron' && orbitron.loaded, 'labels are set in Orbitron, loaded', orbitron)

  // Fantasy, over the same map.
  const appliedF = await pickTheme(gm, 'fantasy')
  m = await map(gm)
  const fantasy = await gm.evaluate(() => CONFIG.linemap.themes.fantasy)
  p.check(appliedF && m.color === fantasy.color && m.labelFont === 'IM Fell English', 'picking fantasy sets dark brown and IM Fell English', m)
  p.check(m.backgrounds.length === 1 && m.backgrounds[0].src === fantasy.background && m.backgrounds[0].sort === m.lowest, "its parchment replaces the starfield, not stacked on it", m.backgrounds)
  await until(gm, () => {
    const L = canvas.linemap
    const s = canvas.dimensions.sceneRect
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + s.width - 100, s.y + s.height - 100, 1, 1))
    return d[3] > 240 && d[0] > 150
  })
  back = await backdrop(gm)
  p.check(back.alpha > 240 && back.luma > 150 && back.rgb[0] > back.rgb[2], 'the parchment is drawn: an empty spot is light and warm', back)
  const fell = await labelInfo(gm)
  p.check(fell.family === 'IM Fell English' && Math.abs(fell.width - orbitron.width) > 4, 'the label is set again, in IM Fell English', { fell, orbitron })
  const fsymbols = await shelf(gm, 'drawSymbol', 'set-symbol')
  p.check(fsymbols.length >= 6 && fsymbols.every(k => !k.includes(':')) && fsymbols.includes('major-settlement'), "the symbol tool shows today's symbols", fsymbols)
  drawn = await symbolsDrawn(gm)
  p.check(m.count === 6 && drawn.every(d => d.pixels > 40), 'the sci-fi symbols still draw after switching to fantasy', { count: m.count, drawn })

  // The values a theme sets stay editable.
  await openSettings(gm)
  await gm.evaluate((FORM) => { document.querySelector(`${FORM} color-picker[name="color"]`).value = '#203040' }, FORM)
  const edited = await until(gm, () => canvas.scene.flags?.linemap?.map?.color === '#203040')
  await closeSettings(gm)
  m = await map(gm)
  p.check(!!edited && m.saved.theme === 'fantasy', 'a value the theme set can be changed afterwards, and the theme stays', m.saved)
  p.check(moduleWarnings(p.warnings, w0).length === 0, 'the settings window raises no deprecation warning from this module', moduleWarnings(p.warnings, w0))

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, () => canvas.linemap.objects.length === 6)
  drawn = await symbolsDrawn(gm)
  m = await map(gm)
  p.check(m.saved.theme === 'fantasy' && m.count === 6 && drawn.every(d => d.pixels > 40), 'after a reload the map loads, in its theme, its sci-fi symbols drawn', { theme: m.saved.theme, drawn })

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.length === 6, null, { timeout: 20000 })
  await until(pl, () => {
    const L = canvas.linemap
    const s = canvas.dimensions.sceneRect
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + s.width - 100, s.y + s.height - 100, 1, 1))
    return d[3] > 240
  })
  back = await backdrop(pl)
  drawn = await symbolsDrawn(pl)
  p.check(back.luma > 150 && drawn.every(d => d.pixels > 40), 'a player is shown the background and the symbols', { back, drawn })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
