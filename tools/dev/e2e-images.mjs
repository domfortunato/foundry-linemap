#!/usr/bin/env node
// dev:images: pictures drawn inside the map, under its lines and symbols (ROADMAP step 5).
// - The image tool (hotkey G) opens Foundry's file picker; the picked image is placed at the click,
//   at its own size, untinted, and saved as an `image` object.
// - The adjust tool resizes an image by its corners (shift keeps its proportions); the select tool
//   moves it, and undo takes a move back.
// - The right-click menu fits an image to the Scene, and brings it forward or sends it back.
// - An image lies under the map's lines. A hidden image is not drawn for a player; a revealed one is.
// - Images survive a reload. A file that is missing is not placed, and one gone missing later leaves
//   the rest of the map drawn, with an outline where the image was for the Gamemaster.
// - Images follow a Scene resize.
import { PROBE_TAG, at, clickAt, dragThrough, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const PLAYER = `${PROBE_TAG} Player`
const p = probe('dev:images', { watchdogMs: 360000 })

/** The RGBA the layer rendered at a canvas point. */
const colourAt = (page, pt) => page.evaluate((pt) => {
  const L = canvas.linemap
  if (!L.renderTexture) return null
  const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(Math.round(pt.x), Math.round(pt.y), 1, 1))
  return [d[0], d[1], d[2], d[3]]
}, pt)
const isRed = (c) => !!c && c[3] > 200 && c[0] > 200 && c[1] < 60 && c[2] < 60
const isBlue = (c) => !!c && c[3] > 200 && c[2] > 200 && c[0] < 60 && c[1] < 60
const images = (page) => page.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type === 'image').map(o => ({ ...o.serialized, drawn: !!o.sprite?.parent })))
const savedImages = (page) => page.evaluate(() => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).filter(o => o.type === 'image'))
const near = (a, b, tol = 2) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)

/** A plain-coloured PNG, uploaded to the box's data folder (the box is reset after every run). */
const upload = (page, name, colour, w, h) => page.evaluate(async ({ name, colour, w, h }) => {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, w, h)
  const blob = await c.convertToBlob({ type: 'image/png' })
  const FP = foundry.applications.apps.FilePicker.implementation
  try { await FP.createDirectory('data', 'linemap-probe') } catch {}
  const r = await FP.upload('data', 'linemap-probe', new File([blob], name, { type: 'image/png' }), {}, { notify: false })
  return r?.path
}, { name, colour, w, h })

/** Click with the image tool, and pick a path in the file picker it opens. */
async function placeImage (page, pt, path) {
  await tool(page, 'drawImage')
  await clickAt(page, pt)
  const input = page.locator('[id^="file-picker"] input[name="file"]').first()
  await input.waitFor({ timeout: scaled(10000) })
  await input.fill(path)
  await input.press('Enter')
  await page.waitForTimeout(scaled(1000))
}

const menuButton = (page, option) => page.locator(`.linemap-menu [data-option="${option}"]`).first()
/** Select one object, right-click at a point and pick a menu option; whether the option was there. */
async function menu (page, id, pt, option) {
  await tool(page, 'selectObject')
  await page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, id)
  await clickAt(page, pt, { button: 'right' })
  const b = menuButton(page, option)
  if (!await b.count()) return false
  await b.click()
  await page.waitForTimeout(scaled(600))
  return true
}

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'images')
  const red = await upload(page, 'red.png', '#ff0000', 240, 120)
  const blue = await upload(page, 'blue.png', '#0000ff', 120, 120)
  p.check(red && blue, 'two test images are uploaded', { red, blue })

  await tool(page, 'selectObject')
  await page.keyboard.press('g')
  await page.waitForTimeout(scaled(400))
  const hasTool = await page.evaluate(() => !!ui.controls.controls?.linemap?.tools?.drawImage && game.activeTool === 'drawImage')
  p.check(hasTool, 'G picks the image tool')
  if (!hasTool) throw new Error('there is no image tool')

  // Placed at the click, at its own size.
  const P1 = await at(page, 0.3, 0.3)
  const P2 = await at(page, 0.7, 0.3)
  await placeImage(page, P1, red)
  await placeImage(page, P2, blue)
  let [r, b] = await images(page)
  p.check(r?.src === red && near(r.rect, [P1.x - 120, P1.y - 60, 240, 120]) && b?.src === blue && near(b.rect, [P2.x - 60, P2.y - 60, 120, 120]),
    'the picked images are placed centred on the click, at their own size', { r: r?.rect, b: b?.rect })
  p.check((await savedImages(page)).length === 2, 'and saved as image objects', await savedImages(page))
  await until(page, () => canvas.linemap.objects.filter(o => o.constructor.type === 'image').every(o => o.sprite?.parent), null)
  const cR = await colourAt(page, P1)
  const cB = await colourAt(page, P2)
  const cOut = await colourAt(page, { x: P1.x + 140, y: P1.y })
  p.check(isRed(cR) && isBlue(cB) && cOut?.[3] === 0, 'their pixels are drawn where they lie, untinted', { cR, cB, cOut })

  // Resize by a corner; with shift, in proportion.
  await tool(page, 'adjustObject')
  await dragThrough(page, [{ x: P1.x + 120, y: P1.y + 60 }, { x: P1.x + 240, y: P1.y + 120 }])
  ;[r, b] = await images(page)
  p.check(near(r?.rect, [P1.x - 120, P1.y - 60, 360, 180]), "the adjust tool resizes an image by its corner, the opposite corner staying put", r?.rect)
  p.check(isRed(await colourAt(page, { x: P1.x + 220, y: P1.y + 100 })), 'and the image is drawn at its new size', await colourAt(page, { x: P1.x + 220, y: P1.y + 100 }))
  await page.keyboard.down('Shift')
  await dragThrough(page, [{ x: P2.x + 60, y: P2.y + 60 }, { x: P2.x + 160, y: P2.y + 80 }])
  await page.keyboard.up('Shift')
  ;[r, b] = await images(page)
  p.check(b && Math.abs(b.rect[2] - b.rect[3]) <= 1 && b.rect[2] > 200 && near(b.rect.slice(0, 2), [P2.x - 60, P2.y - 60]), 'with shift held, it keeps its proportions', b?.rect)

  // Move with the select tool; undo the move.
  const before = b.rect
  const bc = { x: b.rect[0] + b.rect[2] / 2, y: b.rect[1] + b.rect[3] / 2 }
  await tool(page, 'selectObject')
  await clickAt(page, bc)
  await dragThrough(page, [bc, { x: bc.x + 100, y: bc.y }])
  ;[r, b] = await images(page)
  p.check(near(b?.rect, [before[0] + 100, before[1], before[2], before[3]]), 'the select tool moves an image', { before, after: b?.rect })
  await page.evaluate(() => canvas.linemap.undo())
  await page.waitForTimeout(scaled(800))
  ;[r, b] = await images(page)
  const savedB = (await savedImages(page)).find(o => o.id === b?.id)
  p.check(near(b?.rect, before) && near(savedB?.rect, before), 'undo takes the move back', { now: b?.rect, saved: savedB?.rect, before })

  // A line across the red image is drawn over it.
  await tool(page, 'drawLine')
  await dragThrough(page, [{ x: P1.x - 200, y: P1.y }, { x: P1.x + 300, y: P1.y }])
  const onLine = await colourAt(page, P1)
  const offLine = await colourAt(page, { x: P1.x, y: P1.y + 30 })
  p.check(onLine?.[3] > 200 && !isRed(onLine) && isRed(offLine), "the map's lines are drawn over an image", { onLine, offLine })

  // Fit to the Scene; then order.
  const fitted = await menu(page, r.id, { x: P1.x - 60, y: P1.y + 60 }, 'fitToScene')
  p.check(fitted, 'the right-click menu on an image has Fit to scene')
  ;[r, b] = await images(page)
  const scene = await page.evaluate(() => { const s = canvas.dimensions.sceneRect; return [s.x, s.y, s.width, s.height] })
  p.check(near(r?.rect, scene) && isRed(await colourAt(page, { x: scene[0] + 20, y: scene[1] + 20 })), 'Fit to scene makes the image cover the Scene', { rect: r?.rect, scene })
  const bCentre = { x: before[0] + before[2] / 2, y: before[1] + before[3] / 2 }
  p.check(isBlue(await colourAt(page, bCentre)), 'the image placed later is drawn above the earlier', await colourAt(page, bCentre))
  // A click picks the topmost image under it.
  await page.evaluate(() => canvas.linemap.setSelection())
  await clickAt(page, bCentre)
  p.check(await page.evaluate((id) => canvas.linemap.selection.map(o => o.id).join() === id, b.id), 'a click on two images selects the top one')
  const sent = await menu(page, b.id, bCentre, 'sendBack')
  p.check(sent && isRed(await colourAt(page, bCentre)), 'Send back puts it under the other image', await colourAt(page, bCentre))
  const brought = await menu(page, b.id, bCentre, 'bringForward')
  p.check(brought && isBlue(await colourAt(page, bCentre)), 'Bring forward puts it back above', await colourAt(page, bCentre))
  p.check(!isRed(await colourAt(page, P1)) && (await colourAt(page, P1))?.[3] > 200, 'the line is still drawn over the image covering the Scene', await colourAt(page, P1))

  // Hidden from a player.
  await page.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => page.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))
  await tool(page, 'selectObject')
  await page.evaluate((id) => { const L = canvas.linemap; L.setSelection(L.objects.find(o => o.id === id)) }, b.id)
  await page.keyboard.press('h')
  await page.waitForTimeout(scaled(800))
  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.filter(o => o.constructor.type === 'image').length === 2, null, { timeout: 20000 })
  await until(pl, () => canvas.linemap.objects.some(o => o.constructor.type === 'image' && o.sprite?.parent), null, { timeout: 20000 })
  await pl.waitForTimeout(scaled(800))
  const plB = await colourAt(pl, bCentre)
  const plR = await colourAt(pl, { x: scene[0] + 20, y: scene[1] + 20 })
  p.check(isRed(plR) && isRed(plB), 'a player sees the revealed image and not the hidden one', { plR, plB })

  // Reload.
  await reload(page)
  await viewScene(page, sceneId)
  await until(page, () => canvas.linemap.objects.filter(o => o.constructor.type === 'image').every(o => o.sprite?.parent), null, { timeout: 20000 })
  await page.waitForTimeout(scaled(800))
  const reloaded = await images(page)
  p.check(reloaded.length === 2 && near(reloaded[0].rect, scene) && near(reloaded[1].rect, before) && reloaded[1].isRevealed === false,
    'the images are the same after a reload', reloaded.map(o => ({ rect: o.rect, isRevealed: o.isRevealed })))
  p.check(isRed(await colourAt(page, { x: scene[0] + 20, y: scene[1] + 20 })), 'and drawn', await colourAt(page, { x: scene[0] + 20, y: scene[1] + 20 }))

  // Missing files. Foundry logs a file it cannot load, as it does for a tile: those errors are expected.
  const errorsBefore = p.errors.length
  const count = (await images(page)).length
  await placeImage(page, await at(page, 0.8, 0.8), 'linemap-probe/missing.png')
  p.check((await images(page)).length === count, 'a picked file that cannot be loaded is not placed', (await images(page)).length)
  await page.evaluate((id) => {
    const L = canvas.linemap
    const o = L.objects.find(o => o.id === id)
    o.src = 'linemap-probe/gone.png'
    L.registerHistory()
  }, b.id)
  await page.waitForTimeout(scaled(600))
  await reload(page)
  await viewScene(page, sceneId)
  await page.waitForTimeout(scaled(2000))
  const gone = await page.evaluate((id) => {
    const L = canvas.linemap
    const o = L.objects.find(o => o.id === id)
    return { kept: !!o, outline: !!o?.sprite?.parent, lines: L.objects.filter(o => o.constructor.type === 'line').length }
  }, b.id)
  p.check(gone.kept && gone.outline && gone.lines === 1 && isRed(await colourAt(page, { x: scene[0] + 20, y: scene[1] + 20 })),
    'an image whose file has gone leaves the rest of the map drawn, and an outline where it was', gone)

  // A Scene resize moves and stretches images with everything else.
  await page.evaluate(async () => { await canvas.scene.update({ width: 3600 }, { autoReposition: true }) })
  await until(page, () => canvas.ready && canvas.dimensions.sceneRect.width === 3600, null, { timeout: 30000 })
  await page.waitForTimeout(scaled(1000))
  const resized = (await images(page))[0]
  const scene2 = await page.evaluate(() => { const s = canvas.dimensions.sceneRect; return [s.x, s.y, s.width, s.height] })
  p.check(near(resized?.rect, scene2), 'an image fitted to the Scene still fits it after the Scene is resized', { rect: resized?.rect, scene: scene2 })

  // From here on the missing file is asked for at every canvas draw (the resize redrew it), as a tile's is.
  const added = p.errors.splice(errorsBefore)
  const unexpected = added.filter(e => !/missing\.png|gone\.png|Failed to load resource/i.test(e))
  p.check(unexpected.length === 0, 'and nothing but the missing files is logged', { added })
  if (unexpected.length) p.errors.push(...unexpected)
} catch (err) {
  await p.threw(err)
}
await p.finish()
