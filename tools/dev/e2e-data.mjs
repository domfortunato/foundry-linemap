#!/usr/bin/env node
// dev:data: the map's data against the Scene it lives on.
// - Resizing the Scene the way its config window does (core moves every placeable with it) moves
//   the map with it, so the map keeps its place on the background.
// - On a Scene with levels, the map is drawn above the background of the level being viewed, on a
//   raised level as on the ground one.
// - A big map (hundreds of objects) redraws fast enough to drag on: one low-quality redraw, the
//   kind every mouse move of a drag makes, within a frame.
// - A saved map holding an object type, a symbol or a line style that this build does not know
//   still loads and draws the rest, raises no error, and keeps the unknown entry when it is saved.
//   It is written in the old format (one array), so its first edit also moves it to the new one.
import { at, clickAt, dragThrough, probe, probeScene, reload, sweep, tool, until, viewScene } from './lib.mjs'

const p = probe('dev:data', { watchdogMs: 300000 })
/** Every point of the map, as fractions of the Scene's rectangle. */
const fractions = (page) => page.evaluate(() => {
  const r = canvas.dimensions.sceneRect
  const f = ([x, y]) => [(x - r.x) / r.width, (y - r.y) / r.height]
  return canvas.linemap.objects.flatMap(o => {
    if (o.points && Array.isArray(o.points[0])) return o.points.map(f)
    if (o.points) return o.points.map(pt => f(pt.point))
    return o.point ? [f(o.point.point)] : []
  })
})

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'data')

  // Resize.
  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.5, 0.5))
  await tool(page, 'drawArea')
  await dragThrough(page, [await at(page, 0.2, 0.2), await at(page, 0.3, 0.3), await at(page, 0.4, 0.35)])
  await until(page, () => (canvas.linemap.constructor.readFlag(canvas.scene)?.objects?.length ?? 0) === 2)
  const before = await fractions(page)
  await page.evaluate(async () => {
    await canvas.scene.update({ width: 4500, padding: 0.25 }, { autoReposition: true })
  })
  await until(page, () => canvas.ready && canvas.dimensions.sceneRect.width === 4500, null, { timeout: 30000 })
  await page.waitForTimeout(800)
  const after = await fractions(page)
  const same = before.length === after.length && before.every((f, i) => Math.abs(f[0] - after[i][0]) < 0.002 && Math.abs(f[1] - after[i][1]) < 0.002)
  p.check(before.length === 5 && same, 'resizing the Scene (autoReposition) keeps the map in place on the Scene', { before, after })
  const savedAfter = await page.evaluate(() => {
    const r = canvas.dimensions.sceneRect
    const s = (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).find(o => o.type === 'symbol')
    return s ? [(s.point.point[0] - r.x) / r.width, (s.point.point[1] - r.y) / r.height] : null
  })
  p.check(savedAfter && Math.abs(savedAfter[0] - 0.5) < 0.002 && Math.abs(savedAfter[1] - 0.5) < 0.002, 'and the moved map is what the Scene saved', savedAfter)

  // Levels.
  const order = await page.evaluate(async () => {
    const scene = canvas.scene
    const settle = async () => {
      await new Promise(r => setTimeout(r, 300))
      const end = Date.now() + 20000
      while ((!canvas.ready || canvas.loading) && Date.now() < end) await new Promise(r => setTimeout(r, 150))
    }
    const [upper] = await scene.createEmbeddedDocuments('Level', [{
      name: 'Upper', elevation: { bottom: 10, top: 20 }, background: { src: 'icons/svg/cowled.svg' }
    }])
    await settle()
    const ground = scene.levels.find(l => l.id !== upper.id)
    if (ground && !ground.background?.src) await ground.update({ 'background.src': 'icons/svg/cowled.svg' })
    await settle()
    const above = () => {
      canvas.primary.sortChildren()
      const kids = canvas.primary.children
      const bg = canvas.primary.background
      return { linemap: kids.indexOf(canvas.linemap), background: bg ? kids.indexOf(bg) : null, bgElevation: bg?.elevation, layerElevation: canvas.linemap.elevation ?? 0 }
    }
    const wait = async (fn) => { const end = Date.now() + 20000; while (!fn() && Date.now() < end) await new Promise(r => setTimeout(r, 150)) }
    await scene.view({ level: ground.id })
    await wait(() => canvas.ready && canvas.level?.id === ground.id)
    const g = above()
    await scene.view({ level: upper.id })
    await wait(() => canvas.ready && canvas.level?.id === upper.id)
    const u = above()
    return { ground: g, upper: u, levels: scene.levels.size }
  })
  p.check(order.ground.background !== null && order.ground.linemap > order.ground.background, "on the ground level the map is drawn above the level's background", order.ground)
  p.check(order.upper.background !== null && order.upper.linemap > order.upper.background, "on a raised level the map is drawn above that level's background", order.upper)

  // A big map.
  const timing = await page.evaluate(() => {
    const L = canvas.linemap
    const keep = L.serialized
    const r = canvas.dimensions.sceneRect
    const objects = []
    const syms = Object.keys(CONFIG.linemap.symbols)
    const styles = Object.keys(CONFIG.linemap.lineStyles)
    for (let i = 0; i < 120; i++) {
      const x = r.x + 100 + (i % 12) * (r.width - 200) / 12
      const y = r.y + 100 + Math.floor(i / 12) * (r.height - 200) / 10
      objects.push({ id: `s${i}`, type: 'symbol', isRevealed: true, point: { point: [x, y] }, symbol: syms[i % syms.length] })
      if (i % 12) objects.push({ id: `l${i}`, type: 'line', isRevealed: true, style: styles[i % styles.length], points: [{ sourceId: `s${i - 1}`, sourceT: 0 }, { sourceId: `s${i}`, sourceT: 0 }] })
      if (i % 3 === 0) objects.push({ id: `t${i}`, type: 'text', isRevealed: true, point: { sourceId: `s${i}`, sourceT: 0 }, offset: [0, -40], text: `Place ${i}`, style: 'normal' })
    }
    for (let i = 0; i < 10; i++) {
      const x = r.x + 150 + i * 250
      objects.push({ id: `a${i}`, type: 'area', isRevealed: true, pattern: 'diagonal1', points: [[x, r.y + 150], [x + 200, r.y + 150], [x + 200, r.y + 400], [x, r.y + 400]] })
    }
    L.applyData({ ...keep, objects })
    const gl = canvas.app.renderer.gl
    const time = (hq, n) => {
      const t = []
      for (let i = 0; i < n; i++) {
        const t0 = performance.now()
        L.redraw(hq)
        gl.finish()
        t.push(performance.now() - t0)
      }
      t.sort((a, b) => a - b)
      return Math.round(t[Math.floor(t.length / 2)] * 10) / 10
    }
    time(false, 2)
    const low = time(false, 15)
    const high = time(true, 5)
    const count = L.objects.length
    // Where the time goes: the symbols alone, then with each other kind added.
    const part = {}
    for (const [name, keepType] of [['symbols', ['symbol']], ['+lines', ['symbol', 'line']], ['+labels', ['symbol', 'text']], ['+areas', ['symbol', 'area']]]) {
      L.applyData({ ...keep, objects: objects.filter(o => keepType.includes(o.type)) })
      time(false, 2)
      part[name] = time(false, 7)
    }
    L.applyData(keep)
    L.redraw()
    return { count, lowMs: low, highMs: high, part }
  })
  console.log(`  note  low-quality redraw by kind (median ms): ${JSON.stringify(timing.part)}`)
  p.check(timing.count >= 250 && timing.lowMs <= 16, `a map of ${timing.count} objects redraws for a drag within a frame (median ${timing.lowMs} ms; full quality ${timing.highMs} ms)`, timing)

  // Unknown entries, written straight into the flag as an older or newer build might have left them.
  const e0 = p.errors.length
  await page.evaluate(async () => {
    const r = canvas.dimensions.sceneRect
    const pt = (fx, fy) => [r.x + r.width * fx, r.y + r.height * fy]
    // Start from no map at all: the steps above saved this Scene's map in the new format.
    await canvas.scene.update({ 'flags.linemap': new foundry.data.operators.ForcedDeletion() })
    await canvas.scene.update({
      'flags.linemap.serialized': {
        isLightMode: false,
        symbolScale: 1,
        objects: [
          { id: 'goodSymbol000001', type: 'symbol', isRevealed: true, point: { point: pt(0.2, 0.5) }, symbol: 'curiosity' },
          { id: 'unknownType00001', type: 'no-such-type', isRevealed: true, extra: 42 },
          { id: 'unknownSymbol001', type: 'symbol', isRevealed: true, point: { point: pt(0.4, 0.5) }, symbol: 'no-such-symbol' },
          { id: 'unknownStyle0001', type: 'line', isRevealed: true, style: 'no-such-style', points: [{ point: pt(0.5, 0.6) }, { point: pt(0.8, 0.6) }] }
        ]
      }
    })
  })
  await reload(page)
  await viewScene(page, sceneId)
  const loaded = await until(page, () => {
    const L = canvas.linemap
    if (!L?.objects?.length) return null
    const good = L.objects.find(o => o.id === 'goodSymbol000001')
    return { count: L.objects.length, goodDrawn: !!good?.sprite?.parent }
  })
  p.check(loaded?.goodDrawn, 'a map holding unknown entries still loads and draws the known symbol', loaded)
  await tool(page, 'selectObject')
  await clickAt(page, await at(page, 0.65, 0.6))
  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.6, 0.3))
  const kept = await until(page, () => {
    const saved = canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []
    return saved.length >= 5 ? saved.map(o => ({ id: o.id, type: o.type, extra: o.extra, symbol: o.symbol, style: o.style })) : null
  }, null, { timeout: 8000 })
  const byId = Object.fromEntries((kept ?? []).map(o => [o.id, o]))
  p.check(byId.unknownType00001?.type === 'no-such-type' && byId.unknownType00001?.extra === 42 &&
    byId.unknownSymbol001?.symbol === 'no-such-symbol' && byId.unknownStyle0001?.style === 'no-such-style',
    'an edit saves the unknown entries back unchanged', kept)
  const format = await page.evaluate(() => {
    const f = canvas.scene.flags.linemap ?? {}
    return { objects: Object.keys(f.objects ?? {}).length, map: !!f.map, serialized: 'serialized' in f }
  })
  p.check(format.objects === 5 && format.map && !format.serialized,
    'that first edit moved the old-format map to one flag key per object, and removed the old key', format)
  p.check(p.errors.length === e0, 'loading, clicking and saving that map raises no error', p.errors.slice(e0, e0 + 3))
} catch (err) {
  await p.threw(err)
}
await p.finish()
