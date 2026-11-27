# Roadmap

What this fork of Tero Parvinen's Line Map intends to build, in order, and what it has set aside.
It is written so that a reader of the code can tell a deliberate choice from an accident, and a
review of the code reads it as the record of intent. `CHANGELOG.md` records what has shipped.

Decided on 2026-11-25, and reordered the same day: a second review first, then real hiding and
new features, then the play-utility and editing items of the first plan.

## Decisions

- **Foundry VTT 14 only.** The manifest requires 14. The one code path kept for 13 alone, the
  `-=` form of deleting a key, is gone: 14's `ForcedDeletion` is the only form. The fork has
  nowhere to test 13, so it promises nothing for it.
- **The order:** a Foundry review, real hiding, curved lines, sizes, images in the map, themes,
  then the rest. Real hiding was researched first, since images and document links would have
  hidden through it; it was set aside, so they hide on screen like everything else. Two items of the first plan are folded into new ones: per-object size into *Sizes*, and the
  halo into *Themes*.
- **Every feature starts as a probe.** A probe in `tools/dev/` states the feature's behaviour and
  fails before the feature exists. The feature is done when the probe passes on every Foundry 14
  build the probes run against, so the probe is the specification. A feature also gets a changelog
  line, and a README section when it is something a user does. A review finding is fixed the
  same way.
- **The save format stays per-object**: `flags.linemap.objects.<id>` and `flags.linemap.map`. A
  new field on an object is written as `null` when unset, never left out, because a save merges
  into what is there. A new look-affecting property goes into the object's draw key, or the cached
  display stays stale.
- **Edits go through the undo record.** A new edit path calls `registerHistory()`, `addObject` or
  `deleteObjects`, never a save of its own.

## Done

- **Any content colour.** The scene settings take a colour instead of the black-or-white toggle,
  and the selection colour follows from it. A scene saved with the old `isLightMode` still reads
  as black or white. Probe: set a colour; a symbol's tint, a line's stroke and a label's fill match
  it, for a player too, and after a reload.

## 1. A second Foundry review

The whole module read against Foundry 14's documentation, as the first review was. Each confirmed
finding is fixed probe-first. The colour and these fixes can make a release on their own.

## 2. Real hiding: set aside (the gate failed)

Researched on 2026-11-25 and set aside: see *Set aside*. Hiding stays as it is, on screen only.

## 3. Curved lines and a dotted style

*Done on `dev`* (probe `dev:curves`).

- A **Freehand** toggle in the line tool's options. A drag records points, simplified on release
  (Ramer–Douglas–Peucker, about 4 px). Lines already hold any number of points, so the format
  needs only `smooth: true`, `null` when unset. A smooth line is drawn as a Catmull–Rom curve.
- Only a line's two ends snap and link.
- A **dotted** line style draws round dots along the path, as Foundry's own dotted stroke does.

Probe: a freehand drag makes one line with many points and its ends linked to symbols; its pixels
follow the curve, not the straight chord; the dotted style leaves gaps; it survives a reload and
an undo.

## 4. Sizes

*Done on `dev`* (probe `dev:sizes`).

- A symbol or waypoint has its own `size`, 1 to 4, `null` meaning 1, multiplying the scene's
  symbol scale. A label has a `size` too, 0.5 to 4.
- Set from the right-click menu with a slider, and with `[` and `]` on the selection, through the
  undo record.
- A symbol's texture is rasterised at the largest size in use, so a big symbol stays sharp. Its
  footprint, selection box, snap radius and label offset all scale with it.
- Free-floating text already exists: the text tool on empty canvas makes an unlinked label. It
  stays in Line Map rather than in Foundry's drawing tools because it shares the map's colour,
  font, hiding and halo.

Probe: a symbol at size 4 is four times as wide in pixels and sharp (its edge pixels opaque, not
blurred); its links still meet it; it survives a reload; undo restores it.

## 5. Images in the map

*Done on `dev`* (probe `dev:images`).

Foundry 14 draws tiles above the map at the same elevation, so an image meant to lie under the
map's lines and symbols has to be drawn by the map itself.

- A new object type, **image**: `src`, `rect`, `rotation`, `isRevealed`, `sort`. Images are drawn
  untinted, below areas.
- An **image tool** (hotkey G; I is already italic labels) opens Foundry's file picker and places
  the image at the click.
- The select tool moves an image; the adjust tool resizes it by its corners, keeping the aspect
  ratio with shift.
- The right-click menu has **Fit to scene**, so one image can be the map's background, and order
  controls (bring forward, send back).
- Images hide and reveal like other objects (on screen only), and follow a scene resize.
- Foundry's own scene background still works under the map.

Probe: two images placed and resized, their pixels where expected and under a line's pixels;
a hidden one not drawn for a player; they survive a reload; a missing file does not break the map.

## 6. Themes, with the halo

- **The halo comes first:** a contrasting outline behind symbols and labels, on or off per scene,
  with its own colour. It is needed once images sit behind the map. The footprint shapes, which
  already keep lines out of a symbol's gaps, are the natural source of a symbol's halo. Probe:
  with the halo on, the pixels just outside a symbol's stroke and a label's glyphs are the halo
  colour; with it off they are the background. *Done on `dev`* (probe `dev:halo`).
- **A theme** is a preset shipped with the module. It sets the colour, label font, halo,
  background images, a symbol set and line styles. Applying one in the scene settings sets those
  values, which stay editable afterwards.
- **Symbol sets** get namespaced keys (`scifi:starport`), and the symbol tool shows the scene's
  theme's set.
- **Fantasy:** today's symbols, a parchment background, IM Fell English, dark brown.
- **Sci-fi:** symbols from game-icons.net (station, planet, starport, asteroid field, derelict,
  jump gate), a starfield background, an OFL sci-fi font shipped as Alegreya is, and lane and jump
  line styles built on the existing line classes.
- **Licences:** game-icons.net art is CC BY 3.0, so each icon's author is credited in the theme's
  `CREDITS.md` and in the README. Backgrounds are written for the module or supplied by the
  maintainer.

Probe: applying each theme changes the colour, font and background pixels; the sci-fi symbols draw
and link; a map made in one theme still loads after switching to the other. *Done on `dev`* (probe
`dev:themes`): themes are `CONFIG.linemap.themes` entries, so another package can add one; a theme's
background is an image object fitted to the Scene, under the map.

## 7. Play utility and editing

The first plan's remaining items, in its order. The map is a point crawl, so its points should
lead somewhere; the editing items are independent conveniences.

1. **A scripting API.** `game.modules.get("linemap").api` reads a scene's objects and adds,
   updates, deletes, reveals and hides them, through the same undo record as the tools. Hooks
   announce the layer being ready and objects changing. Upstream's issue #1 asked for a way to do
   this from a macro. Probe: a macro-style call creates an object the tools can see, and undo
   removes it. *Done on `dev`* (probe `dev:api`).
2. **Document links.** A symbol, waypoint or label can hold the UUID of a document, set by the
   Gamemaster from the right-click menu or by dropping the document from the sidebar onto the
   object. A player who may see the document gets a cue on the object (a pointer cursor and the
   document's name as a tooltip) and opens it with a click. A hidden object, or a document the
   player cannot see, shows nothing. **Decided (2026-11-26): like core's map notes.** A handler on
   the stage hit-tests the map's linked objects on every layer but Line Map's own (where the tools
   own the pointer): hovering shows the cue and a double-click opens, so a single click still goes
   to tokens, and the players' map-notes toggle turns it off. A read-only control for players, and a
   single click on any layer, were the alternatives set aside. Probe: a Gamemaster links a journal
   page; a player client sees the cue, double-clicks, and the page's sheet opens; the same object
   hidden shows no cue. *Done on `dev`* (probe `dev:links`).
3. **Hover tooltips** for every labelled object, not only linked ones: the label's text, so a
   crowded map can be read. Comes with 2, since it shares the hover path. *Done on `dev`* (in probe `dev:links`): symbols, waypoints and lines
   show their labels' text; the pointer cue stays for objects with a document.
4. **Travel routes.** With two symbols selected, the route along linked lines with the fewest
   waypoints is highlighted and its count shown, since waypoints mark days of travel. Probe: a
   three-symbol map with two routes of different length picks the shorter. *Done on `dev`* (probe
   `dev:routes`): waypoints can be the ends too, ties go to the shorter route, a line ending on
   another branches there, and `api.route` gives the route to macros.
5. **Change an existing object's look.** The right-click menu changes a line's style, a symbol's
   kind, a waypoint's kind and an area's pattern, instead of deleting and redrawing. Probe: a line
   changes from major to rough and keeps its points and links. *Done on `dev`* (probe `dev:look`): a
   row under the menu, for a selection all of one kind, with the theme's choices; several objects
   change as one edit.
6. **Redo.** Undo keeps the undone edits for redo until a new edit is made. Probe: undo, redo, and
   the object is back; undo, edit, and redo does nothing. *Done on `dev`* (probe `dev:redo`): Ctrl+Y
   and Ctrl+Shift+Z (core has no redo key), and `api.redo()`.
7. **Duplicate, copy and paste.** A selection is copied with the links among the copied objects
   and without links to objects outside it, and can be pasted into another scene. Probe: two
   linked objects copied to a second scene are linked there, with new ids. *Done on `dev`* (probe
   `dev:copy`): core's Ctrl+C, Ctrl+X and Ctrl+V, paste at the pointer, and Duplicate in the menu.
8. **Nudge.** The arrow keys move the selection a pixel, ten with shift, and linked objects
   follow. Probe: one press moves a symbol by one pixel, and the line linked to it. *Done on `dev`*
   (probe `dev:nudge`): the select tool's drag move, a run of presses saved as one edit, and the
   keys left to core's panning when nothing is selected.

Step 7 is done on `dev` (2026-11-26).

Added afterwards, on request: a **rotation slider for labels** in the right-click menu (probe
`dev:rotate`), since a label could only take a line's direction before; and **line thickness**
through the size slider (probe `dev:thick`), every style scaled as a whole; and **per-object
colours** from a row in the right-click menu (probe `dev:colors`), null following the scene's colour;
and **area resizing** from an area size slider and ] and [ (probe `dev:areasize`), which scales an area's
points around its middle, since an area has no size of its own; and a **solid area fill** with a
fill opacity slider for any pattern (probe `dev:solid`); **bring to front and send to back** within
an object's layer (probe `dev:order`), symbols drawn in runs of one colour so their stacking holds;
**areas over lines** (probe `dev:over`); and a **Layers window** that hides or locks a layer for the
user editing, kept in a client setting (probe `dev:groups`); a **Terminal theme** with the VT323
label font, for a retro computer-terminal look (probe `dev:terminal`); and **Export map**: the
scene or a dragged area as PNG, WebP or PDF through the print dialog, drawn afresh at 1×, 2× or 4×
(probe `dev:export`).

## Set aside

- **Real hiding.** A hidden object is hidden on screen only: a player's client receives it in the
  Scene's flags. Real hiding needs a store that a player's client never receives, and Foundry 14
  has none a module can use. A probe on Foundry 14.370 (2026-11-25) had a Gamemaster put a marker in
  nine stores and a player search everything their client held, and every update it was sent: a
  Scene flag; a journal entry, a journal page, a macro and an actor with no player permission; a world
  setting; a Gamemaster's user-scoped setting and user flags; and a world compendium closed to
  players. The marker reached the player from every one, at joining and live. Foundry hides a
  document the player may not see (its `visible` is false) but sends it, and the player could read
  the closed compendium's documents too. Keeping data from players needs a server, which a module
  does not have. Images and document links (step 5, step 7.2) hide on screen like every other object.
- **A map per level.** There is one map per Scene, drawn on every level above the viewed level's
  background. Not planned until a map needs it.
- **Export and import.** Likely to fall out of copy and paste, a selection serialised to the
  clipboard. An export in upstream's format, for a map that has to go back, is not planned.
- **Custom symbol sets from files.** Upstream's author calls this a different module. Themes ship
  their own sets inside the module; loading a set from a user's files is still not planned. A map
  that holds an unknown symbol already loads and keeps it as it was.
