#!/usr/bin/env node
// dev:links: document links (ROADMAP 7.2), working like core's map notes.
// - A Gamemaster links a symbol to a journal page from the right-click menu (pasting its UUID), and a
//   label by dropping a journal entry from the sidebar onto it; core makes no map note of the drop.
//   The link is saved on the object, survives a reload, and the menu unlinks it.
// - On any layer (a player has no Line Map control), hovering a linked object shows a pointer and the
//   document's name, and a double-click opens it; a single click does not.
// - Nothing shows for a hidden object, for a document the player may not see, or while the player
//   has map notes toggled off.
// - Hover tooltips (7.3): hovering a symbol or line with labels shows their text, so a crowded map can
//   be read; a hidden label's text is not shown.
import { PROBE_TAG, clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:links', { watchdogMs: 400000 })
const PLAYER = `${PROBE_TAG} Links Player`
const SYMBOL = { x: 1000, y: 800 }
const LABEL = { x: 1700, y: 800 }

/** The screen point of a canvas point, after panning there at scale 1. */
const screenOf = async (page, pt) => {
  await page.evaluate((pt) => canvas.pan({ x: pt.x, y: pt.y, scale: 1 }), pt)
  await page.waitForTimeout(scaled(300))
  return page.evaluate((pt) => canvas.clientCoordinatesFromCanvas(pt), pt)
}
/** Hover a canvas point: whether the pointer cue shows, and the tooltip's text if it is up. */
const hover = async (page, pt) => {
  const s = await screenOf(page, pt)
  await page.mouse.move(s.x - 40, s.y - 40)
  await page.mouse.move(s.x, s.y, { steps: 4 })
  await page.waitForTimeout(scaled(500))
  return page.evaluate(() => {
    const t = document.getElementById('tooltip')
    return {
      cursor: getComputedStyle(canvas.app.view).cursor,
      tooltip: t?.classList.contains('active') ? t.textContent.trim() : null
    }
  })
}
const openSheets = (page) => page.evaluate(() => [...foundry.applications.instances.values()]
  .filter(a => a.rendered && a.document?.documentName === 'JournalEntry').map(a => a.document.name))
const closeSheets = (page) => page.evaluate(async () => {
  for (const a of [...foundry.applications.instances.values()]) if (a.rendered && a.document) await a.close({ animate: false })
})
const savedLink = (page, type) => page.evaluate((type) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === type)?.link ?? null, type)

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const docs = await gm.evaluate(async (tag) => {
    for (const j of game.journal.filter(j => j.name.startsWith(tag))) await j.delete()
    const open = await foundry.documents.JournalEntry.create({ name: `${tag} Gazetteer`, ownership: { default: 2 } })
    const [page] = await open.createEmbeddedDocuments('JournalEntryPage', [{ name: 'Greyhaven', type: 'text', text: { content: '<p>A town.</p>' } }])
    const secret = await foundry.documents.JournalEntry.create({ name: `${tag} Secrets`, ownership: { default: 0 } })
    return { open: open.uuid, page: page.uuid, secret: secret.uuid, openId: open.id, secretId: secret.id }
  }, PROBE_TAG)
  p.cleanup(() => gm.evaluate(async (ids) => { for (const id of ids) await game.journal.get(id)?.delete() }, [docs.openId, docs.secretId]))
  const sceneId = await probeScene(p, gm, 'links')
  await gm.evaluate(async (name) => { await foundry.documents.User.create({ name, role: 1 }) }, PLAYER)
  p.cleanup(() => gm.evaluate(async (name) => { await game.users.getName(name)?.delete() }, PLAYER))

  await tool(gm, 'drawSymbol')
  await clickAt(gm, SYMBOL)
  await writeLabel(gm, LABEL, 'Old Archive')
  await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 2)

  // Link the symbol from the menu.
  await tool(gm, 'selectObject')
  await clickAt(gm, SYMBOL)
  await clickAt(gm, SYMBOL, { button: 'right' })
  const linkButton = gm.locator('.linemap-menu [data-option="linkDocument"]').first()
  const hasLink = await linkButton.count()
  p.check(hasLink > 0, 'the right-click menu of a symbol offers Link document')
  if (!hasLink) throw new Error('there is no Link document option')
  await linkButton.click()
  const input = gm.locator('.application.dialog input[name="uuid"]').first()
  await input.waitFor({ timeout: scaled(10000) })
  await input.fill(docs.page)
  await gm.locator('.application.dialog button[data-action="ok"]').first().click()
  const linked = await until(gm, (uuid) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'symbol')?.link === uuid, docs.page)
  p.check(!!linked, "a pasted page UUID is saved as the symbol's link", await savedLink(gm, 'symbol'))

  // Link the label by dropping a journal entry onto it.
  const notesBefore = await gm.evaluate(() => canvas.scene.notes.size)
  const ls = await screenOf(gm, LABEL)
  await gm.evaluate(({ uuid, ls }) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', JSON.stringify({ type: 'JournalEntry', uuid }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      canvas.app.view.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: ls.x, clientY: ls.y, bubbles: true, cancelable: true }))
    }
  }, { uuid: docs.secret, ls })
  const dropped = await until(gm, (uuid) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'text')?.link === uuid, docs.secret)
  await gm.waitForTimeout(scaled(500))
  const notesAfter = await gm.evaluate(() => canvas.scene.notes.size)
  p.check(!!dropped && notesAfter === notesBefore, 'a journal entry dropped on the label links it, and makes no map note', { link: await savedLink(gm, 'text'), notesBefore, notesAfter })

  await reload(gm)
  await viewScene(gm, sceneId)
  p.check(await savedLink(gm, 'symbol') === docs.page && await gm.evaluate((uuid) => canvas.linemap.objects.find(o => o.constructor.type === 'symbol')?.link === uuid, docs.page),
    'the links are the same after a reload')

  // A player, on the token layer.
  const pl = await p.pageAs(PLAYER)
  await viewScene(pl, sceneId)
  await until(pl, () => canvas.linemap?.objects?.length === 2, null, { timeout: 20000 })
  const layer = await pl.evaluate(() => ({ active: canvas.activeLayer?.options?.name, linemap: !!ui.controls.controls?.linemap }))
  let h = await hover(pl, SYMBOL)
  p.check(h.cursor === 'pointer' && h.tooltip === 'Greyhaven', "hovering the linked symbol shows the player a pointer and the page's name", { h, layer })
  let s = await screenOf(pl, SYMBOL)
  await pl.mouse.click(s.x, s.y)
  await pl.waitForTimeout(scaled(800))
  p.check((await openSheets(pl)).length === 0, 'a single click opens nothing', await openSheets(pl))
  await pl.mouse.dblclick(s.x, s.y)
  const opened = await until(pl, (name) => [...foundry.applications.instances.values()].some(a => a.rendered && a.document?.name === name), `${PROBE_TAG} Gazetteer`)
  const onPage = await pl.evaluate(() => {
    const a = [...foundry.applications.instances.values()].find(a => a.rendered && a.document?.documentName === 'JournalEntry')
    return a?.element?.textContent?.includes('A town.') ?? false
  })
  p.check(!!opened && onPage, 'a double-click opens the journal at the linked page', { sheets: await openSheets(pl), onPage })
  await closeSheets(pl)

  h = await hover(pl, LABEL)
  s = await screenOf(pl, LABEL)
  await pl.mouse.dblclick(s.x, s.y)
  await pl.waitForTimeout(scaled(800))
  p.check(h.cursor !== 'pointer' && h.tooltip === null && (await openSheets(pl)).length === 0, 'a label linked to a document the player may not see shows nothing and opens nothing', { h, sheets: await openSheets(pl) })

  // Hover tooltips (ROADMAP 7.3): a labelled symbol or line shows its labels' text, with no pointer.
  const more = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [b] = await api.add(api.symbol({ x: 1000, y: 1300, symbol: 'minor-site' }))
    const [road] = await api.add(api.line({ from: [1300, 1300], to: [1900, 1300] }))
    const [mire, oldRoad] = await api.add([api.label({ text: 'Mirefen', on: b }), api.label({ text: 'Old Road', on: road, t: 0.5 })])
    return { b, road, mire, oldRoad }
  })
  await until(pl, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, more.oldRoad, { timeout: 15000 })
  h = await hover(pl, { x: 1000, y: 1300 })
  p.check(h.tooltip === 'Mirefen' && h.cursor !== 'pointer', "hovering a labelled symbol shows the player its label's text, with no pointer", h)
  h = await hover(pl, { x: 1420, y: 1300 })
  p.check(h.tooltip === 'Old Road', "hovering a line shows its label's text", h)
  await gm.evaluate(async (id) => { await game.modules.get('linemap').api.hide(id) }, more.mire)
  await until(pl, (id) => canvas.linemap.objects.find(o => o.id === id)?.isRevealed === false, more.mire)
  h = await hover(pl, { x: 1000, y: 1300 })
  p.check(h.tooltip === null, "a hidden label's text is not shown", h)

  // Map notes toggled off: no cue.
  await pl.evaluate(async () => { await game.settings.set('core', 'notesDisplayToggle', false) })
  h = await hover(pl, SYMBOL)
  p.check(h.cursor !== 'pointer' && h.tooltip === null, 'with map notes toggled off, the linked symbol shows nothing', h)
  await pl.evaluate(async () => { await game.settings.set('core', 'notesDisplayToggle', true) })
  h = await hover(pl, SYMBOL)
  p.check(h.tooltip === 'Greyhaven', 'toggled back on, it shows again', h)

  // Hidden: nothing for the player.
  await gm.evaluate(async () => {
    const L = canvas.linemap
    L.objects.find(o => o.constructor.type === 'symbol').isRevealed = false
    L.redraw()
    await L.registerHistory()
  })
  await until(pl, () => canvas.linemap.objects.find(o => o.constructor.type === 'symbol')?.isRevealed === false)
  await pl.mouse.move(5, 5)
  h = await hover(pl, SYMBOL)
  s = await screenOf(pl, SYMBOL)
  await pl.mouse.dblclick(s.x, s.y)
  await pl.waitForTimeout(scaled(800))
  p.check(h.cursor !== 'pointer' && h.tooltip === null && (await openSheets(pl)).length === 0, 'a hidden linked symbol shows the player nothing and opens nothing', { h, sheets: await openSheets(pl) })

  // Unlink from the menu.
  await tool(gm, 'selectObject')
  await clickAt(gm, SYMBOL)
  await clickAt(gm, SYMBOL, { button: 'right' })
  const unlink = gm.locator('.linemap-menu [data-option="unlinkDocument"]').first()
  const hasUnlink = await unlink.count()
  if (hasUnlink) await unlink.click()
  const unlinked = hasUnlink && await until(gm, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'symbol')?.link === null)
  p.check(!!unlinked, 'the menu of a linked symbol offers Unlink, which removes the link', await savedLink(gm, 'symbol'))

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
