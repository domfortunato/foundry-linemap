import { LineMapLayer } from "./linemap-layer.js";
import { Line } from "./objects/line.js";
import { Symbol } from "./objects/symbol.js";
import { Area } from "./objects/area.js";
import { Text } from "./objects/text.js";
import { SolidLine } from "./objects/line-styles/solid-line.js";
import { DashLine } from "./objects/line-styles/dash-line.js";
import { WaveLine } from "./objects/line-styles/wave-line.js";
import { BarrierLine } from "./objects/line-styles/barrier-line.js";
import { DotLine } from "./objects/line-styles/dot-line.js";
import { ToolHotkey } from "./classes/tool.js";
import { Waypoint } from "./objects/waypoint.js";
import { MapImage } from "./objects/image.js";

// Every keybinding is restricted: each is a Gamemaster's action, and players have no Line Map control.
Hooks.on("init", () => {
    CONFIG.Canvas.layers.linemap = { group: "primary", layerClass: LineMapLayer };
    Hooks.on("preUpdateScene", LineMapLayer.onPreUpdateScene);

    const selectTool = (tool: string) => {
        if (canvas.linemap?.active) {
            ui.controls.activate({ tool })
            return true;
        }
    }
    const sendHotkey = (key: ToolHotkey) => {
        if (canvas.linemap?.active) {
            canvas.linemap.hotkeyPressed(key);
            return true;
        }
    }

    game.keybindings.register("linemap", "selectTool", {
        restricted: true,
        name: "linemap.keybindings.selectTool",
        editable: [
            { key: "KeyV" }
        ],
        onDown: () => {
            return selectTool("selectObject");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "adjustTool", {
        restricted: true,
        name: "linemap.keybindings.adjustTool",
        editable: [
            { key: "KeyA" }
        ],
        onDown: () => {
            return selectTool("adjustObject");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawLineTool", {
        restricted: true,
        name: "linemap.keybindings.drawLineTool",
        editable: [
            { key: "KeyL" }
        ],
        onDown: () => {
            return selectTool("drawLine");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawSymbolTool", {
        restricted: true,
        name: "linemap.keybindings.drawSymbolTool",
        editable: [
            { key: "KeyS" }
        ],
        onDown: () => {
            return selectTool("drawSymbol");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawWaypointTool", {
        restricted: true,
        name: "linemap.keybindings.drawWaypointTool",
        editable: [
            { key: "KeyW" }
        ],
        onDown: () => {
            return selectTool("drawWaypoint");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawAreaTool", {
        restricted: true,
        name: "linemap.keybindings.drawAreaTool",
        editable: [
            { key: "KeyP" }
        ],
        onDown: () => {
            return selectTool("drawArea");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawTextTool", {
        restricted: true,
        name: "linemap.keybindings.drawTextTool",
        editable: [
            { key: "KeyT" }
        ],
        onDown: () => {
            return selectTool("drawText");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "drawImageTool", {
        restricted: true,
        name: "linemap.keybindings.drawImageTool",
        editable: [
            { key: "KeyG" }
        ],
        onDown: () => {
            return selectTool("drawImage");
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "revealObjects", {
        restricted: true,
        name: "linemap.keybindings.revealObjects",
        editable: [
            { key: "KeyR" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.reveal);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "hideObjects", {
        restricted: true,
        name: "linemap.keybindings.hideObjects",
        editable: [
            { key: "KeyH" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.hide);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "reverseWaypointDirection", {
        restricted: true,
        name: "linemap.keybindings.reverseWaypointDirection",
        editable: [
            { key: "KeyD" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.reverse);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "boldText", {
        restricted: true,
        name: "linemap.keybindings.boldText",
        editable: [
            { key: "KeyB" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.bold);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "italicText", {
        restricted: true,
        name: "linemap.keybindings.italicText",
        editable: [
            { key: "KeyI" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.italic);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "growObjects", {
        restricted: true,
        name: "linemap.keybindings.growObjects",
        editable: [
            { key: "BracketRight" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.grow);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "shrinkObjects", {
        restricted: true,
        name: "linemap.keybindings.shrinkObjects",
        editable: [
            { key: "BracketLeft" }
        ],
        onDown: () => {
            return sendHotkey(ToolHotkey.shrink);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "toggleLinked", {
        restricted: true,
        name: "linemap.keybindings.toggleLinked",
        editable: [
            { key: "KeyN" }
        ],
        onDown: () => {
            // Only on the Line Map layer, so N still reaches core and other packages elsewhere.
            if (!canvas.linemap?.active) return;
            // Through the toggle, so the button follows and its onChange sets adjustLinked
            // (ui.controls.initialize() is deprecated and never updated the button).
            ui.controls.activate({ toggles: { adjustLinked: !canvas.linemap.adjustLinked } });
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register("linemap", "deleteSelected", {
        restricted: true,
        name: "linemap.keybindings.deleteSelected",
        editable: [
            { key: "Delete" },
            { key: "Backspace" }
        ],
        onDown: (event: any) => {
            if (canvas.linemap?.active) {
                canvas.linemap._onDeleteKey(event);
                return true;
            }
        }
    });
    game.keybindings.register("linemap", "undo", {
        restricted: true,
        name: "KEYBINDINGS.Undo",
        uneditable: [
            { key: "KeyZ", modifiers: ["Control"] }
        ],
        onDown: (event: any) => {
            if (canvas.linemap?.active) {
                canvas.linemap.undo();
                return true;
            }
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    // Label fonts shipped with the module (SIL OFL 1.1, licences beside the files). Registered here
    // so Foundry loads them for every client before the canvas draws; `??=` leaves a definition
    // made by the world or another package alone.
    const fontPath = "modules/linemap/assets/fonts";
    CONFIG.fontDefinitions["Alegreya"] ??= {
        editor: false,
        fonts: [
            { urls: [`${fontPath}/alegreya/Alegreya-wght.woff2`], weight: "400 900" },
            { urls: [`${fontPath}/alegreya/Alegreya-Italic-wght.woff2`], weight: "400 900", style: "italic" }
        ]
    };
    CONFIG.fontDefinitions["Orbitron"] ??= {
        editor: false,
        fonts: [
            { urls: [`${fontPath}/orbitron/Orbitron-wght.ttf`], weight: "400 900" }
        ]
    };
    CONFIG.fontDefinitions["IM Fell English"] ??= {
        editor: false,
        fonts: [
            { urls: [`${fontPath}/im-fell-english/IMFeENrm28P.ttf`] },
            { urls: [`${fontPath}/im-fell-english/IMFeENit28P.ttf`], style: "italic" }
        ]
    };

    CONFIG.linemap = {
        // The scene setting's choices; the first is the default.
        labelFonts: ["Alegreya", "IM Fell English", "Orbitron"],
        snap: {
            lineEnd: 10,
            line: 5,
            symbol: 20
        },    
        objectTypes: {
            line: Line,
            symbol: Symbol,
            waypoint: Waypoint,
            area: Area,
            text: Text,
            image: MapImage
        },
        lineStyles: {
            major: {
                label: 'linemap.lineStyles.major',
                icon: 'modules/linemap/assets/lines/major-path.svg',
                lineClass: SolidLine,
                selectTolerance: 5
            },
            minor: {
                label: 'linemap.lineStyles.minor',
                icon: 'modules/linemap/assets/lines/minor-path.svg',
                lineClass: DashLine,
                selectTolerance: 5
            },
            rough: {
                label: 'linemap.lineStyles.rough',
                icon: 'modules/linemap/assets/lines/rough-path.svg',
                lineClass: WaveLine,
                selectTolerance: 13
            },
            barrier: {
                label: 'linemap.lineStyles.barrier',
                icon: 'modules/linemap/assets/lines/barrier.svg',
                lineClass: BarrierLine,
                selectTolerance: 13
            },
            dotted: {
                label: 'linemap.lineStyles.dotted',
                icon: 'modules/linemap/assets/lines/dotted.svg',
                lineClass: DotLine,
                selectTolerance: 6
            },
            // The sci-fi theme's: a thin trade lane, and a jump in long dashes.
            lane: {
                label: 'linemap.lineStyles.lane',
                icon: 'modules/linemap/assets/themes/scifi/lines/lane.svg',
                lineClass: SolidLine,
                width: 2,
                selectTolerance: 5
            },
            jump: {
                label: 'linemap.lineStyles.jump',
                icon: 'modules/linemap/assets/themes/scifi/lines/jump.svg',
                lineClass: DashLine,
                width: 3,
                dash: [26, 14],
                selectTolerance: 5
            }
        },
        symbols: {
            'major-settlement': {
                label: 'linemap.symbols.major-settlement',
                icon: 'modules/linemap/assets/symbols/major-settlement.svg',
                footprint: 'modules/linemap/assets/footprints/major-settlement.svg'
            },
            'minor-settlement': {
                label: 'linemap.symbols.minor-settlement',
                icon: 'modules/linemap/assets/symbols/minor-settlement.svg',
                footprint: 'modules/linemap/assets/footprints/minor-settlement.svg'
            },
            'major-site': {
                label: 'linemap.symbols.major-site',
                icon: 'modules/linemap/assets/symbols/major-site.svg',
                footprint: 'modules/linemap/assets/footprints/major-site.svg'
            },
            'minor-site': {
                label: 'linemap.symbols.minor-site',
                icon: 'modules/linemap/assets/symbols/minor-site.svg',
                footprint: 'modules/linemap/assets/footprints/minor-site.svg'
            },
            'major-danger': {
                label: 'linemap.symbols.major-danger',
                icon: 'modules/linemap/assets/symbols/major-danger.svg',
                footprint: 'modules/linemap/assets/footprints/major-danger.svg'
            },
            'minor-danger': {
                label: 'linemap.symbols.minor-danger',
                icon: 'modules/linemap/assets/symbols/minor-danger.svg',
                footprint: 'modules/linemap/assets/footprints/minor-danger.svg'
            },
            'curiosity': {
                label: 'linemap.symbols.curiosity',
                icon: 'modules/linemap/assets/symbols/curiosity.svg'
            },
            // The sci-fi theme's, from game-icons.net (CC BY 3.0, credited in the README).
            ...Object.fromEntries(["station", "planet", "starport", "asteroid", "jump-gate", "derelict"].map(name => [`scifi:${name}`, {
                label: `linemap.symbols.scifi-${name}`,
                icon: `modules/linemap/assets/themes/scifi/symbols/${name}.svg`,
                footprint: `modules/linemap/assets/themes/scifi/footprints/${name}.svg`
            }]))
        },
        waypoints: {
            waypoint: {
                label: 'linemap.waypoints.waypoint',
                icon: 'modules/linemap/assets/waypoints/waypoint.svg',
                footprint: 'modules/linemap/assets/waypoints/waypoint.svg'
            },
            pass: {
                label: 'linemap.waypoints.pass',
                icon: 'modules/linemap/assets/waypoints/pass.svg',
                footprint: 'modules/linemap/assets/footprints/pass.svg'
            },
            'elevation-left': {
                label: 'linemap.waypoints.elevation-left',
                icon: 'modules/linemap/assets/waypoints/elevation-left.svg',
                reverse: 'elevation-right'
            },
            'elevation-right': {
                label: 'linemap.waypoints.elevation-right',
                icon: 'modules/linemap/assets/waypoints/elevation-right.svg',
                reverse: 'elevation-left'
            }
        },
        // Presets picked in the scene settings. Picking one sets the map's colour, label font, halo and
        // background picture; its symbol and line styles are the ones the tools show. A map with no
        // theme shows the first theme's.
        themes: {
            fantasy: {
                label: 'linemap.themes.fantasy',
                color: '#3a2614',
                labelFont: 'IM Fell English',
                halo: true,
                haloColor: '#efe0bb',
                background: 'modules/linemap/assets/themes/fantasy/parchment.svg',
                symbols: ['major-settlement', 'minor-settlement', 'major-site', 'minor-site', 'major-danger', 'minor-danger', 'curiosity'],
                lineStyles: ['major', 'minor', 'rough', 'barrier', 'dotted']
            },
            scifi: {
                label: 'linemap.themes.scifi',
                color: '#a8dcff',
                labelFont: 'Orbitron',
                halo: true,
                haloColor: '#070b18',
                background: 'modules/linemap/assets/themes/scifi/starfield.svg',
                symbols: ['scifi:station', 'scifi:planet', 'scifi:starport', 'scifi:asteroid', 'scifi:jump-gate', 'scifi:derelict'],
                lineStyles: ['lane', 'jump', 'dotted', 'barrier']
            }
        },
        patterns: {
            diagonal1: {
                label: 'linemap.patterns.diagonal1',
                texture: 'modules/linemap/assets/patterns/diagonal1.svg'
            },
            diagonal2: {
                label: 'linemap.patterns.diagonal2',
                texture: 'modules/linemap/assets/patterns/diagonal2.svg'
            },
            dots: {
                label: 'linemap.patterns.dots',
                texture: 'modules/linemap/assets/patterns/dots.svg'
            },
            waves: {
                label: 'linemap.patterns.waves',
                texture: 'modules/linemap/assets/patterns/waves.svg'
            },
            barrier: {
                label: 'linemap.patterns.barrier',
                lineWidth: 12
            }
        }
    };

});
