#!/usr/bin/env node
// dev:color: any content colour (ROADMAP.md, feature 1). The scene settings take a colour instead of
// black or white. A Gamemaster picks one in the settings window, and the map's symbols, lines, labels
// and areas are drawn in it: read back from the pixels the layer rendered, not from its settings. The
// colour is saved in the Scene's flag, with the nearest of black and white beside it for builds that
// know only those, and survives a reload. A player is shown the same colour, and a change reaches the
// player without a reload. A map saved before the setting existed keeps its black or white. When the
// colour is the selection colour, selection shows in another.
import { PROBE_TAG, at, clickAt, dragThrough, moduleWarnings, probe, probeScene, reload, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:color', { watchdogMs: 400000 })
const FORM = '#linemap-scene-properties'
const PLAYER = `${PROBE_TAG} Color Player`
const TEAL = '#7fd1c4' // light: its nearest of black and white is white
const BLUE = '#3060a0' // dark

/**
 * Per object type on a page, the opaque pixels the layer rendered around one object of that type, and
 * how many are the wanted colour. Selection is cleared first, so nothing is in the selection colour.
 */
const rendered = (page, colour) => page.evaluate((colour) => {
  const L = canvas.linemap
  L.setSelection()
  L.redraw()
  const want = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
  const near = (pt, r) => {
    const rect = new PIXI.Rectangle(Math.round(pt[0] - r), Math.round(pt[1] - r), 2 * r, 2 * r)
    const px = canvas.app.renderer.extract.pixels(L.renderTexture, rect)
    let opaque = 0
    let match = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 250) continue
      opaque++
      if ([0, 1, 2].every(c => Math.abs(px[i + c] - want[c]) <= 8)) match++
    }
    return { opaque, match }
  }
  const of = (type) => L.objects.find(o => o.constructor.type === type)
  const line = of('line')?.points?.map(pt => pt.point)
  return {
    symbol: of('symbol') ? near(of('symbol').point.point, 20) : null,
    line: line ? near(line[Math.floor(line.length / 2)], 10) : null,
    text: of('text')?.sprite ? near([of('text').sprite.x, of('text').sprite.y], 24) : null,
    area: of('area')?.points ? near(of('area').points[0], 8) : null
  }
}, colour)
/** Every sampled type has opaque pixels, and most of them are the colour. */
const allIn = (r, types = ['symbol', 'line', 'text', 'area']) =>
  types.every(t => r[t] && r[t].opaque > 0 && r[t].match >= r[t].opaque * 0.6)
const saved = (page) => page.evaluate(() => {
  const s = canvas.linemap.constructor.readFlag(canvas.scene) ?? {}
  return { color: s.color, isLightMode: s.isLightMode }
})
const openSettings = async (page) => {
  await tool(page, 'selectObject')
  await page.locator('#scene-controls [data-tool="linemapSettings"]').first().click()
  await page.waitForSelector(`${FORM} select[name="labelFont"]`, { timeout: 10000 })
  await page.waitForTimeout(300)
}
const closeSettings = (page) => page.evaluate(async () => {
  for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-scene-properties') await app.close({ animate: false })
})
/** Pick a colour in the open settings window, as the picker does; false when it has no colour field. */
const pickColour = (page, colour) => page.evaluate(({ FORM, colour }) => {
  const el = document.querySelector(`${FORM} color-picker[name="color"]`)
  if (!el) return false
  el.value = colour
  return true
}, { FORM, colour })
const savedAs = (page, colour) => until(page, (c) => canvas.linemap.constructor.readFlag(canvas.scene)?.color === c, colour)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'color')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.2, 0.3))
  await tool(gm, 'drawLine')
  await dragThrough(gm, [await at(gm, 0.4, 0.3), await at(gm, 0.55, 0.3), await at(gm, 0.7, 0.3)])
  await writeLabel(gm, await at(gm, 0.3, 0.6), 'Tealwater')
  await tool(gm, 'drawArea')
  await dragThrough(gm, [await at(gm, 0.55, 0.55), await at(gm, 0.65, 0.65), await at(gm, 0.8, 0.8)])
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 4)

  let r = await rendered(gm, '#000000')
  p.check(allIn(r), 'a new map is drawn in black', r)

  const w0 = p.warnings.length
  await openSettings(gm)
  const field = await gm.evaluate((FORM) => document.querySelector(`${FORM} color-picker[name="color"]`)?.value ?? null, FORM)
  p.check(field === '#000000', 'the settings window has a colour field, black for a new map', field)
  p.check(await pickColour(gm, TEAL), 'a colour can be picked in it')
  let s = (await savedAs(gm, TEAL)) && await saved(gm)
  p.check(s && s.color === TEAL, "the picked colour is saved in the Scene's flag", s || await saved(gm))
  p.check(s && s.isLightMode === true, 'beside it, white is saved as its nearest of black and white, for older builds', s || await saved(gm))
  await closeSettings(gm)
  p.check(moduleWarnings(p.warnings, w0).length === 0, 'the settings window raises no deprecation warning from this module', moduleWarnings(p.warnings, w0))

  r = await rendered(gm, TEAL)
  p.check(allIn(r, ['symbol']), 'the symbol is drawn in the colour', r.symbol)
  p.check(allIn(r, ['line']), 'the line is drawn in the colour', r.line)
  p.check(allIn(r, ['text']), 'the label is drawn in the colour', r.text)
  p.check(allIn(r, ['area']), "the area's outline is drawn in the colour", r.area)

  // A reload brings the canvas back to the active Scene, and the probe's own is only viewed: view it again.
  await reload(gm)
  await viewScene(gm, sceneId)
  r = await rendered(gm, TEAL)
  p.check(allIn(r), 'after a reload the map is still drawn in the colour', r)

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.length === 4, null, { timeout: 20000 })
  r = await rendered(pl, TEAL)
  p.check(allIn(r), 'a player is shown the map in the colour', r)

  // Changed while the player watches: their client redraws from the Scene update.
  await openSettings(gm)
  await pickColour(gm, BLUE)
  await savedAs(gm, BLUE)
  await closeSettings(gm)
  s = await saved(gm)
  p.check(s.color === BLUE && s.isLightMode === false, 'a dark colour saves black as its nearest', s)
  const live = await until(pl, (c) => canvas.linemap.color === c, BLUE, { timeout: 15000 })
  r = await rendered(pl, BLUE)
  p.check(!!live && allIn(r), "a new colour reaches the player's canvas without a reload", r)

  // When the content is the selection colour, selection must still show.
  await openSettings(gm)
  const controlled = await gm.evaluate(() => '#' + CONFIG.Canvas.dispositionColors.CONTROLLED.toString(16).padStart(6, '0'))
  await pickColour(gm, controlled)
  await savedAs(gm, controlled)
  await closeSettings(gm)
  const sel = await gm.evaluate(() => {
    const L = canvas.linemap
    const rgb = (n) => [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => v / 255)
    const [a, b] = [rgb(L._objectColorHex), rgb(L._selectionColorHex)]
    return { content: L._objectColorHex, selection: L._selectionColorHex, distance: Math.hypot(...a.map((v, i) => v - b[i])) }
  })
  p.check(sel.distance > 0.3, 'with the content in the selection colour, selection shows in another colour', sel)

  // A map saved before the setting: black or white only, no colour.
  const oldId = await gm.evaluate(async (name) => {
    const scene = await foundry.documents.Scene.create({
      name, width: 3000, height: 2000, padding: 0, grid: { type: 0 }, navigation: false, ownership: { default: 2 },
      flags: { linemap: {
        map: { isLightMode: true, symbolScale: 1, labelFont: 'Alegreya' },
        objects: { oldSymbol0000001: { id: 'oldSymbol0000001', type: 'symbol', isRevealed: true, sort: 0, point: { point: [1000, 1000], sourceId: null, sourceT: null }, symbol: 'curiosity' } }
      } }
    })
    return scene.id
  }, `${PROBE_TAG} color, old white map`)
  p.cleanup(() => gm.evaluate(async (id) => { await game.scenes.get(id)?.delete() }, oldId))
  await viewScene(gm, oldId)
  const old = await gm.evaluate(() => ({ color: canvas.linemap.color, objects: canvas.linemap.objects.length }))
  r = await rendered(gm, '#ffffff')
  p.check(old.color === '#ffffff' && old.objects === 1 && allIn(r, ['symbol']), 'a map saved as white before the setting is drawn in white', { ...old, symbol: r.symbol })

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
