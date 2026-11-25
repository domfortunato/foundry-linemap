#!/usr/bin/env node
// dev:draw: each drawing tool, driven with the mouse as a Gamemaster would, makes its object on the
// probe's own Scene: a symbol, a line, a waypoint on that line, an area and a label typed through the
// text dialog. Each is saved to the Scene's flag (flags.linemap.serialized) and comes back the same
// after a reload.
import { at, clickAt, countTypes, dragThrough, layerState, probe, probeScene, reload, sweep, tool, until, writeLabel } from './lib.mjs'

const LABEL = 'Hollow Hills of Wending'
const p = probe('dev:draw', { watchdogMs: 240000 })
try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'draw')
  await tool(page, 'selectObject')
  p.check(await page.evaluate(() => canvas.linemap.active && canvas.linemap.objects.length === 0), 'Line Map is the active layer, and the new Scene has no map')

  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.3, 0.3))
  let s = await layerState(page)
  p.check(countTypes(s.objects).symbol === 1, 'a click with the symbol tool places a symbol', countTypes(s.objects))

  await tool(page, 'drawLine')
  await dragThrough(page, [await at(page, 0.35, 0.65), await at(page, 0.5, 0.65), await at(page, 0.7, 0.65)])
  s = await layerState(page)
  p.check(countTypes(s.objects).line === 1, 'a drag with the line tool draws one line', countTypes(s.objects))

  // A waypoint snaps to a line: click the line's middle.
  const mid = await page.evaluate(() => {
    const line = canvas.linemap.objects.find(o => o.constructor.type === 'line')
    const [x, y] = line.getParametricPoint(0.5, 1)
    return { x: Math.round(x), y: Math.round(y) }
  })
  await tool(page, 'drawWaypoint')
  await clickAt(page, mid)
  s = await layerState(page)
  p.check(countTypes(s.objects).waypoint === 1, 'a click on the line with the waypoint tool places a waypoint', countTypes(s.objects))
  const linked = await page.evaluate(() => {
    const wp = canvas.linemap.objects.find(o => o.constructor.type === 'waypoint')
    return wp?.point?.sourceObject?.constructor?.type ?? null
  })
  p.check(linked === 'line', 'the waypoint is constrained to the line', linked)

  await tool(page, 'drawArea')
  await dragThrough(page, [await at(page, 0.55, 0.15), await at(page, 0.65, 0.25), await at(page, 0.75, 0.4)])
  s = await layerState(page)
  p.check(countTypes(s.objects).area === 1, 'a drag with the area tool draws an area', countTypes(s.objects))

  await writeLabel(page, await at(page, 0.3, 0.5), LABEL)
  s = await layerState(page)
  p.check(countTypes(s.objects).text === 1, 'the text tool places the label typed in its dialog', countTypes(s.objects))
  const text = await page.evaluate(() => canvas.linemap.objects.find(o => o.constructor.type === 'text')?.text)
  p.check(text === LABEL, 'the label says what was typed', text)

  const saved = await until(page, () => {
    const saved = canvas.scene.getFlag('linemap', 'serialized')?.objects ?? []
    return saved.length === canvas.linemap.objects.length ? saved.length : null
  })
  p.check(saved === 5, "all five objects are saved in the Scene's flag", saved)
  const drawn = await page.evaluate(() => canvas.linemap.objects.filter(o => o.constructor.type !== 'line' && o.constructor.type !== 'area')
    .map(o => [o.constructor.type, Boolean(o.sprite?.parent) && o.sprite.visible !== false]))
  p.check(drawn.every(([, on]) => on), 'the symbol, waypoint and label have sprites on the canvas', drawn)

  const before = JSON.stringify(countTypes(s.objects))
  await reload(page)
  const back = await until(page, (sceneId) => canvas.ready && canvas.scene?.id === sceneId && canvas.linemap.objects.length ? canvas.linemap.objects.length : null, sceneId, { timeout: 30000 })
  s = await layerState(page)
  p.check(back && JSON.stringify(countTypes(s.objects)) === before, 'after a reload the layer holds the same objects', { before, after: countTypes(s.objects) })
  p.check(await page.evaluate(() => canvas.linemap.objects.find(o => o.constructor.type === 'text')?.text) === LABEL, 'after a reload the label still says what was typed')
  p.check(await page.evaluate(() => canvas.linemap.objects.find(o => o.constructor.type === 'waypoint')?.point?.sourceObject?.constructor?.type) === 'line',
    'after a reload the waypoint is still constrained to the line')
} catch (err) {
  await p.threw(err)
}
await p.finish()
