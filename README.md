# Linemap for the Foundry VTT

This module allows you to draw line and symbol based maps (point crawls) as inspired by the Grimwild RPG.

It requires Foundry VTT 14. `ROADMAP.md` lists what this fork plans to build next, and
`CHANGELOG.md` what each release changed.

## Installing and updating

This fork shares its package id, `linemap`, with Tero Parvinen's original, which is the one listed
on Foundry's package website. Install the fork from its manifest URL:

    https://github.com/domfortunato/foundry-linemap/releases/latest/download/module.json

Foundry checks for updates against its package website, so its update buttons may not offer this
fork's releases, and could offer the original's instead. **Do not update Line Map with "Update" or
"Update All"**: install the fork's manifest URL again to update. The original cannot read a map
this fork has saved, so such a map would look empty under it.

## Drawings

The different object types available are:

- **Lines (hotkey L):** Various line types to indicate paths, rivers or other routes
- **Symbols (hotkey S):** Symbols to indicate towns, sites, dangers, curiosities and other point features
- **Waypoints (hotkey W):** Symbols that can only be attached to lines, to mark days of travel, portals and elevation changes
- **Areas (hotkey P):** Larger geographic areas like lakes
- **Text (hotkey T):** Labels to help you remember
- **Images (hotkey G):** Pictures drawn inside the map, under its lines, symbols and labels

### Curved lines

Turn on **Freehand** (the signature button at the end of the line tool's options bar) and drag:
the line follows the path of the drag as a smooth curve. Its two ends snap and link like a
straight line's, so a curve between two symbols follows them when they move, and waypoints and
labels snap onto the curve itself. Every line style can be drawn curved, including the **dotted**
style.

## Snapping and object linking

When using the drawing tools, most objects snap to each other and form a link, allowing you to reposition elements and have the connected paths, symbols and waypoints automatically adjust their position.

To break these links, toggle the **Adjusting linked points preserves links** option in the layer control buttons. It works for both the select and adjust tools, slightly differently. Experiment to find the exact workflow and don't forget the tool hotkeys to quickly move between the available tools.

## Hiding and revealing objects

All drawing objects are visible to players by default. As the GM, you can select to hide and reveal objects during play. To make new objects appear hidden, toggle the **Created objects are revealed** option in the layer control buttons. Objects can be toggled by either selecting them with the select tool (shift select or area select to select multiple) and either using the context menu (right mouse button) or using the hotkeys **R** (to reveal) and **H** (to hide).

## Document links

A symbol, waypoint or label can open a document: a journal entry or page, a scene, an actor, or
anything else with a sheet. Link one by dropping the document from the sidebar onto the object
while the Line Map tools are active, or by choosing **Link document** in the object's right-click
menu and pasting the document's UUID (copy it from the sheet's header). **Unlink document** in the
same menu removes the link.

On the map, linked objects work like Foundry's map notes, on any layer: hovering one shows a
pointer and the document's name, and a double-click opens it (a journal at the linked page, a
scene by viewing it). Players see this only for revealed objects and for documents they may see,
and not while they have map notes turned off.

Hovering a symbol, waypoint or line that has labels also shows their text, so a crowded or
zoomed-out map can still be read. Hidden labels are left out for players.

## Object details

### Text offset and orientation

Text objects that are linked to another object have two adjustment points. One is the point where they attach to the other object and another is the offset that makes the text not lie on top of the object it is labeling. These can be adjusted individually using the adjust tool (hotkey A). Text snapped to a line will orient itself to the line's direction.

To detach text from an object, deselect the preserve links option and move the text object using the select tool (hotkey V). To attach a separated text to an object, use the adjustment tool to snap the single adjustment handle to the target object.

### Editing text

Double click on a text object using the select tool to edit the text content. Shift-enter will insert a new line in the text editing dialog.

### Manipulating areas

Areas are created as rectangles, but can be freely shaped using the adjust tool (hotkey A) and moving the adjustment points around. To add or remove adjustment points, switch to the area tool (hotkey P) and double click on a line or point to add or delete one.

### Images

Pick the image tool (hotkey G) and click where the picture should go: Foundry's file picker opens,
and the picked image is placed centred on the click at its own size. Images are drawn under the
map's areas, lines, symbols and labels, in their own colors, so a hand-drawn map or a texture can
sit beneath the point crawl. (A tile can't do this: Foundry draws tiles above the map.)

- Move an image with the select tool (hotkey V), and resize it by its corners with the adjust tool
  (hotkey A). Hold **Shift** while resizing to keep its proportions.
- The right-click menu on a selected image has **Fit to scene**, which makes the image cover the
  whole scene so it can be the map's background, and **Bring forward** and **Send back** to order
  images that overlap.
- Images hide and reveal like every other object, and move with the map when the scene is resized.
- If an image's file goes missing, the rest of the map still draws, and the Gamemaster sees a
  crossed-out outline where the image was, to select and delete.

### Sizes

Each symbol and waypoint can be drawn from one to four times its usual size, and each label from
half to four times. Select them with the select tool (hotkey V) and use the size slider in the
right-click menu, or press **]** and **[** to grow and shrink them half a size at a time. A big
symbol stays sharp, lines still meet its edge, it is as easy to link to, and the labels linked to
it move out to stay clear of it. The scene's icon scale (see *Other settings*) multiplies every
symbol's size.

### Changing a look

To give an object another look without redrawing it, select it with the select tool (hotkey V) and
right-click: under the menu is a row with a line's styles, a symbol's kinds, a waypoint's kinds or
an area's patterns, the current one marked. Pick another and the object changes in place, keeping
its points, its links and everything linked to it, so a road can become a rough path and keep its
waypoints and name. Several objects of one kind change together, as one edit for undo; a selection
of mixed kinds has no row. The row offers what the drawing tools offer for the scene's theme.

### Copying and pasting

Select objects with the select tool (hotkey V) and press **Ctrl+C** to copy them, or **Ctrl+X** to
cut them. **Ctrl+V** pastes them centred on the pointer, selected, ready to move: in the same scene,
or in another one, since the copy lasts until you reload. The links among the copied objects come
with them (a road still runs between its two towns, with its waypoints and names), and a point that
was linked to something left behind is pinned where it was. **Duplicate** in the right-click menu
copies the selection beside itself in one step. Pasted objects keep whether they were hidden, and
one undo takes a paste back.

### Flipping waypoints

Some waypoints are directional. You can flip their direction by selecting the waypoint using the select tool (hotkey V) and pressing **D**.

## Keys

Each key acts only while the Line Map layer is active, and each can be changed in Configure
Controls.

- **V, A, L, S, W, P, T, G:** the select, adjust, line, symbol, waypoint, area, text and image tools
- **R and H:** reveal and hide the selected objects (select tool)
- **D:** flip the selected waypoints (select tool)
- **B and I:** bold and italic for the selected label (text tool)
- **] and [:** make the selected symbols, waypoints and labels bigger and smaller (select and text tools)
- **N:** toggle whether adjusting linked points preserves links
- **Delete or Backspace:** delete the selected objects
- **Ctrl+C, Ctrl+X and Ctrl+V:** copy, cut and paste the selected objects (paste puts them at the pointer)
- **Ctrl+Z:** undo your own last edit, one edit at a time
- **Ctrl+Y or Ctrl+Shift+Z:** redo what you undid, until you make a new edit (leaving the layer
  forgets both)

## Themes

The scene settings offer two themes. Picking one sets the map's color, label font, halo and a
background picture covering the scene, and picks the symbols and lines the drawing tools offer.
Everything a theme sets can still be changed afterwards, and switching themes replaces its
background picture rather than adding another. A map keeps whatever it has drawn: symbols from
one theme still show after switching to the other.

- **Fantasy:** the classic symbols and paths, dark brown on parchment, labels in IM Fell English.
- **Sci-fi:** stations, planets, starports, asteroid fields, jump gates and derelicts, joined by
  lanes and jumps; pale blue on a starfield, labels in Orbitron.

A map with no theme offers the fantasy symbols and paths.

## Other settings

Access other scene specific settings using the settings layer control button.

- Change the icon scale from 100% to 200% to represent lower or higher levels of scale detail
- Pick the content color, any color, for contrast with the scene background. Selected objects show
  in Foundry's selection color, or in the content color's opposite when the two are close
- Choose the label font: Alegreya (the default), IM Fell English or Orbitron
- Turn on the halo: an outline behind symbols, waypoints and labels that sets them apart from an
  image or a busy scene background under the map. It is the content color's opposite (white for a
  dark map) until you pick another color beside the switch. A symbol's halo also fills its gaps

## Travel routes

Waypoints mark days of travel. With the select tool, select two symbols or waypoints (shift-click
the second): the route between them along linked lines that passes the fewest waypoints is
highlighted in the selection color, with its count ("3 waypoints"). Of routes with as many
waypoints, the shorter is shown. Lines join where their ends are linked: to a symbol, to a waypoint,
or to a point along another line, which then branches there. Two symbols with no linked lines
between them say "No route".

The route shows only on your screen, while the Line Map tools are active, and follows the map as you
edit it. It is never saved. Hidden objects count, since only the Gamemaster can select.

## Scripting

Macros and other modules reach the map through `game.modules.get("linemap").api`. Editing needs a
user who may update the scene (a Gamemaster); anything the module cannot draw is refused before
anything is saved.

```js
const api = game.modules.get("linemap").api;
// Two settlements, a road between them, a name and a waypoint halfway.
const [town, keep] = await api.add([
  api.symbol({ x: 600, y: 900, symbol: "major-settlement" }),
  api.symbol({ x: 1400, y: 900, symbol: "minor-site", size: 2 })
]);
const [road] = await api.add(api.line({ from: town, to: keep, style: "minor" }));
await api.add([api.label({ text: "Greyhaven", on: town }), api.waypoint({ line: road, t: 0.5 })]);
// Move the town (the road and the name follow), hide the keep, then take the hiding back.
await api.update({ id: town, point: { point: [600, 500] } });
await api.hide(keep);
await api.undo();
```

- **Reading:** `objects()` and `get(id)` return copies of the saved objects. `route(from, to)`
  finds the travel route between two symbols or waypoints by id: `{ waypoints, lines, length }`,
  the ids of the waypoints passed and of the lines travelled, in order, and its length in pixels, or
  null when no lines join them.
- **Editing:** `add(data)`, `update({ id, ...changes })`, `delete(ids)`, `hide(ids)`, `reveal(ids)` and
  `undo()` and `redo()`. On the scene being viewed, an edit is drawn at once and joins your undo record, so
  Ctrl+Z takes it back, even if the macro ran while another layer was active.
- **Other scenes:** pass `{ scene }` (a scene or its id) to read or edit a scene that is not being
  viewed. Its map is saved directly, with no undo.
- **Building:** `symbol`, `waypoint`, `line`, `label`, `area` and `image` make the data `add` takes.
  A line's `from` and `to`, a label's `on` and a waypoint's `line` take an object's id and link to
  it, so they follow it as it moves. Symbols are `CONFIG.linemap.symbols` keys, line styles
  `CONFIG.linemap.lineStyles` keys and patterns `CONFIG.linemap.patterns` keys.
- **Hooks:** `linemapReady` (layer, scene) when a scene's map has been drawn, and
  `linemapObjectsChanged` (scene, { changed, deleted, settings, userId }) whenever a map is saved,
  by the API, by the tools, or by another user.

## Fonts

The label fonts ship with the module, each under the SIL Open Font License 1.1, with its licence
beside it in `assets/fonts/`:

- **Alegreya**, copyright 2011 The Alegreya Project Authors
  (https://github.com/huertatipografica/Alegreya), compressed to WOFF2 from the Google Fonts release.
- **IM Fell English**, copyright 2010 Igino Marini (www.iginomarini.com), the Google Fonts files
  unmodified.
- **Orbitron**, copyright 2018 The Orbitron Project Authors
  (https://github.com/theleagueof/orbitron), the Google Fonts file unmodified.

## Theme art

The sci-fi symbols are icons made by Lorc and Delapouite, available on https://game-icons.net,
under the Creative Commons Attribution 3.0 licence (https://creativecommons.org/licenses/by/3.0/).
Some are changed; `assets/themes/scifi/CREDITS.md` lists each icon, its author and the changes.
The starfield and the parchment were written for this module.
