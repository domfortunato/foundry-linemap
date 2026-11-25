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
- **Ctrl+Z:** undo your own last edit, one edit at a time

## Other settings

Access other scene specific settings using the settings layer control button.

- Change the icon scale from 100% to 200% to represent lower or higher levels of scale detail
- Pick the content color, any color, for contrast with the scene background. Selected objects show
  in Foundry's selection color, or in the content color's opposite when the two are close
- Choose the label font: Alegreya (the default) or IM Fell English

## Fonts

The label fonts ship with the module, each under the SIL Open Font License 1.1, with its licence
beside it in `assets/fonts/`:

- **Alegreya**, copyright 2011 The Alegreya Project Authors
  (https://github.com/huertatipografica/Alegreya), compressed to WOFF2 from the Google Fonts release.
- **IM Fell English**, copyright 2010 Igino Marini (www.iginomarini.com), the Google Fonts files
  unmodified.
