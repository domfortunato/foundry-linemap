#!/usr/bin/env node
// dev:halo: a contrasting outline behind symbols and labels (ROADMAP step 6, the halo first). With
// images under the map, a dark symbol on a dark picture is lost; the halo sets it apart.
// - The scene settings have a Halo switch and a halo colour. A new map has the halo off; on, its
//   colour is the content's opposite (white for black content) until one is picked.
// - Read back from the pixels the layer rendered, over a picture covering the Scene: with the halo
//   on, the pixels just outside a symbol's art and a label's glyphs are the halo colour; with it off
//   they are the picture.
// - The setting is saved in the Scene's flag (null when off or automatic), survives a reload, and a
//   player is shown it, except around a hidden symbol, which the player is not shown at all.
import { PROBE_TAG, at, clickAt, moduleWarnings, probe, probeScene, reload, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:halo', { watchdogMs: 360000 })
const FORM = '#linemap-scene-properties'
const PLAYER = `${PROBE_TAG} Halo Player`
const BACK = '#c03030' // the picture under the map
const PARCHMENT = '#f2e6c8'

/**
 * Around the symbol and the label, the pixels 1.5 to 2.5 px outside their art: what the map draws
 * there, compared with the halo colour and with the picture. The art is found by drawing once with
 * the halo off (in this client only, not saved): its pixels are those nearer the content colour than
 * the picture's. Then the map is drawn as set and the band is read.
 */
const bands = (page, halo) => page.evaluate(({ halo, BACK }) => {
  const L = canvas.linemap
  L.setSelection()
  const hex = (s) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16))
  const content = hex(L.color)
  const back = hex(BACK)
  const want = hex(halo)
  const d2 = (px, i, c) => (px[i] - c[0]) ** 2 + (px[i + 1] - c[1]) ** 2 + (px[i + 2] - c[2]) ** 2
  const close = (px, i, c) => px[i + 3] >= 240 && [0, 1, 2].every(k => Math.abs(px[i + k] - c[k]) <= 24)
  const regions = {}
  const sym = L.objects.find(o => o.constructor.type === 'symbol')
  const label = L.objects.find(o => o.constructor.type === 'text')
  if (sym) regions.symbol = { x: sym.point.point[0] - 45, y: sym.point.point[1] - 45, w: 90, h: 90 }
  if (label?.sprite) {
    const w = Math.ceil(label.sprite.width / 2) + 14
    const h = Math.ceil(label.sprite.height / 2) + 14
    regions.label = { x: label.sprite.x - w, y: label.sprite.y - h, w: 2 * w, h: 2 * h }
  }
  const read = (r) => canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(Math.round(r.x), Math.round(r.y), r.w, r.h))
  const was = L.halo
  L.halo = false
  L.redraw()
  const art = Object.fromEntries(Object.entries(regions).map(([k, r]) => {
    const px = read(r)
    const mask = new Uint8Array(r.w * r.h)
    for (let i = 0; i < mask.length; i++) mask[i] = px[4 * i + 3] > 128 && d2(px, 4 * i, content) < d2(px, 4 * i, back) ? 1 : 0
    return [k, mask]
  }))
  L.halo = was
  L.redraw()
  const out = {}
  for (const [k, r] of Object.entries(regions)) {
    const px = read(r)
    const mask = art[k]
    let band = 0, haloed = 0, picture = 0
    for (let y = 3; y < r.h - 3; y++) {
      for (let x = 3; x < r.w - 3; x++) {
        if (mask[y * r.w + x]) continue
        let best = 99
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          if (mask[(y + dy) * r.w + x + dx]) best = Math.min(best, Math.hypot(dx, dy))
        }
        if (best < 1.5 || best > 2.5) continue
        band++
        const i = 4 * (y * r.w + x)
        if (close(px, i, want)) haloed++
        if (close(px, i, back)) picture++
      }
    }
    out[k] = { band, halo: band ? haloed / band : 0, picture: band ? picture / band : 0 }
  }
  return out
}, { halo, BACK })
const isHalo = (b) => !!b && b.band > 20 && b.halo >= 0.85
const isPicture = (b) => !!b && b.band > 20 && b.picture >= 0.85

const saved = (page) => page.evaluate(() => {
  const m = canvas.scene.flags?.linemap?.map ?? {}
  return { halo: m.halo, haloColor: m.haloColor }
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
const fields = (page) => page.evaluate((FORM) => ({
  halo: document.querySelector(`${FORM} input[name="halo"]`)?.checked ?? null,
  haloColor: document.querySelector(`${FORM} color-picker[name="haloColor"]`)?.value ?? null
}), FORM)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'halo')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  // A picture covering the Scene, under the map.
  const path = await gm.evaluate(async (BACK) => {
    const c = new OffscreenCanvas(64, 64)
    const ctx = c.getContext('2d')
    ctx.fillStyle = BACK
    ctx.fillRect(0, 0, 64, 64)
    const blob = await c.convertToBlob({ type: 'image/png' })
    const FP = foundry.applications.apps.FilePicker.implementation
    try { await FP.createDirectory('data', 'linemap-probe') } catch {}
    const r = await FP.upload('data', 'linemap-probe', new File([blob], 'halo-back.png', { type: 'image/png' }), {}, { notify: false })
    if (!r?.path) return null
    const L = canvas.linemap
    const image = new CONFIG.linemap.objectTypes.image()
    const s = canvas.dimensions.sceneRect
    image.construct(r.path, [s.x, s.y, s.width, s.height])
    image.isRevealed = true
    L.addObject(image)
    return r.path
  }, BACK)
  await tool(gm, 'drawSymbol')
  await clickAt(gm, await at(gm, 0.3, 0.4))
  await writeLabel(gm, await at(gm, 0.65, 0.4), 'Haloburg')
  const saved3 = await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 3)
  // The picture's texture loads after it is placed, and the map is drawn again then.
  const drawn = saved3 && await until(gm, (BACK) => {
    const L = canvas.linemap
    const s = canvas.dimensions.sceneRect
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + 20, s.y + 20, 1, 1))
    return [1, 3, 5].every((i, k) => Math.abs(d[k] - parseInt(BACK.slice(i, i + 2), 16)) <= 24)
  }, BACK)
  p.check(!!path && !!drawn,'a picture covering the Scene, a symbol and a label are drawn', { path })

  let b = await bands(gm, '#ffffff')
  p.check(isPicture(b.symbol) && isPicture(b.label), 'a new map has no halo: around the symbol and the label is the picture', b)

  const w0 = p.warnings.length
  await openSettings(gm)
  let f = await fields(gm)
  p.check(f.halo === false, 'the settings window has a Halo switch, off for a new map', f)
  p.check(f.haloColor === '#ffffff', 'and a halo colour, white for black content', f)
  await gm.locator(`${FORM} input[name="halo"]`).first().check()
  const on = await until(gm, () => canvas.scene.flags?.linemap?.map?.halo === true)
  let s = await saved(gm)
  p.check(!!on && s.haloColor === null, "the halo is saved as on in the Scene's flag, its colour as automatic (null)", s)

  b = await bands(gm, '#ffffff')
  p.check(isHalo(b.symbol), "with the halo on, the pixels just outside the symbol's art are the halo colour", b.symbol)
  p.check(isHalo(b.label), "and just outside the label's glyphs", b.label)

  await gm.evaluate(({ FORM, PARCHMENT }) => { document.querySelector(`${FORM} color-picker[name="haloColor"]`).value = PARCHMENT }, { FORM, PARCHMENT })
  const picked = await until(gm, (c) => canvas.scene.flags?.linemap?.map?.haloColor === c, PARCHMENT)
  await closeSettings(gm)
  p.check(!!picked, 'a picked halo colour is saved', await saved(gm))
  b = await bands(gm, PARCHMENT)
  p.check(isHalo(b.symbol) && isHalo(b.label), 'and the halo is drawn in it', b)
  p.check(moduleWarnings(p.warnings, w0).length === 0, 'the settings window raises no deprecation warning from this module', moduleWarnings(p.warnings, w0))

  await reload(gm)
  await viewScene(gm, sceneId)
  await until(gm, () => canvas.linemap.objects.length === 3)
  b = await bands(gm, PARCHMENT)
  p.check(isHalo(b.symbol) && isHalo(b.label), 'the halo is the same after a reload', b)

  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.length === 3, null, { timeout: 20000 })
  b = await bands(pl, PARCHMENT)
  p.check(isHalo(b.symbol) && isHalo(b.label), 'a player is shown the halo', b)

  // Hidden: the Gamemaster still sees the symbol; the player sees neither it nor its halo.
  await gm.evaluate(async () => {
    const L = canvas.linemap
    const sym = L.objects.find(o => o.constructor.type === 'symbol')
    sym.isRevealed = false
    L.redraw()
    await L.registerHistory()
  })
  const gone = await until(pl, () => canvas.linemap.objects.find(o => o.constructor.type === 'symbol')?.isRevealed === false, null, { timeout: 15000 })
  const bare = await pl.evaluate((BACK) => {
    const L = canvas.linemap
    L.redraw()
    const sym = L.objects.find(o => o.constructor.type === 'symbol')
    const [x, y] = sym.point.point
    const px = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(Math.round(x) - 40, Math.round(y) - 40, 80, 80))
    const back = [1, 3, 5].map(i => parseInt(BACK.slice(i, i + 2), 16))
    let other = 0
    for (let i = 0; i < px.length; i += 4) if (![0, 1, 2].every(k => Math.abs(px[i + k] - back[k]) <= 24)) other++
    return { other }
  }, BACK)
  p.check(!!gone && bare.other === 0, "a hidden symbol's halo is not drawn for the player", bare)

  await openSettings(gm)
  await gm.locator(`${FORM} input[name="halo"]`).first().uncheck()
  const off = await until(gm, () => canvas.scene.flags?.linemap?.map?.halo === null)
  await closeSettings(gm)
  s = await saved(gm)
  p.check(!!off, "turned off, the halo is saved as null in the Scene's flag", s)
  await gm.evaluate(async () => {
    const L = canvas.linemap
    L.objects.find(o => o.constructor.type === 'symbol').isRevealed = true
    L.redraw()
    await L.registerHistory()
  })
  b = await bands(gm, PARCHMENT)
  p.check(isPicture(b.symbol) && isPicture(b.label), 'with the halo off, the picture shows around them again', b)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
