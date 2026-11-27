#!/usr/bin/env node
// dev:terminal: a retro computer-terminal look for sci-fi maps. A label font in the style of a late-70s
// terminal (VT323, SIL OFL), and a Terminal theme: phosphor green on a near-black screen with faint
// scanlines, a dark glow behind symbols and labels, the sci-fi symbols and lines.
// - VT323 is in the scene settings' label fonts, and the Terminal theme in its themes.
// - Picking Terminal sets the colour, VT323, the halo and the screen background; the map is dark.
// - The font is really loaded: it is monospaced, so "iiii" and "MMMM" measure the same (a fallback
//   serif would not), and a label is drawn in it, its pixels green.
import { moduleWarnings, probe, probeScene, scaled, sweep, tool, until } from './lib.mjs'

const p = probe('dev:terminal', { watchdogMs: 300000 })
const FORM = '#linemap-scene-properties'
const GREEN = '#4dff7a'

const openSettings = async (page) => {
  await tool(page, 'selectObject')
  await page.locator('#scene-controls [data-tool="linemapSettings"]').first().click()
  await page.waitForSelector(`${FORM} select[name="labelFont"]`, { timeout: 10000 })
  await page.waitForTimeout(300)
}
const closeSettings = (page) => page.evaluate(async () => {
  for (const app of [...foundry.applications.instances.values()]) if (app.id === 'linemap-scene-properties') await app.close({ animate: false })
})
const options = (page, name) => page.evaluate(({ FORM, name }) => [...document.querySelectorAll(`${FORM} select[name="${name}"] option`)].map(o => o.value), { FORM, name })
const near = (drawn, want, tol = 40) => {
  if (!drawn) return false
  const a = [1, 3, 5].map(i => parseInt(drawn.slice(i, i + 2), 16))
  const b = [1, 3, 5].map(i => parseInt(want.slice(i, i + 2), 16))
  return a.every((v, i) => Math.abs(v - b[i]) <= tol)
}

try {
  const gm = await p.gmPage()
  await sweep(gm)
  await probeScene(p, gm, 'terminal')
  await gm.addStyleTag({ content: '#pause { display: none !important; }' })

  await openSettings(gm)
  const fonts = await options(gm, 'labelFont')
  const themes = await options(gm, 'theme')
  p.check(fonts.includes('VT323'), 'VT323 is in the scene settings\' label fonts', fonts)
  p.check(themes.includes('terminal'), 'the Terminal theme is in its themes', themes)
  if (!themes.includes('terminal')) throw new Error('no Terminal theme')

  await gm.locator(`${FORM} select[name="theme"]`).first().selectOption('terminal')
  const applied = await until(gm, () => canvas.scene.flags?.linemap?.map?.theme === 'terminal' &&
    canvas.linemap.objects.some(o => o.constructor.type === 'image' && o.src === CONFIG.linemap.themes.terminal?.background))
  await gm.waitForTimeout(scaled(800))
  await closeSettings(gm)
  const map = await gm.evaluate(() => ({ color: canvas.linemap.color, labelFont: canvas.linemap.labelFont, halo: canvas.linemap.halo, background: CONFIG.linemap.themes.terminal?.background }))
  p.check(!!applied && map.color === GREEN && map.labelFont === 'VT323' && map.halo === true && /terminal\/screen\.svg$/.test(map.background ?? ''),
    'picking Terminal sets phosphor green, VT323, the halo and the screen background', map)

  // The font is loaded, and monospaced.
  const font = await gm.evaluate(async () => {
    await document.fonts.load('32px VT323')
    const style = new PIXI.TextStyle({ fontFamily: ['VT323', 'serif'], fontSize: 32 })
    const w = (s) => Math.round(PIXI.TextMetrics.measureText(s, style).width * 10) / 10
    return { check: document.fonts.check('32px VT323'), narrow: w('iiii'), wide: w('MMMM') }
  })
  p.check(font.check && font.narrow > 0 && Math.abs(font.narrow - font.wide) < 1, 'VT323 is loaded: "iiii" and "MMMM" measure the same, as in a terminal', font)

  // A label in it, green, on a dark map.
  const id = await gm.evaluate(async () => {
    const api = game.modules.get('linemap').api
    const [id] = await api.add(api.label({ text: 'DOCKING BAY 3', x: 1200, y: 800, size: 2 }))
    return id
  })
  await until(gm, (id) => !!canvas.linemap.objects.find(o => o.id === id)?.sprite, id)
  await gm.waitForTimeout(scaled(500))
  const label = await gm.evaluate((id) => {
    const L = canvas.linemap
    L.setSelection()
    L.redraw()
    const o = L.objects.find(o => o.id === id)
    const family = [o.sprite?.style?.fontFamily].flat()[0] ?? [o.sprite?.children?.[0]?.style?.fontFamily].flat()[0]
    const b = o.sprite.getBounds ? o.sprite.getLocalBounds() : null
    const px = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(1050, 770, 300, 60))
    const counts = new Map()
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 250) continue
      const [r, g, bl] = [px[i], px[i + 1], px[i + 2]]
      if (g < 150) continue
      const key = '#' + [r, g, bl].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0').slice(-2)).join('')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let best = null, n = 0
    for (const [k, c] of counts) if (c > n) { best = k; n = c }
    const s = canvas.dimensions.sceneRect
    const d = canvas.app.renderer.extract.pixels(L.renderTexture, new PIXI.Rectangle(s.x + s.width - 120, s.y + s.height - 120, 40, 40))
    let luma = 0
    for (let i = 0; i < d.length; i += 4) luma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return { family, width: b && Math.round(b.width), color: best, greenPixels: n, backdrop: Math.round(luma / (d.length / 4)) }
  }, id)
  p.check(label.family === 'VT323' && near(label.color, GREEN) && label.greenPixels > 100 && label.backdrop < 40,
    'a label is drawn in VT323, phosphor green, on a dark screen', label)

  await gm.evaluate(() => canvas.pan({ x: 1200, y: 900, scale: 0.6 }))
  await gm.waitForTimeout(scaled(500))
  await p.shot(gm, 'terminal')

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
