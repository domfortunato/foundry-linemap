# Roadmap

What this fork of Tero Parvinen's Line Map intends to build, in order, and what it has set aside.
It is written so that a reader of the code can tell a deliberate choice from an accident, and a
review of the code reads it as the record of intent. `CHANGELOG.md` records what has shipped.

Decided on 2026-11-25.

## Decisions

- **Foundry VTT 14 only.** The manifest requires 14. The one code path kept for 13 alone, the
  `-=` form of deleting a key, is gone: 14's `ForcedDeletion` is the only form. The fork has
  nowhere to test 13, so it promises nothing for it.
- **Three directions, in this order:** legibility, play utility, editing. The data-integrity
  questions are set aside (see the end).
- **Every feature starts as a probe.** A probe in `tools/dev/` states the feature's behaviour and
  fails before the feature exists. The feature is done when the probe passes on every Foundry 14
  build the probes run against, so the probe is the specification. A feature also gets a changelog
  line, and a README section when it is something a user does.
- **The save format stays per-object**: `flags.linemap.objects.<id>` and `flags.linemap.map`. A
  new field on an object is written as `null` when unset, never left out, because a save merges
  into what is there. A new look-affecting property goes into the object's draw key, or the cached
  display stays stale.
- **Edits go through the undo record.** A new edit path calls `registerHistory()`, `addObject` or
  `deleteObjects`, never a save of its own.

## 1. Legibility

Prompted by upstream's issue #2: on a busy background the symbols are hard to read, and black or
white is the only choice.

1. **Any content colour.** The scene settings take a colour instead of the black-or-white toggle,
   and the selection colour follows from it. A scene saved with the old `isLightMode` still reads
   as black or white. Probe: set a colour; a symbol's tint, a line's stroke and a label's fill match
   it, for a player too, and after a reload.
2. **A halo behind symbols and labels.** A contrasting outline, on or off per scene, with its own
   colour. The footprint shapes, which already keep lines out of a symbol's gaps, are the natural
   source of a symbol's halo. Probe: with the halo on, the pixels just outside a symbol's stroke and
   a label's glyphs are the halo colour; with it off they are the background.

These two make a release on their own.

## 2. Play utility

The map is a point crawl, so its points should lead somewhere.

3. **A scripting API.** `game.modules.get("linemap").api` reads a scene's objects and adds,
   updates, deletes, reveals and hides them, through the same undo record as the tools. Hooks
   announce the layer being ready and objects changing. Upstream's issue #1 asked for a way to do
   this from a macro. Probe: a macro-style call creates an object the tools can see, and undo
   removes it.
4. **Document links.** A symbol, waypoint or label can hold the UUID of a document, set by the
   Gamemaster from the right-click menu or by dropping the document from the sidebar onto the
   object. A player who may see the document gets a cue on the object (a pointer cursor and the
   document's name as a tooltip) and opens it with a click. A hidden object, or a document the
   player cannot see, shows nothing. **To design first:** players have no Line Map tools, and the
   layer attaches its pointer handlers only while it is active, so a player's click must come
   either from a read-only Line Map control players can switch to, or from a handler on the stage
   that hit-tests the map's objects. Probe: a Gamemaster links a journal page; a player client sees
   the cue, clicks, and the page's sheet opens; the same object hidden shows no cue.
5. **Hover tooltips** for every labelled object, not only linked ones: the label's text, so a
   crowded map can be read. Comes with 4, since it shares the hover path.
6. **Travel routes.** With two symbols selected, the route along linked lines with the fewest
   waypoints is highlighted and its count shown, since waypoints mark days of travel. Probe: a
   three-symbol map with two routes of different length picks the shorter.

## 3. Editing

Independent conveniences; any of them may be pulled forward.

7. **Per-object size.** A symbol or waypoint can be scaled, and a label sized, on its own, from the
   right-click menu and by key. Saved as `null` when unset. Probe: scale one symbol and its sprite
   is twice as wide, still after a reload; undo restores it.
8. **Change an existing object's look.** The right-click menu changes a line's style, a symbol's
   kind, a waypoint's kind and an area's pattern, instead of deleting and redrawing. Probe: a line
   changes from major to rough and keeps its points and links.
9. **Redo.** Undo keeps the undone edits for redo until a new edit is made. Probe: undo, redo, and
   the object is back; undo, edit, and redo does nothing.
10. **Duplicate, copy and paste.** A selection is copied with the links among the copied objects
    and without links to objects outside it, and can be pasted into another scene. Probe: two
    linked objects copied to a second scene are linked there, with new ids.
11. **Nudge.** The arrow keys move the selection a pixel, ten with shift, and linked objects
    follow. Probe: one press moves a symbol by one pixel, and the line linked to it.

## Set aside

- **Real hiding.** Hidden objects are hidden only on screen: a player's client receives them in the
  Scene's flags. Keeping them in a document players cannot read would change where every object is
  stored and how undo works across two documents. Not planned now; the document-link cue respects
  hidden objects regardless.
- **A map per level.** There is one map per Scene, drawn on every level above the viewed level's
  background. Not planned until a map needs it.
- **Export and import.** Likely to fall out of copy and paste, a selection serialised to the
  clipboard. An export in upstream's format, for a map that has to go back, is not planned.
- **Custom symbol sets from files.** Upstream's author calls this a different module. A map that
  holds an unknown symbol already loads and keeps it as it was.
