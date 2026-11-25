# Changelog

Release notes for this fork of Tero Parvinen's Line Map. `npm run release X.Y.Z` reads the
`## X.Y.Z` section below and publishes it as the release's notes, so write it before releasing.
Earlier versions are upstream's: see https://github.com/teroparvinen/foundry-linemap/releases.

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
