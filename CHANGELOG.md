# Changelog

Release notes for this fork of Tero Parvinen's Line Map. `npm run release X.Y.Z` reads the
`## X.Y.Z` section below and publishes it as the release's notes, so write it before releasing.
Earlier versions are upstream's: see https://github.com/teroparvinen/foundry-linemap/releases.

## Unreleased

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
