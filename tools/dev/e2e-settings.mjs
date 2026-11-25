#!/usr/bin/env node
// dev:settings: the Scene's Line Map settings, through the settings window as a Gamemaster uses it.
// Light mode, symbol scale and label font each change the layer, are saved in the Scene's flag, and
// survive a reload; the label is redrawn in the chosen font. The window raises no deprecation
// warning from this module. A Scene with no map starts from the defaults, not from the last Scene's
// settings, and going back restores that Scene's own.
import { at, clickAt, moduleWarnings, probe, probeScene, reload, sweep, tool, until, viewScene, writeLabel } from './lib.mjs'

const p = probe('dev:settings', { watchdogMs: 300000 })
const FORM = '#linemap-scene-properties'
const values = (page) => page.evaluate(() => {
  const L = canvas.linemap
  const saved = canvas.linemap.constructor.readFlag(canvas.scene) ?? {}
  const label = L.objects.find(o => o.constructor.type === 'text')
  return {
    isLightMode: L.isLightMode,
    symbolScale: L.symbolScale,
    labelFont: L.labelFont,
    saved: { isLightMode: saved.isLightMode, symbolScale: saved.symbolScale, labelFont: saved.labelFont },
    labelSprite: label?.sprite ? String(label.sprite.style?.fontFamily) : null
  }
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

try {
  const page = await p.gmPage()
  await sweep(page)
  const sceneId = await probeScene(p, page, 'settings')
  await writeLabel(page, await at(page, 0.4, 0.4), 'Ashfall Crossing')
  await tool(page, 'drawSymbol')
  await clickAt(page, await at(page, 0.6, 0.4))

  const w0 = p.warnings.length
  await openSettings(page)
  p.check(moduleWarnings(p.warnings, w0).length === 0, 'the settings window opens with no deprecation warning from this module', moduleWarnings(p.warnings, w0))
  const form0 = await page.evaluate((FORM) => {
    const f = document.querySelector(`${FORM} form`) ?? document.querySelector(FORM)
    return {
      isLightMode: f.querySelector('[name="isLightMode"]')?.value,
      symbolScale: f.querySelector('range-picker[name="symbolScale"]') ? Number(f.querySelector('range-picker[name="symbolScale"]').value) : null,
      labelFont: f.querySelector('[name="labelFont"]')?.value,
      fonts: [...f.querySelectorAll('[name="labelFont"] option')].map(o => o.value)
    }
  }, FORM)
  p.check(form0.isLightMode === '' && form0.symbolScale === 1 && form0.labelFont === 'Alegreya',
    'a new map starts in dark mode, at scale 1, in Alegreya', form0)
  p.check(JSON.stringify(form0.fonts) === JSON.stringify(['Alegreya', 'IM Fell English']), 'the label font choices are the two shipped fonts', form0.fonts)
  p.check((await values(page)).labelSprite?.includes('Alegreya'), 'the label is drawn in Alegreya', (await values(page)).labelSprite)

  await page.selectOption(`${FORM} select[name="isLightMode"]`, 'true')
  let v = await until(page, () => canvas.linemap.constructor.readFlag(canvas.scene)?.isLightMode === true) && await values(page)
  p.check(v && v.isLightMode === true, 'choosing light mode switches the layer to it and saves it', v)

  await page.evaluate((FORM) => {
    const el = document.querySelector(`${FORM} range-picker[name="symbolScale"]`)
    el.value = 1.5
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, FORM)
  v = await until(page, () => canvas.linemap.constructor.readFlag(canvas.scene)?.symbolScale === 1.5) && await values(page)
  p.check(v && v.symbolScale === 1.5, 'the scale picker sets the symbol scale and saves it', v)

  await page.selectOption(`${FORM} select[name="labelFont"]`, 'IM Fell English')
  v = await until(page, () => canvas.linemap.constructor.readFlag(canvas.scene)?.labelFont === 'IM Fell English') && await values(page)
  p.check(v && v.labelFont === 'IM Fell English', 'choosing IM Fell English sets the label font and saves it', v)
  const redrawn = await until(page, () => {
    const label = canvas.linemap.objects.find(o => o.constructor.type === 'text')
    return String(label?.sprite?.style?.fontFamily ?? '').includes('IM Fell English')
  })
  p.check(redrawn, 'the label is redrawn in IM Fell English')
  await closeSettings(page)

  // A reload brings the canvas back to the active Scene, and the probe's own is only viewed: view it again.
  await reload(page)
  await viewScene(page, sceneId)
  v = await values(page)
  p.check(v.isLightMode === true && v.symbolScale === 1.5 && v.labelFont === 'IM Fell English', 'after a reload the three settings are as chosen', v)

  // A Scene with no map, then back.
  await probeScene(p, page, 'settings, no map')
  v = await values(page)
  p.check(v.isLightMode === false && v.symbolScale === 1 && v.labelFont === 'Alegreya', "a Scene with no map starts from the defaults, not the last Scene's settings", v)
  p.check(await page.evaluate(() => canvas.linemap.constructor.readFlag(canvas.scene) === undefined), 'viewing it wrote no map into it')
  await viewScene(page, sceneId)
  v = await values(page)
  p.check(v.isLightMode === true && v.symbolScale === 1.5 && v.labelFont === 'IM Fell English', "going back, the first Scene has its own settings again", v)

  p.check(moduleWarnings(p.warnings).length === 0, 'no deprecation warning from this module in the whole probe', moduleWarnings(p.warnings))
} catch (err) {
  await p.threw(err)
}
await p.finish()
