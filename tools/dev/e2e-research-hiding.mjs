#!/usr/bin/env node
// dev:research-hiding: THROWAWAY (ROADMAP step 2's gate). Which store does a player's client never
// receive? A Gamemaster puts a unique marker in each candidate store; a player then searches
// everything their client holds, and every socket frame it receives while the Gamemaster updates
// each store with a second marker. A store whose markers never reach the player is a candidate for
// real hiding. Every check here is a finding, not a pass/fail of the module: the summary line is
// read, not gated on.
import { PROBE_TAG, probe, probeScene, scaled, sweep } from './lib.mjs'

const PLAYER = `${PROBE_TAG} Player`
const PACK = 'linemap-probe-secrets'
const p = probe('dev:research-hiding', { watchdogMs: 300000 })
const mark = (store, n) => `LMSECRET-${store}-${n}-${Math.random().toString(36).slice(2, 10)}`
const STORES = ['sceneFlag', 'journalNone', 'journalPageNone', 'macroNone', 'worldSetting', 'userSettingGM', 'userFlagGM', 'packNone', 'actorNone']

try {
  const gm = await p.gmPage()
  await sweep(gm)
  const sceneId = await probeScene(p, gm, 'research hiding')
  const first = Object.fromEntries(STORES.map(s => [s, mark(s, 1)]))
  const second = Object.fromEntries(STORES.map(s => [s, mark(s, 2)]))

  // Every store, with the first marker.
  const made = await gm.evaluate(async ({ first, sceneId, PACK, PLAYER }) => {
    const out = {}
    const note = (k, f) => f().then(v => { out[k] = typeof v === 'string' ? v : 'ok' }).catch(e => { out[k] = `ERROR ${e.message}` })
    await note('player', async () => { await foundry.documents.User.create({ name: PLAYER, role: 1 }) })
    await note('sceneFlag', () => game.scenes.get(sceneId).setFlag('linemap', 'secret', first.sceneFlag))
    await note('journalNone', async () => {
      const j = await foundry.documents.JournalEntry.create({ name: '[linemap-probe] secret journal', ownership: { default: 0 }, flags: { linemap: { secret: first.journalNone } } })
      return j.id
    })
    await note('journalPageNone', async () => {
      const j = await foundry.documents.JournalEntry.create({ name: '[linemap-probe] page journal', ownership: { default: 2 } })
      await j.createEmbeddedDocuments('JournalEntryPage', [{ name: 'secret page', type: 'text', ownership: { default: 0 }, text: { content: first.journalPageNone } }])
      return j.id
    })
    await note('macroNone', async () => (await foundry.documents.Macro.create({ name: '[linemap-probe] secret macro', type: 'script', ownership: { default: 0 }, command: `// ${first.macroNone}` })).id)
    await note('worldSetting', async () => {
      game.settings.register('linemap', 'probeSecret', { scope: 'world', config: false, type: String, default: '' })
      await game.settings.set('linemap', 'probeSecret', first.worldSetting)
    })
    await note('userSettingGM', async () => {
      game.settings.register('linemap', 'probeUserSecret', { scope: 'user', config: false, type: String, default: '' })
      await game.settings.set('linemap', 'probeUserSecret', first.userSettingGM)
    })
    await note('userFlagGM', () => game.user.setFlag('linemap', 'secret', first.userFlagGM))
    await note('actorNone', async () => {
      const type = Object.keys(CONFIG.Actor.dataModels ?? {})[0] ?? game.documentTypes?.Actor?.find(t => t !== 'base') ?? 'base'
      return (await foundry.documents.Actor.create({ name: '[linemap-probe] secret actor', type, ownership: { default: 0 }, flags: { linemap: { secret: first.actorNone } } })).id
    })
    await note('packNone', async () => {
      let pack = game.packs.get(`world.${PACK}`)
      if (!pack) pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ name: PACK, label: '[linemap-probe] secrets', type: 'JournalEntry' })
      await pack.configure({ ownership: { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER' }, locked: false })
      const j = await foundry.documents.JournalEntry.create({ name: 'secret in pack', flags: { linemap: { secret: first.packNone } } }, { pack: pack.collection })
      return j.id
    })
    return out
  }, { first, sceneId, PACK, PLAYER })
  console.log(`  note  made: ${JSON.stringify(made)}`)
  p.cleanup(() => gm.evaluate(async ({ PACK, PLAYER, made }) => {
    for (const id of [made.journalNone, made.journalPageNone]) await game.journal.get(id)?.delete()
    await game.macros.get(made.macroNone)?.delete()
    await game.actors.get(made.actorNone)?.delete()
    await game.user.unsetFlag('linemap', 'secret')
    await game.settings.storage.get('world').getSetting('linemap.probeSecret')?.delete()
    for (const st of game.settings.storage.get('world').filter?.(x => x.key === 'linemap.probeUserSecret') ?? []) await st.delete()
    await game.packs.get(`world.${PACK}`)?.deleteCompendium()
    await game.users.getName(PLAYER)?.delete()
  }, { PACK, PLAYER, made }))

  // The player joins after every store holds its first marker.
  const player = await p.pageAs(PLAYER)
  const who = await player.evaluate(({ made, PACK }) => ({
    name: game.user.name, role: game.user.role, isGM: game.user.isGM,
    journalVisible: game.journal.get(made.journalNone)?.visible ?? 'absent',
    journalInCollection: !!game.journal.get(made.journalNone),
    actorInCollection: !!game.actors.get(made.actorNone),
    macroInCollection: !!game.macros.get(made.macroNone),
    packVisible: game.packs.get(`world.${PACK}`)?.visible ?? 'absent',
    packOwnership: game.packs.get(`world.${PACK}`)?.ownership,
    packTestUser: game.packs.get(`world.${PACK}`)?.testUserPermission?.(game.user, 'OBSERVER')
  }), { made, PACK })
  console.log(`  note  the player page: ${JSON.stringify(who)}`)
  p.check(!who.isGM && who.role === 1, 'the second page is a plain player', who)
  const frames = []
  player.on('websocket', ws => ws.on('framereceived', f => frames.push(String(f.payload))))
  // Playwright only reports sockets opened after the listener: Foundry's is open by now, so hear
  // every incoming event through socket.io's own onAny.
  await player.evaluate(() => {
    globalThis.__lmFrames = []
    game.socket.onAny((event, ...args) => { try { globalThis.__lmFrames.push(JSON.stringify([event, args])) } catch { globalThis.__lmFrames.push(String(event)) } })
  })
  const held = await player.evaluate(async ({ first }) => {
    const blobs = []
    try { blobs.push(JSON.stringify(game.data)) } catch (e) { blobs.push(`game.data unreadable ${e.message}`) }
    for (const c of game.collections.values()) { try { blobs.push(JSON.stringify(c.contents.map(d => d.toObject()))) } catch {} }
    try { blobs.push(JSON.stringify([...game.settings.storage.get('world').values()].map(s => s.toObject?.() ?? s))) } catch {}
    const packs = {}
    for (const pack of game.packs) {
      if (!pack.collection.startsWith('world.')) continue
      try { blobs.push(JSON.stringify([...pack.index.values()])) } catch {}
      try {
        const docs = await pack.getDocuments()
        packs[pack.collection] = `read ${docs.length} documents`
        blobs.push(JSON.stringify(docs.map(d => d.toObject())))
      } catch (e) { packs[pack.collection] = `refused: ${e.message.slice(0, 120)}` }
    }
    const all = blobs.join('\n')
    return { found: Object.fromEntries(Object.entries(first).map(([k, m]) => [k, all.includes(m)])), packs, bytes: all.length }
  }, { first })
  console.log(`  note  player's packs: ${JSON.stringify(held.packs)} (searched ${held.bytes} bytes)`)
  for (const s of STORES) p.check(!held.found[s], `${s}: the player's client does not hold it at join`, held.found[s])

  // The Gamemaster updates every store with the second marker, while the player listens.
  await gm.evaluate(async ({ second, sceneId, PACK, made }) => {
    const tryIt = (f) => f().catch(e => console.warn('probe update', e.message))
    await tryIt(() => game.scenes.get(sceneId).setFlag('linemap', 'secret', second.sceneFlag))
    await tryIt(() => game.journal.get(made.journalNone).setFlag('linemap', 'secret', second.journalNone))
    await tryIt(async () => {
      const j = game.journal.get(made.journalPageNone)
      await j.pages.contents[0].update({ 'text.content': second.journalPageNone })
    })
    await tryIt(() => game.macros.get(made.macroNone).update({ command: `// ${second.macroNone}` }))
    await tryIt(() => game.settings.set('linemap', 'probeSecret', second.worldSetting))
    await tryIt(() => game.settings.set('linemap', 'probeUserSecret', second.userSettingGM))
    await tryIt(() => game.user.setFlag('linemap', 'secret', second.userFlagGM))
    await tryIt(() => game.actors.get(made.actorNone).setFlag('linemap', 'secret', second.actorNone))
    await tryIt(async () => {
      const pack = game.packs.get(`world.${PACK}`)
      const doc = await pack.getDocument(made.packNone)
      await doc.setFlag('linemap', 'secret', second.packNone)
    })
  }, { second, sceneId, PACK, made })
  await player.waitForTimeout(scaled(3000))
  const heard = await player.evaluate(({ second }) => {
    const all = (globalThis.__lmFrames ?? []).join('\n')
    return { found: Object.fromEntries(Object.entries(second).map(([k, m]) => [k, all.includes(m)])), frames: globalThis.__lmFrames?.length ?? 0 }
  }, { second })
  const raw = frames.join('\n')
  console.log(`  note  socket events seen by the player during the updates: ${heard.frames}; raw frames: ${frames.length}`)
  for (const s of STORES) p.check(!heard.found[s] && !raw.includes(second[s]), `${s}: no update of it reaches the player's socket`, { event: heard.found[s], raw: raw.includes(second[s]) })
} catch (err) {
  await p.threw(err)
}
await p.finish()
