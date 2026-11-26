#!/usr/bin/env node
// dev:look: change an existing object's look (ROADMAP 7.5). The select tool's right-click menu offers a
// row of looks for a selection of one kind: a line's style, a symbol's kind, a waypoint's kind, an
// area's pattern. Picking one changes it in place, instead of deleting and redrawing it.
// - A line changes from major to rough and keeps its id, its points and its links: the symbols at its
//   ends, the waypoint and the label on it stay where they were, still linked.
// - A symbol's kind, a waypoint's kind and an area's pattern change the same way.
// - Two lines selected change together, as one edit that one undo takes back.
// - A mixed selection (a symbol and a line) offers no looks. The change survives a reload.
import { clickAt, moduleWarnings, probe, probeScene, reload, scaled, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:look', { watchdogMs: 300000 })

const A = { x: 600, y: 800 }
const B = { x: 1800, y: 800 }
const LINE_AT = { x: 900, y: 800 } // a quarter of the way along A-B, clear of the waypoint
const WAYPOINT = { x: 1200, y: 800 }
const AREA_AT = { x: 600, y: 1500 }
const SECOND_LINE_AT = { x: 1200, y: 1200 }

const saved = (page) => page.evaluate(() => canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? [])
const byId = async (page, id) => (await saved(page)).find(o => o.id === id)

const shiftClick = async (page, point) => {
  await page.keyboard.down('Shift')
  try { await clickAt(page, point) } finally { await page.keyboard.up('Shift') }
}
/** Right-click a selection: the look options the menu offers, [key, active] each. */
const looksOn = async (page, point) => {
  await clickAt(page, point, { button: 'right' })
  await page.locator('.linemap-menu').first().waitFor({ timeout: scaled(5000) }).catch(() => {})
  await page.waitForTimeout(scaled(300))
  return page.evaluate(() => [...document.querySelectorAll('.linemap-menu [data-look]')].map(a => [a.dataset.look, a.classList.contains('active')]))
}
const pick = async (page, key) => {
  const option = page.locator(`.linemap-menu [data-look="${key}"]`).first()
  if (!(await option.count())) return false
  await option.click()
  await page.waitForTimeout(scaled(500))
  return true
}
const closeMenu = (page) => page.evaluate(() => canvas.linemap.tools.selectObject?.closeMenu())

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'look')
  // The pause banner covers the middle of the screenshots.
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })

  const ids = await gm.evaluate(async ({ A, B, AREA_AT }) => {
    const api = game.modules.get('linemap').api
    const [a, b] = await api.add([api.symbol({ x: A.x, y: A.y, symbol: 'minor-site' }), api.symbol({ x: B.x, y: B.y, symbol: 'minor-site' })])
    const [road, other] = await api.add([
      api.line({ from: a, to: b, style: 'major' }),
      api.line({ from: [900, 1200], to: [1500, 1200], style: 'major' })
    ])
    const [wp, label, area] = await api.add([
      api.waypoint({ line: road, t: 0.5, symbol: 'waypoint' }),
      api.label({ text: 'King’s Road', on: road, t: 0.75 }),
      api.area({ points: [[AREA_AT.x - 150, AREA_AT.y - 150], [AREA_AT.x + 150, AREA_AT.y - 150], [AREA_AT.x + 150, AREA_AT.y + 150], [AREA_AT.x - 150, AREA_AT.y + 150]], pattern: 'diagonal1' })
    ])
    return { a, b, road, other, wp, label, area }
  }, { A, B, AREA_AT })
  const before = await saved(gm)

  // The line: major to rough.
  await tool(gm, 'selectObject')
  await clickAt(gm, LINE_AT)
  let looks = await looksOn(gm, LINE_AT)
  await p.shot(gm, 'line-menu')
  const keys = looks.map(l => l[0])
  p.check(keys.includes('rough') && looks.some(([k, active]) => k === 'major' && active),
    "the menu of a selected line offers the line styles, the line's own marked", looks)
  const picked = await pick(gm, 'rough')
  const road = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.style === 'rough', ids.road)
  p.check(picked && !!road, 'picking rough makes the line rough', await byId(gm, ids.road))
  const r0 = before.find(o => o.id === ids.road)
  const r1 = await byId(gm, ids.road)
  p.check(!!r1 && r1.points.length === r0.points.length && r1.points[0].sourceId === ids.a && r1.points.at(-1).sourceId === ids.b &&
    JSON.stringify(r1.points.map(pt => pt.point)) === JSON.stringify(r0.points.map(pt => pt.point)),
    'the line keeps its id, its points and its links to the symbols at its ends', { before: r0, after: r1 })
  const linked = await gm.evaluate((ids) => {
    const L = canvas.linemap
    const road = L.objects.find(o => o.id === ids.road)
    const wp = L.objects.find(o => o.id === ids.wp)
    const label = L.objects.find(o => o.id === ids.label)
    return { wp: wp?.point?.sourceObject === road, label: label?.point?.sourceObject === road, drawn: road?.style, cls: road?.constructor?.name }
  }, ids)
  p.check(linked.wp && linked.label && (await byId(gm, ids.wp)).point.sourceId === ids.road && (await byId(gm, ids.label)).point.sourceId === ids.road,
    'the waypoint and the label on it are still linked to it', linked)

  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  const undone = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.style === 'major', ids.road)
  p.check(!!undone, 'undo makes it major again', await byId(gm, ids.road))

  // A symbol's kind.
  await clickAt(gm, A)
  looks = await looksOn(gm, A)
  await p.shot(gm, 'symbol-menu')
  const other = looks.find(([k, active]) => !active && k !== 'minor-site')?.[0]
  p.check(looks.some(([k, active]) => k === 'minor-site' && active) && !!other, "the menu of a symbol offers the symbols, its own marked", looks)
  await pick(gm, other)
  const sym = await until(gm, ({ a, other }) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === a)?.symbol === other, { a: ids.a, other })
  p.check(!!sym && (await byId(gm, ids.road)).points[0].sourceId === ids.a, `the symbol becomes ${other}, and the line stays linked to it`, await byId(gm, ids.a))

  // A waypoint's kind.
  await clickAt(gm, WAYPOINT)
  looks = await looksOn(gm, WAYPOINT)
  p.check(looks.some(([k, active]) => k === 'waypoint' && active) && looks.some(([k]) => k === 'pass'), 'the menu of a waypoint offers the waypoints', looks)
  await pick(gm, 'pass')
  const wp = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.symbol === 'pass', ids.wp)
  p.check(!!wp && (await byId(gm, ids.wp)).point.sourceId === ids.road, 'the waypoint becomes a pass, still on its line', await byId(gm, ids.wp))

  // An area's pattern.
  await clickAt(gm, AREA_AT)
  looks = await looksOn(gm, AREA_AT)
  p.check(looks.some(([k, active]) => k === 'diagonal1' && active) && looks.some(([k]) => k === 'dots'), 'the menu of an area offers the patterns', looks)
  await pick(gm, 'dots')
  const area = await until(gm, (id) => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.id === id)?.pattern === 'dots', ids.area)
  p.check(!!area, 'the area takes the dots pattern', await byId(gm, ids.area))

  // A mixed selection offers none.
  await clickAt(gm, B)
  await shiftClick(gm, LINE_AT)
  looks = await looksOn(gm, B)
  p.check(looks.length === 0, 'a symbol and a line selected together are offered no looks', looks)
  await closeMenu(gm)

  // Two lines at once, one edit.
  await clickAt(gm, LINE_AT)
  await shiftClick(gm, SECOND_LINE_AT)
  const selected = await gm.evaluate(() => canvas.linemap.selection.map(o => o.id))
  looks = await looksOn(gm, SECOND_LINE_AT)
  await pick(gm, 'dotted')
  const both = await until(gm, ({ road, other }) => {
    const o = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    return [road, other].every(id => o.find(x => x.id === id)?.style === 'dotted')
  }, ids)
  p.check(!!both, 'two lines selected both become dotted', { selected, looks })
  await gm.evaluate(async () => { await game.modules.get('linemap').api.undo() })
  const bothBack = await until(gm, ({ road, other }) => {
    const o = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    return [road, other].every(id => o.find(x => x.id === id)?.style === 'major')
  }, ids)
  p.check(!!bothBack, 'one undo takes both back', [await byId(gm, ids.road), await byId(gm, ids.other)])

  await reload(gm)
  await viewScene(gm, sceneId)
  const after = await gm.evaluate((ids) => {
    const L = canvas.linemap
    const get = (id) => L.objects.find(o => o.id === id)
    return { wp: get(ids.wp)?.symbol, area: get(ids.area)?.pattern, a: get(ids.a)?.symbol, count: L.objects.length }
  }, ids)
  p.check(after.wp === 'pass' && after.area === 'dots' && after.a === other && after.count === before.length, 'the changes are the same after a reload', after)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
