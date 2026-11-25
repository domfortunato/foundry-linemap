// Helpers for the browser probes in tools/dev (e2e-*.mjs): each is a `dev:<name>` script in
// package.json, run against a Foundry world with this module enabled:
//
//   FOUNDRY_URL=http://<host>:<port> npm run dev:setup
//
// A probe prints one line per check and a summary line last, and exits 0 only when everything passed:
//
//   "  ok    <what>"  a check that passed     "  FAIL  <what>"  a check that failed
//   "PASS 7/7 checks on <url>" or "FAIL 6/7 checks on <url>"
//
// A probe that hangs is stopped by its watchdog, which says "exceeded <n>ms: treating as a hang".
// MB_TIME_SCALE (a number, default 1) stretches every wait and the watchdog, for slow machines.
// MB_SHOTS is where screenshots of a failure go (default tools/dev/out).
//
// The rules every probe keeps:
// - It never activates a Scene. It makes its own, named with PROBE_TAG, views it, draws only while
//   that Scene is on the canvas (onProbeScene), and deletes it from a cleanup.
// - It leaves the world as it found it: whatever it makes carries PROBE_TAG in its name, so `sweep`
//   removes what a probe that died left behind.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

export const FOUNDRY_URL = (process.env.FOUNDRY_URL ?? '').replace(/\/$/, '')
if (!FOUNDRY_URL) {
  console.error('FOUNDRY_URL is required: the Foundry server to probe, e.g. FOUNDRY_URL=http://<host>:30000')
  process.exit(2)
}
export const MODULE_ID = 'linemap'
/** Foundry's minimum supported resolution; below it, it logs a console error. */
export const VIEWPORT = { width: 1600, height: 1000 }
export const TIME_SCALE = Math.max(1, Number(process.env.MB_TIME_SCALE) || 1)
export const SHOTS = process.env.MB_SHOTS ?? path.resolve('tools/dev/out')
/** In the name of everything a probe creates. */
export const PROBE_TAG = '[linemap-probe]'

export const scaled = (ms) => Math.round(ms * TIME_SCALE)

/**
 * One probe's checks and summary line.
 *
 *   const p = probe('dev:setup')
 *   p.check(cond, 'what was expected', 'what was seen instead')
 *   await p.finish()   // runs the cleanups, prints the summary, closes the browser, exits
 */
export function probe (label, { watchdogMs = 300000 } = {}) {
  let passed = 0
  let total = 0
  const errors = []
  const warnings = []
  let browser = null
  const pages = []
  const cleanups = []

  const check = (cond, what, seen) => {
    total++
    if (cond) {
      passed++
      console.log(`  ok    ${what}`)
    } else {
      console.log(`  FAIL  ${what}${seen === undefined ? '' : ` (saw: ${typeof seen === 'string' ? seen : JSON.stringify(seen)})`}`)
    }
    return Boolean(cond)
  }

  const summary = () => {
    const good = passed === total && total > 0
    console.log(`\n${good ? 'PASS' : 'FAIL'} ${passed}/${total} checks on ${FOUNDRY_URL} (${label})`)
    return good
  }

  async function runCleanups () {
    while (cleanups.length) {
      const fn = cleanups.pop()
      try { await fn() } catch (err) { console.log(`  note  cleanup: ${String(err?.message ?? err).split('\n')[0]}`) }
    }
  }

  // A hang is the worst failure: it costs the run its time and says nothing. Undo what can be undone,
  // close the browser (a parked GM session would disturb the next probe) and exit with what was seen.
  const ms = scaled(watchdogMs)
  const timer = setTimeout(async () => {
    console.log(`  FAIL  ${label} exceeded ${ms}ms: treating as a hang`)
    total++
    await Promise.race([runCleanups(), new Promise(resolve => setTimeout(resolve, 5000))]).catch(() => {})
    await Promise.race([browser?.close(), new Promise(resolve => setTimeout(resolve, 2000))]).catch(() => {})
    summary()
    process.exit(1)
  }, ms)
  timer.unref()

  async function newPage () {
    browser ??= await chromium.launch()
    const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    watchPage(page, errors, warnings)
    pages.push(page)
    return page
  }

  return {
    check,
    errors,
    warnings,
    /** Something to undo however the probe ends; run last-registered first. */
    cleanup: (fn) => cleanups.push(fn),
    /** A browser page joined to the world as the Gamemaster, watched for errors. */
    async gmPage () {
      const page = await newPage()
      await joinAs(page)
      return page
    },
    /** Another page, in its own browser context (its own session), joined as the named user. */
    async pageAs (name) {
      const page = await newPage()
      await joinAs(page, name)
      return page
    },
    /** A screenshot into SHOTS, named for the probe; never fails the probe. */
    async shot (page, name) {
      try {
        fs.mkdirSync(SHOTS, { recursive: true })
        const file = path.join(SHOTS, `${label.replace(/[^a-z0-9-]+/gi, '_')}-${name}.png`)
        await page.screenshot({ path: file })
        console.log(`  note  screenshot ${file}`)
      } catch (err) { console.log(`  note  no screenshot: ${String(err?.message ?? err).split('\n')[0]}`) }
    },
    /** Record a thrown error as a failed check, with a screenshot of every page. */
    async threw (err) {
      const lines = String(err?.message ?? err).split('\n')
      check(false, `the probe ran to the end without throwing: ${err?.name ?? 'Error'}: ${lines[0]}`)
      // Playwright's call log (what it waited for, what was in the way) follows the first line
      for (const l of lines.slice(1, 12)) if (l.trim()) console.log(`        ${l.trim()}`)
      for (const [i, page] of pages.entries()) await this.shot(page, `threw-${i}`)
    },
    async finish () {
      clearTimeout(timer)
      await runCleanups()
      if (errors.length) {
        console.log('\nconsole errors:')
        for (const e of errors.slice(0, 10)) console.log(`  ${e}`)
      }
      check(errors.length === 0, 'no console errors, page errors or missing module files', `${errors.length}, listed above`)
      await browser?.close().catch(() => {})
      process.exit(summary() ? 0 : 1)
    }
  }
}

/**
 * Console errors, page errors and any of this module's files that 404, minus what headless Chromium
 * and core always raise; warnings are kept apart (a probe checks the ones it cares about).
 */
export function watchPage (page, errors = [], warnings = []) {
  const ignore = [
    /requires a screen resolution/i,
    /hardware acceleration/i,
    // A race inside core's notification UI (it re-queries its own card after an animation).
    /Cannot set properties of null \(setting 'hidden'\)[\s\S]*#postNotification/
  ]
  const keep = (t) => !ignore.some(re => re.test(t))
  page.on('console', m => {
    const where = m.location()?.url ? ` [${m.location().url.replace(FOUNDRY_URL, '')}]` : ''
    if (m.type() === 'error' && keep(m.text())) errors.push(m.text())
    else if (m.type() === 'warning') warnings.push(`${m.text()}${where}`)
  })
  page.on('pageerror', e => {
    const frames = String(e.stack ?? '').split('\n').slice(1, 5).map(s => s.trim()).join(' <- ')
    const t = `pageerror: ${e.message}${frames ? `\n    at ${frames}` : ''}`
    if (keep(t)) errors.push(t)
  })
  page.on('response', r => {
    if (r.status() === 404 && r.url().includes(`/modules/${MODULE_ID}/`)) errors.push(`404 ${r.url().replace(FOUNDRY_URL, '')}`)
  })
  return { errors, warnings }
}

/** Warnings that name this module (a deprecation's stack names the file that called it). */
export const moduleWarnings = (warnings, since = 0) =>
  warnings.slice(since).filter(w => /linemap/i.test(w) && /deprecat|since v?\d+|until v?\d+/i.test(w))

/**
 * Join as the Gamemaster (the role-4 user), or as the user named, whichever join form this build
 * draws: a typed `username` on 14.367 and 14.368, a `userId` dropdown from 14.369 (which disables a
 * user already in the world: that is waited out, since a parked session would skew the probe).
 */
export async function joinAs (page, name = null) {
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'networkidle', timeout: scaled(60000) })
  const deadline = Date.now() + scaled(20000)
  for (;;) {
    await page.waitForSelector('select[name="userid" i] option[value]:not([value=""]), input[name="username"]',
      { state: 'attached', timeout: scaled(30000) })
    const r = await page.evaluate((name) => {
      const raw = globalThis.game?.users
      const users = raw?.contents ?? (Array.isArray(raw) ? raw : [])
      const user = name ? users.find(u => u.name === name) : users.find(u => u.role === 4)
      if (!user) return { picked: null }
      const id = user.id ?? user._id
      const select = document.querySelector('select[name="userid" i]')
      if (select) {
        const opt = [...select.options].find(o => o.value === id)
        if (!opt) return { picked: null }
        if (opt.disabled || user.active === true) return { busy: user.name }
        select.value = id
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return { picked: user.name }
      }
      const field = document.querySelector('input[name="username"]')
      if (!field) return { picked: null }
      if (user.active === true) return { busy: user.name }
      field.value = user.name
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
      return { picked: user.name }
    }, name)
    if (r.picked) break
    if (!r.busy) throw new Error(`join: the world has no ${name ? `user "${name}"` : 'Gamemaster user'} to join as`)
    if (Date.now() > deadline) throw new Error(`join: "${r.busy}" already holds a session in this world (a parked tab or an orphaned probe browser)`)
    await page.waitForTimeout(2000)
    await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'networkidle', timeout: scaled(60000) })
  }
  await page.locator('button[type="submit"][name="join"], form#join-game button[type="submit"]').first().click({ timeout: scaled(15000) })
  await waitReady(page, 'after the join')
}

/**
 * Wait for game.ready and, when there is a Scene to show (the one this user views, else the active
 * one), a drawn canvas; on a timeout, say what the page showed instead.
 */
export async function waitReady (page, when) {
  try {
    await page.waitForFunction(() => globalThis.game?.ready === true && (!game.scenes.current || canvas.ready === true), null, { timeout: scaled(90000) })
  } catch (err) {
    const shown = await page.evaluate(() => `${location.pathname}: ${document.title}: ${document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 300)}`).catch(() => '?')
    throw new Error(`the world never became ready ${when}; the page showed ${shown}`)
  }
  await dismissChrome(page)
}

export async function reload (page) {
  await page.reload({ waitUntil: 'networkidle', timeout: scaled(60000) })
  await waitReady(page, 'after a reload')
}

/** Tours, notifications and framed windows (the host system's welcome) cover the canvas; clear them. */
export async function dismissChrome (page) {
  await page.evaluate(async () => {
    try { for (const t of globalThis.game?.tours?.contents ?? []) if (t.status === 'in-progress') t.exit() } catch { /* no tours */ }
    document.querySelectorAll('.tour-overlay, .tour.active').forEach(e => e.remove())
    try { globalThis.ui?.notifications?.clear?.() } catch { /* pre-ready */ }
    document.querySelectorAll('#notifications > li').forEach(e => e.remove())
    for (const app of [...(globalThis.foundry?.applications?.instances?.values() ?? [])]) {
      if (app.hasFrame && app.rendered) await app.close({ animate: false }).catch(() => {})
    }
  }).catch(() => {})
}

/** Poll in the page until fn(arg) returns a truthy value, or give up and return it falsy. */
export async function until (page, fn, arg, { timeout = 15000, every = 150 } = {}) {
  const end = Date.now() + scaled(timeout)
  let v
  do {
    v = await page.evaluate(fn, arg)
    if (v) return v
    await page.waitForTimeout(every)
  } while (Date.now() < end)
  return v
}

/** Delete every Scene and User a probe made (PROBE_TAG in its name). Returns how many went. */
export async function sweep (page) {
  return page.evaluate(async (tag) => {
    let n = 0
    for (const coll of [game.scenes, game.users]) {
      const ids = coll.filter(d => d.name?.includes(tag) && !(coll === game.users && d.id === game.user.id)).map(d => d.id)
      if (ids.length) {
        await coll.documentClass.deleteDocuments(ids)
        n += ids.length
      }
    }
    return n
  }, PROBE_TAG)
}

/**
 * Make this probe's own Scene (gridless, 3000 x 2000, no padding, players may observe it), view it,
 * and delete it when the probe ends. Never activated: a world's active Scene is not a probe's.
 */
export async function probeScene (p, page, name) {
  const id = await page.evaluate(async ({ name }) => {
    const scene = await foundry.documents.Scene.create({
      name, width: 3000, height: 2000, padding: 0, grid: { type: 0 }, navigation: false, ownership: { default: 2 }
    })
    return scene.id
  }, { name: `${PROBE_TAG} ${name}` })
  p.cleanup(() => page.evaluate(async (id) => {
    const scene = game.scenes.get(id)
    if (!scene) return
    await scene.delete()
  }, id))
  await viewScene(page, id)
  return id
}

export async function viewScene (page, sceneId) {
  await page.evaluate(async (sceneId) => {
    const scene = game.scenes.get(sceneId)
    if (scene && canvas.scene?.id !== sceneId) await scene.view()
  }, sceneId)
  const ok = await until(page, (sceneId) => canvas.ready && canvas.scene?.id === sceneId, sceneId, { timeout: 60000 })
  if (!ok) throw new Error(`the Scene ${sceneId} never came onto the canvas`)
  await page.waitForTimeout(scaled(600))
  await dismissChrome(page)
}

/** Refuse to touch the canvas unless a probe's own Scene is on it. */
export async function onProbeScene (page) {
  const name = await page.evaluate(() => canvas.scene?.name ?? null)
  if (!name?.startsWith(PROBE_TAG)) throw new Error(`refusing to draw: the canvas shows "${name}", not a probe's Scene`)
}

/** Pick a Line Map tool (or another control's, with `control`). */
export async function tool (page, name, control = 'linemap') {
  await page.evaluate(({ control, name }) => ui.controls.activate({ control, tool: name }), { control, name })
  await page.waitForTimeout(scaled(400))
}

/** Pan the view (scale 1) so a canvas point is on screen, and hand back where it is. */
export async function screenAt (page, point) {
  await page.evaluate((p) => canvas.pan({ x: p.x, y: p.y, scale: 1 }), point)
  await page.waitForTimeout(scaled(250))
  return page.evaluate((p) => canvas.clientCoordinatesFromCanvas(p), point)
}

export async function clickAt (page, point, { button = 'left', clicks = 1 } = {}) {
  await onProbeScene(page)
  const c = await screenAt(page, point)
  await page.mouse.move(c.x - 6, c.y - 6)
  await page.mouse.move(c.x, c.y, { steps: 3 })
  await page.waitForTimeout(80)
  for (let i = 0; i < clicks; i++) {
    await page.mouse.down({ button })
    await page.waitForTimeout(clicks > 1 ? 30 : 60)
    await page.mouse.up({ button })
    if (i < clicks - 1) await page.waitForTimeout(60)
  }
  await page.waitForTimeout(scaled(300))
}

/** Drag through canvas points, in small steps so core sees one move a frame. */
export async function dragThrough (page, points, { button = 'left' } = {}) {
  await onProbeScene(page)
  const middle = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
  await screenAt(page, middle)
  const screen = await page.evaluate((list) => list.map((p) => canvas.clientCoordinatesFromCanvas(p)), points)
  await page.mouse.move(screen[0].x, screen[0].y, { steps: 3 })
  await page.waitForTimeout(120)
  await page.mouse.down({ button })
  for (const point of screen.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 12 })
    await page.waitForTimeout(140)
  }
  await page.waitForTimeout(120)
  await page.mouse.up({ button })
  await page.waitForTimeout(scaled(400))
}

/** Type a label through the text tool's dialog, which a drawText click opens. */
export async function writeLabel (page, point, text) {
  await tool(page, 'drawText')
  await clickAt(page, point)
  await page.waitForSelector('textarea.linemap-text-content', { timeout: scaled(10000) })
  await page.fill('textarea.linemap-text-content', text)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(scaled(800))
}

/** The canvas point at a fraction of the Scene's rectangle: at(0.5, 0.5) is its centre. */
export const at = (page, fx, fy) => page.evaluate(({ fx, fy }) => {
  const r = canvas.dimensions.sceneRect
  return { x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height * fy) }
}, { fx, fy })

/** What the layer holds, and what the Scene's flag has saved. */
export const layerState = (page) => page.evaluate(() => ({
  objects: canvas.linemap.objects.map(o => ({ type: o.constructor.type, isRevealed: o.isRevealed })),
  saved: (canvas.linemap.constructor.readFlag(canvas.scene)?.objects ?? []).map(o => ({ type: o.type, isRevealed: o.isRevealed }))
}))

/** The count of each object type in a list from layerState. */
export const countTypes = (list) => list.reduce((m, o) => ({ ...m, [o.type]: (m[o.type] ?? 0) + 1 }), {})
