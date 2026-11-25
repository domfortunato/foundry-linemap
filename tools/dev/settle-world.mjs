#!/usr/bin/env node
// Settle a probe world before its snapshot is taken: join as the Gamemaster, make sure this module
// is enabled in the world (a world made by hand has every module off), and wait until the world stops
// changing (its documents and world settings read the same for five seconds running).
//
//   FOUNDRY_URL=http://<host>:<port> node tools/dev/settle-world.mjs
//
// It refuses a world that still holds a probe's leftovers (a Scene or User named with PROBE_TAG),
// since a snapshot of it would hand them to every later run. Enabling the module is the only thing it
// writes.
import { MODULE_ID, PROBE_TAG, VIEWPORT, joinAs, reload, scaled, watchPage } from './lib.mjs'
import { chromium } from 'playwright'

const QUIET_MS = 5000
const SETTLE_MS = 120000
const LIMIT = scaled(SETTLE_MS + 180000)
const timer = setTimeout(() => { console.error(`  FAIL  settle-world exceeded ${LIMIT}ms: treating as a hang`); process.exit(1) }, LIMIT)

const browser = await chromium.launch()
let settled = false
try {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
  const { errors } = watchPage(page)
  await joinAs(page)

  const before = await page.evaluate((id) => game.modules.get(id)?.active === true, MODULE_ID)
  if (!before) {
    await page.evaluate(async (id) => {
      const config = game.settings.get('core', 'moduleConfiguration')
      await game.settings.set('core', 'moduleConfiguration', { ...config, [id]: true })
    }, MODULE_ID)
    await reload(page)
  }
  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, MODULE_ID)
  if (!active) throw new Error(`${MODULE_ID} is still not active after enabling it and reloading`)

  const leftovers = await page.evaluate((tag) => [...game.scenes, ...game.users].filter(d => d.name?.includes(tag)).map(d => d.name), PROBE_TAG)
  if (leftovers.length) throw new Error(`the world holds a probe's leftovers, so it is no baseline: ${leftovers.join(', ')}`)

  // The world's state, cheaply: how many of each document, and every world setting's value.
  const state = () => page.evaluate(() => JSON.stringify({
    docs: ['actors', 'items', 'journal', 'scenes', 'tables', 'folders', 'macros', 'messages', 'playlists', 'cards', 'users']
      .map((c) => game[c]?.size ?? 0),
    settings: [...game.settings.storage.get('world')?.values?.() ?? game.settings.storage.get('world') ?? []]
      .map((s) => `${s.key}=${typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}`).sort()
  }))
  const deadline = Date.now() + scaled(SETTLE_MS)
  let last = await state()
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    const now = await state()
    if (now !== last) { last = now; quietSince = Date.now(); continue }
    if (Date.now() - quietSince >= QUIET_MS) { settled = true; break }
  }
  const out = await page.evaluate((id) => ({
    world: game.world.id, core: game.version, system: `${game.system.id} ${game.system.version}`, module: game.modules.get(id)?.version
  }), MODULE_ID)
  console.log(`${process.env.FOUNDRY_URL}: ${out.world} on Foundry ${out.core}, ${out.system}; ${MODULE_ID} ${out.module} `
    + `${before ? 'was already enabled' : 'enabled'}; ${settled ? `quiet for ${QUIET_MS / 1000} s` : `still changing after ${SETTLE_MS / 1000} s`}`)
  if (!settled) console.error('  FAIL  the world never went quiet, so this is no baseline')
  if (errors.length) console.log(`  note  console errors while settling: ${errors.slice(0, 5).join(' | ')}`)
} catch (err) {
  console.error(`  FAIL  settle-world: ${String(err?.message ?? err).split('\n')[0]}`)
  settled = false
} finally {
  clearTimeout(timer)
  await browser.close()
}
process.exit(settled ? 0 : 1)
