# Changelog

Release notes for this fork of Tero Parvinen's Line Map. `npm run release X.Y.Z` reads the
`## X.Y.Z` section below and publishes it as the release's notes, so write it before releasing.
Earlier versions are upstream's: see https://github.com/teroparvinen/foundry-linemap/releases.

## Unreleased

- **Images in the map.** A new image tool (hotkey G) places a picture from Foundry's file picker,
  drawn under the map's lines, symbols and labels in its own colors. Images move with the select
  tool, resize by their corners with the adjust tool (Shift keeps their proportions), and can be
  fitted to the scene, brought forward or sent back from the right-click menu. They hide and reveal
  like other objects. Earlier versions keep a map's images but do not draw them.
- **Sizes.** A symbol or waypoint can be drawn up to four times its size, and a label from half to
  four times, set with a slider in the right-click menu or with ] and [. A big symbol is drawn
  sharp, and its footprint, selection box and snap radius grow with it; labels linked to it move
  out to stay clear. Earlier versions draw every object at its usual size.
- **Curved lines.** With Freehand on in the line tool's options bar, a drag draws a smooth curve
  along its path, in any line style; its ends link to symbols as a straight line's do, and
  waypoints and labels snap onto the curve. Earlier versions draw a curve as straight segments through its points.
- **A dotted line style.** Earlier versions draw a dotted line as a major path.
- The map can be drawn in any color, picked in the scene settings, instead of only black or white.
  A map saved before keeps its black or white, and earlier versions of the module still draw a
  recolored map in the nearer of the two.
- Requires Foundry VTT 14. This fork never tested version 13, and the one code path kept for it
  (the `-=` form of deleting a key) is gone.
- `ROADMAP.md` records what the fork intends to build, in order, and what it has set aside.
- A map saved in the old format is moved to the new one when a Gamemaster first views it, instead
  of at its first edit, so two Gamemasters editing it for the first time at the same moment no
  longer undo each other's edit. Viewing such a map as a Gamemaster is enough to make it unreadable
  for upstream Line Map and versions before 0.14.0.
- Settings picked on a scene before anything is drawn on it are kept. They were lost on a reload,
  and other players' and Gamemasters' screens showed an error instead of taking them.
- An undo, or a delete, made straight after the edit before it no longer goes missing on the
  server: the map looked right, but other screens and a reload still had the edit.
- Two Gamemasters editing the same object at the same moment end up seeing the same result.
- A delete and an edit of the same object by two Gamemasters at once no longer leave a broken entry
  in the scene; broken entries already there are ignored and removed by the next save.
- A line linked to an object this version does not know keeps the link when it is edited.
- If a change cannot be saved, a message says so and the map shows what the scene holds.
- After the scene or level changes, or the canvas is redrawn, the selected tool works again: its
  keys (R, H, D, B, I), its options bar, and dragging a label.
- Switching tools quickly no longer leaves an options bar on screen.
- Switching tools in the middle of a drag cancels the drag, instead of throwing errors or moving and
  saving other objects.
- Another Gamemaster's save during a drag, or while a label is being edited, no longer loses the
  drag or the new text.
- Escape closes the right-click menu instead of opening Foundry's main menu, and so does a click on
  the map; a menu left behind under no pointer closes when the pointer moves on.
- The scene settings window follows the scene being viewed: left open, it wrote the previous
  scene's settings into the next one, or over another Gamemaster's change.
- Line Map's keys are Gamemaster-only, so players' Configure Controls no longer lists them.
- Every choice in the tools' options bars has a name, shown as a tooltip and read by screen
  readers; the Line Map control's name can be translated, and the "delete all" question has a title.
- Scenes with no map no longer reserve graphics memory for one, and a map on a scene too large for
  the graphics card is drawn at a lower resolution instead of not at all.
- On a slow connection, symbols no longer go missing from the map until a Gamemaster edits it.
- The module loads less: it no longer downloads its icons twice, and its scripts are a quarter of
  their former size.
- The README explains how to install and update this fork (by its manifest URL, not Foundry's
  Update buttons) and lists the keys.

## 0.14.0

- Verified on Foundry VTT 14.
- The manifest and download links point at this fork's releases.
- Labels use Alegreya, shipped with the module, with IM Fell English as a per-scene choice in the
  scene settings. The font named before was never loaded, so labels looked different on each computer.
- Hidden labels are no longer shown to players.
- Fixed slowdowns and graphics memory growing the longer a map was edited.
- The "adjusting linked points preserves links" button works again, and the N key only acts on the
  Line Map layer.
- Line Map stays the active layer when the canvas redraws, and a tool's options bar no longer stays
  on screen after leaving the layer.
- A scene without a map starts from the default colour, scale and font instead of the previous
  scene's.
- Double-clicking anything but a label no longer throws an error.
- **Maps are saved in a new format**: each object under its own key in the scene's flags, so two
  Gamemasters editing at the same moment no longer lose one of the edits. An existing map is moved to
  the new format the first time it is edited, and can then no longer be read by upstream Line Map or
  by earlier versions of this fork.
- Undo takes back one edit at a time (a new label took two presses, and quick edits merged), and only
  your own: it no longer removes what another Gamemaster drew meanwhile.
- Deleting a symbol or line leaves whatever was linked to it where it is; linked ends used to jump back
  to where they were first drawn after a reload.
- Resizing a scene from its configuration moves the map with the background, as Foundry moves tokens
  and tiles.
- On a raised scene level, the map is drawn above that level's background instead of under it.
- A map holding an object, symbol or line style this version does not know still loads; the unknown
  entry is kept as it was saved.
- Dragging on a large map is faster.
- With shift, the adjust tool adds a point to an empty selection and never adds one twice.
- The right-click menu names its two options for tooltips and screen readers.
- The text typed for a label is no longer written to the browser console.
- The Line Map control sits after Foundry's own controls, and its keys no longer throw errors when
  the game canvas is turned off.
