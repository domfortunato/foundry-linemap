import { ObjectData, ObjectType, UnknownObject } from "./classes/object.js";
import { Tool, ToolHotkey } from "./classes/tool.js";
import { Vec2, SnapType, SnapPoint } from "./dto.js";
import { length2, sub2 } from "./helpers/utils.js";
import { DrawLineTool } from "./tools/draw-line.js";
import { DrawSymbolTool } from "./tools/draw-symbol.js";
import { DrawWaypointTool } from "./tools/draw-waypoint.js";
import { DrawAreaTool } from "./tools/draw-area.js";
import { DrawTextTool } from "./tools/draw-text.js";
import { DrawImageTool } from "./tools/draw-image.js";
import { SelectTool } from "./tools/select-tool.js";
import { AdjustTool } from "./tools/adjust-tool.js";
import { ScenePropertiesApp } from "./apps/scene-properties.js";
import { Text } from "./objects/text.js";
import { MapImage } from "./objects/image.js";

const { layers } = foundry.canvas;

interface LayerData {
    objects: ObjectData[];
    // The content colour, "#rrggbb". Maps saved before it existed have only isLightMode.
    color?: string;
    // Saved beside the colour as its nearest of white (true) and black, for builds that know only those.
    isLightMode: boolean;
    symbolScale: number;
    labelFont?: string;
    /** The halo behind symbols and labels: true when on, null when off. */
    halo?: boolean | null;
    /** The halo's colour, "#rrggbb", or null for the content colour's opposite. */
    haloColor?: string | null;
    /** The theme last picked (a CONFIG.linemap.themes key), or null for none. */
    theme?: string | null;
}

interface InterfaceState {
    selectedIds: string[];
}

/** One object an edit touched: what it was (null: the edit made it) and where it stood. */
interface ObjectChange {
    id: string;
    index: number;
    before: ObjectData | null;
}

/** One undoable edit: the objects it changed, made or removed. */
interface HistoryEntry {
    changes: ObjectChange[];
}

export type TextureCollection = Record<string, { icon: any, footprint: any }>;

export class LineMapLayer extends layers.InteractionLayer {
    static MaxUndo = 100;

    objects: ObjectType[] = [];
    placeables: any[] = [];

    // This user's own edits, newest last. Each holds only the objects it touched, so an undo takes
    // back that edit and leaves alone whatever another Gamemaster drew meanwhile; whole-map
    // snapshots wiped it.
    undoHistory: HistoryEntry[] = [];
    // The map as last saved or loaded, deep-copied: an edit is the difference from it.
    baseline: LayerData;
    /** The save running or last run, which the next one waits for, and how many are queued or running. */
    saveQueue: Promise<void> = Promise.resolve();
    pendingSaves = 0;
    /** Other users' saves that came in during a drag, taken in after it. */
    deferredMerges: any[] = [];

    tools: Record<string, Tool> = {};
    activeTool: Tool;
    revealNewObjects = true;
    adjustLinked = true;

    symbolTextures: TextureCollection = {};
    waypointTextures: TextureCollection = {};
    patternTextures: TextureCollection = {};
    /** Symbol and waypoint art rasterised above its native size, made on first use (see texturesAt). */
    sharpTextures = new Map<string, { icon: any, footprint: any }>();
    /** Images' textures by path: a texture, null while loading, false when it could not be loaded. */
    imageTextures = new Map<string, any>();

    color = LineMapLayer.defaultColor;
    symbolScale = 1.0;
    labelFont = LineMapLayer.defaultLabelFont;
    halo = false;
    haloColor: string | null = null;
    theme: string | null = null;

    static defaultColor = "#000000";
    /** How far the halo reaches beyond a symbol's art and a label's glyphs, in Scene pixels. */
    static haloWidth = 4;

    /** A saved map's colour: its own, or, saved before there was one, the black or white it had. */
    static colorOf(data: { color?: string, isLightMode?: boolean } | undefined): string {
        const c = data?.color;
        if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
        return data?.isLightMode ? "#ffffff" : LineMapLayer.defaultColor;
    }

    /** Whether a colour is nearer white than black, by its luma. */
    static isLight(color: string): boolean {
        const [r, g, b] = foundry.utils.Color.from(color).rgb;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
    }

    /** A saved halo colour, or null (automatic) when there is none or it is not a colour. */
    static haloColorOf(c: any): string | null {
        return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
    }

    /** The settings part of a map, as it is saved in flags.linemap.map. */
    static settingsOf(data: { color?: string, isLightMode?: boolean, symbolScale?: number, labelFont?: string, halo?: boolean | null, haloColor?: string | null, theme?: string | null }): Omit<LayerData, "objects"> {
        const color = LineMapLayer.colorOf(data);
        return {
            color, isLightMode: LineMapLayer.isLight(color), symbolScale: data?.symbolScale, labelFont: data?.labelFont,
            halo: data?.halo ? true : null,
            haloColor: LineMapLayer.haloColorOf(data?.haloColor),
            theme: typeof data?.theme === "string" && data.theme ? data.theme : null
        };
    }

    /**
     * The theme whose symbols and line styles the tools show: the map's, or with none, the first.
     * A theme this build does not know (another package's, now off) shows everything.
     */
    get toolTheme(): any {
        const themes = CONFIG.linemap.themes ?? {};
        return this.theme ? themes[this.theme] : themes[Object.keys(themes)[0]];
    }

    /** The entries of a collection (CONFIG.linemap.symbols, .lineStyles) that the theme lists, in its order. */
    themed(collection: Record<string, any>, list: "symbols" | "lineStyles"): Record<string, any> {
        const keys: string[] | undefined = this.toolTheme?.[list];
        const known = keys?.filter(k => k in collection);
        if (!known?.length) return collection;
        return Object.fromEntries(known.map(k => [k, collection[k]]));
    }

    /**
     * Pick a theme: its colour, label font, halo and background picture, as one edit. A background
     * picture a theme put in before is replaced, so switching does not stack them; the values stay
     * editable afterwards.
     */
    async applyTheme(id: string) {
        const theme = CONFIG.linemap.themes?.[id];
        if (!theme) return;
        this.theme = id;
        if (LineMapLayer.haloColorOf(theme.color)) this.color = theme.color.toLowerCase();
        if (CONFIG.linemap.labelFonts.includes(theme.labelFont)) this.labelFont = theme.labelFont;
        this.halo = !!theme.halo;
        this.haloColor = LineMapLayer.haloColorOf(theme.haloColor);
        const backgrounds = new Set(Object.values(CONFIG.linemap.themes).map((t: any) => t.background).filter(b => b));
        const old = this.objects.filter(o => o instanceof MapImage && backgrounds.has(o.src));
        this.objects = this.objects.filter(o => !old.includes(o));
        if (theme.background) {
            const r = canvas.dimensions.sceneRect;
            const image = new MapImage();
            image.construct(theme.background, [r.x, r.y, r.width, r.height]);
            image.isRevealed = true;
            // Under everything already on the map.
            image.sort = Math.min(0, ...this.objects.map(o => o.sort)) - 1;
            this.objects.unshift(image);
        }
        this.setSelection();
        this.redraw();
        await this.registerHistory();
        // A symbol or line tool already open shows the new theme's sets.
        if (this.active && this.activeTool) this.activateTool(game.activeTool);
    }

    /** The halo's colour as drawn: the picked one, or the content colour's opposite of black and white. */
    get haloColorShown(): string {
        return this.haloColor ?? (this.isLightMode ? "#000000" : "#ffffff");
    }

    get isLightMode(): boolean {
        return LineMapLayer.isLight(this.color);
    }

    static get defaultLabelFont(): string {
        return CONFIG.linemap?.labelFonts?.[0] ?? "Alegreya";
    }

    // GPU render targets, made once per canvas draw in _draw and destroyed in _tearDown.
    renderTexture: any;
    lineTexture: any;
    maskTexture: any;
    // The display objects of the last redraw: destroyed at the start of the next one (objects read
    // their sprite's size between redraws, so they cannot be destroyed straight after rendering).
    drawn: any[] = [];
    // The two symbol tints, one pass each over every symbol of that colour (made in _draw).
    symbolFilter: any;
    selectedSymbolFilter: any;
    // The halo's colour over every revealed symbol's halo, and over hidden ones' at the hidden alpha.
    haloFilter: any;
    hiddenHaloFilter: any;
    // Label sprites and line graphics kept across redraws, by object id. A drag redraws on every
    // mouse move, and rasterising every label and rebuilding every line each time was most of a big
    // map's redraw; now only what the drag moves is rebuilt, when its look (the key) changes.
    displayCache = new Map<string, { key: string, sprite: any }>();
    displayUsed = new Set<string>();

    // Sorting in the primary group (see _draw).
    elevation = 0;
    sortLayer = 0;
    sort = 1;

    // Stage handlers bound once, so _deactivate removes exactly what _activate added.
    stageHandlers: Record<string, (event: any) => void>;

    // The name core records to restore the active layer after a canvas redraw, and the scene
    // control activate() switches to. Unset, it was "", so a redraw dropped the GM onto Tokens.
    static get layerOptions() {
        return foundry.utils.mergeObject(super.layerOptions, { name: "linemap" });
    }

    constructor() {
        super();

        this.tools = {
            selectObject: new SelectTool(this),
            adjustObject: new AdjustTool(this),
            drawLine: new DrawLineTool(this),
            drawSymbol: new DrawSymbolTool(this),
            drawWaypoint: new DrawWaypointTool(this),
            drawArea: new DrawAreaTool(this),
            drawText: new DrawTextTool(this),
            drawImage: new DrawImageTool(this)
        };
        this.activeTool = this.tools['selectObject'];
        this.stageHandlers = {
            mousedown: this._leftMouseDown.bind(this),
            mouseup: this._leftMouseUp.bind(this),
            rightdown: this._rightMouseDown.bind(this),
            rightup: this._rightMouseUp.bind(this),
            pointermove: this._pointerMove.bind(this),
            pointerout: this._pointerOut.bind(this)
        };

        this.symbolTextures = Object.fromEntries(Object.entries(CONFIG.linemap.symbols).map(([key, value]: [string, any]) => {
            return [key, {
                icon: PIXI.Texture.from(value.icon),
                footprint: value.footprint ? PIXI.Texture.from(value.footprint) : undefined
            }];
        }));
        this.waypointTextures = Object.fromEntries(Object.entries(CONFIG.linemap.waypoints).map(([key, value]: [string, any]) => {
            return [key, {
                icon: PIXI.Texture.from(value.icon),
                footprint: value.footprint ? PIXI.Texture.from(value.footprint) : undefined
            }];
        }));
        this.patternTextures = Object.fromEntries(
            Object.entries(CONFIG.linemap.patterns)
                .filter(([key, value]: [string, any]) => value.texture)
                .map(([key, value]: [string, any]) => {
                    return [key, {
                        icon: PIXI.Texture.from(value.texture, { wrapMode: PIXI.WRAP_MODES.REPEAT }),
                        footprint: undefined
                    }];
                })
        );

        // Another user's save: take in the objects it names. This client's own saves are already on
        // its canvas, and so are any of its edits still on their way to the server.
        Hooks.on("updateScene", (obj, updates, options, userId) => {
            if (updates.flags?.linemap) LineMapLayer._announceChanges(obj, updates.flags.linemap, userId);
            if (obj === canvas.scene && updates.flags?.linemap && userId !== game.user.id) {
                this._mergeRemote(updates.flags.linemap);
            }
        });

        // A canvas draw restores the active layer (layerOptions.name) and only afterwards clears every
        // stage listener (Canvas#addListeners: stage.removeAllListeners()), then fires canvasReady. So
        // when this layer is the one restored, its handlers are put back here.
        // The tool too: Canvas#tearDown deactivated the layer (clearTool), and activating it again with
        // the same control and tool calls no tool's onChange, so nothing else would bring it back.
        Hooks.on("canvasReady", () => {
            if (this.active) {
                this._attachStageHandlers();
                if (!this.activeTool && this.tools[game.activeTool]) this.activateTool(game.activeTool);
            }
            ScenePropertiesApp.refresh();
        });
    }

    /**
     * preUpdateScene: when a Scene is resized with autoReposition (its config window sets it when
     * the Scene has a background), core moves every placeable to keep its place on the background.
     * Move the map the same way, in the same update; it used to stay put and slide off its places.
     * Runs after core's own _preUpdate, so the transform is core's: scale by the size change, then
     * offset to the new Scene rectangle.
     */
    static onPreUpdateScene(scene: any, changed: any, options: any) {
        if (!options?.autoReposition) return;
        const data = LineMapLayer.readFlag(scene);
        if (!data?.objects?.length) return;

        const dims: Record<string, any> = {};
        for (const key of ["width", "height", "padding", "shiftX", "shiftY", "grid"]) {
            if (key in changed) dims[key] = foundry.utils.deepClone(changed[key]);
        }
        const updated = scene.clone(dims);
        const sx = updated.width / scene.width;
        const sy = updated.height / scene.height;
        const ox = updated.dimensions.sceneX - sx * scene.dimensions.sceneX;
        const oy = updated.dimensions.sceneY - sy * scene.dimensions.sceneY;
        if (![sx, sy, ox, oy].every(Number.isFinite) || (sx === 1 && sy === 1 && ox === 0 && oy === 0)) return;

        const move = ([x, y]: Vec2): Vec2 => [x * sx + ox, y * sy + oy];
        const objects = data.objects.map(o => {
            const cls = CONFIG.linemap.objectTypes[o?.type];
            return cls ? cls.moveData(o, move) : o;
        });
        if (scene.flags?.linemap?.objects) {
            // Only the points move, and every object's keys stay the same, so a plain merge is exact.
            for (const o of objects) foundry.utils.setProperty(changed, `flags.linemap.objects.${o.id}`, o);
        } else {
            // A map in the old format stays in it until it is next edited.
            foundry.utils.setProperty(changed, "flags.linemap.serialized", { ...scene.flags.linemap.serialized, objects });
        }
    }

    /**
     * The map saved on a Scene, sorted for drawing, or undefined when it has none. Two formats:
     * - since the fork's review #1, `flags.linemap.objects` holds each object under its own id and
     *   `flags.linemap.map` the settings, so a save sends only the objects it changed and the server
     *   merges saves of different objects from different Gamemasters;
     * - before, `flags.linemap.serialized` held the settings and an array of every object, so of two
     *   saves at once the later replaced the earlier whole. Still read; a map is moved to the new
     *   format, all at once, when the active Gamemaster views it (or at its first save, if sooner).
     * Settings saved before anything is drawn leave `map` alone, which is the new format too.
     */
    static readFlag(scene: any): LayerData | undefined {
        const flag = scene?.flags?.linemap;
        if (flag?.objects || (flag?.map && !flag?.serialized)) {
            const objects = Object.entries((flag.objects ?? {}) as Record<string, ObjectData>)
                .filter(([key, o]) => LineMapLayer.isObjectEntry(key, o))
                .map(([, o]) => o)
                .sort(LineMapLayer.compareSort);
            return { ...(flag.map ?? {}), objects };
        }
        const old = flag?.serialized;
        if (!old) return undefined;
        return { ...old, objects: (old.objects ?? []).map((o, i) => ({ ...o, sort: o?.sort ?? i })) };
    }

    /**
     * Whether an entry of `flags.linemap.objects` is an object: it has a type and is filed under its
     * own id. An edit merged into a key another Gamemaster's save had just deleted leaves only the
     * edited keys there, with neither.
     */
    static isObjectEntry(key: string, o: any): boolean {
        return !!o && typeof o === "object" && typeof o.type === "string" && o.id === key;
    }

    /** Deletions for every entry of a Scene's `flags.linemap.objects` that is not an object. */
    static strayDeletions(scene: any): Record<string, any> {
        const update: Record<string, any> = {};
        for (const [key, o] of Object.entries(scene?.flags?.linemap?.objects ?? {})) {
            if (!LineMapLayer.isObjectEntry(key, o)) Object.assign(update, LineMapLayer._deletion("flags.linemap.objects", key));
        }
        return update;
    }

    static compareSort(a: { sort?: number, id: string }, b: { sort?: number, id: string }): number {
        return ((a.sort ?? 0) - (b.sort ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    /** The update that takes a Scene's map from one state to the next, or null when nothing differs. */
    static flagUpdate(from: LayerData | undefined, to: LayerData, migrate: boolean): Record<string, any> | null {
        const update: Record<string, any> = {};
        const before = new Map((migrate ? [] : from?.objects ?? []).map(o => [o.id, o]));
        for (const o of to.objects) {
            const was = before.get(o.id);
            before.delete(o.id);
            if (!was || JSON.stringify(was) !== JSON.stringify(o)) update[`flags.linemap.objects.${o.id}`] = o;
        }
        for (const id of before.keys()) Object.assign(update, LineMapLayer._deletion("flags.linemap.objects", id));
        const settings = LineMapLayer.settingsOf(to);
        const oldSettings = from && LineMapLayer.settingsOf(from);
        if (migrate || JSON.stringify(settings) !== JSON.stringify(oldSettings)) update["flags.linemap.map"] = settings;
        if (migrate) Object.assign(update, LineMapLayer._deletion("flags.linemap", "serialized"));
        return Object.keys(update).length ? update : null;
    }

    /** Remove a key in an update (Foundry 14's ForcedDeletion operator). */
    static _deletion(parent: string, key: string): Record<string, any> {
        return { [`${parent}.${key}`]: new foundry.data.operators.ForcedDeletion() };
    }

    /** Add the stage handlers; safe to repeat, since each is removed by identity first. */
    _attachStageHandlers() {
        for (const [type, handler] of Object.entries(this.stageHandlers)) {
            canvas.stage.removeEventListener(type, handler);
            canvas.stage.addEventListener(type, handler);
        }
    }

    _detachStageHandlers() {
        for (const [type, handler] of Object.entries(this.stageHandlers)) {
            canvas.stage.removeEventListener(type, handler);
        }
    }

    // Core's activate()/deactivate() call these only on a real change of state. The handlers are
    // bound once and removed by identity: a fresh .bind() would match nothing, and a set of
    // listeners piled up on every visit to the layer.
    _activate() {
        this._attachStageHandlers();
        this.undoHistory = [];
    }

    _deactivate() {
        this._detachStageHandlers();
        this.interactionData = undefined;
        this.interactionDataRight = undefined;
        // Takes the tool's option bar and preview off screen; the tool's own onChange(true)
        // re-activates it when the GM comes back to the control.
        this.clearTool();
        this.undoHistory = [];
    }

    activateTool(tool: string) {
        // A drag the old tool began is not the new one's to finish.
        this.cancelDrag();
        this.clearTool();
        this.activeTool = this.tools[tool];
        if (this.activeTool) this.activeTool.activation = {};
        this.activeTool?.activate();
        this.redraw();
    }

    clearTool() {
        this.activeTool?.deactivate();
        if (this.activeTool) this.activeTool.activation = null;
        this.activeTool = null;
        this.clearPreview();
    }

    /** Remove and destroy the preview's graphics: they are always made fresh, and a Graphics holds GPU buffers until destroyed. */
    clearPreview() {
        this.preview?.removeChildren().forEach(c => c.destroy({ children: true }));
    }

    /** Destroy the previous redraw's display objects. Shared textures (icons, render targets) and cached displays are kept. */
    _disposeDrawn() {
        this.objectContainer?.removeChildren();
        for (const { sprite } of this.displayCache.values()) sprite.parent?.removeChild(sprite);
        this.drawn.forEach(c => c.destroy({ children: true }));
        this.drawn = [];
    }

    /**
     * An object's display object from the cache, or a new one from make() when the object is new or
     * its look (key) changed. Those not asked for during a redraw are destroyed at its end.
     */
    cachedDisplay(id: string, key: string, make: () => any): any {
        this.displayUsed.add(id);
        const hit = this.displayCache.get(id);
        if (hit?.key === key && !hit.sprite.destroyed) return hit.sprite;
        hit?.sprite.destroy(true);
        const sprite = make();
        this.displayCache.set(id, { key, sprite });
        return sprite;
    }

    _pruneDisplays(all = false) {
        for (const [id, { sprite }] of this.displayCache) {
            if (all || !this.displayUsed.has(id)) {
                sprite.parent?.removeChild(sprite);
                sprite.destroy(true);
                this.displayCache.delete(id);
            }
        }
        this.displayUsed.clear();
    }

    hotkeyPressed(key: ToolHotkey) {
        this.activeTool?.hotkeyPressed(key);
    }

    /**
     * A symbol's or waypoint's textures, rasterised for the scale they are drawn at. The plain ones
     * hold the art at its native size, which a big symbol stretched into a blur, so above scale 1 the
     * SVG is rasterised again at 2 or 4 times (with the same resolution, so the sprite's size is the
     * same). Those are made once, on first use; until one has loaded, the plain one is drawn and the
     * map is redrawn when it arrives.
     */
    texturesAt(config: "symbols" | "waypoints", plain: TextureCollection, key: string, scale: number): { icon: any, footprint: any } | undefined {
        // A symbol this build does not know is drawn as the collection's first, and keeps its own key.
        const known = plain[key] ? key : Object.keys(plain)[0];
        const fallback = plain[known];
        const resolution = scale <= 1 ? 1 : scale <= 2 ? 2 : 4;
        const art = CONFIG.linemap[config]?.[known];
        if (resolution === 1 || !art) return fallback;
        const id = `${config}:${known}:${resolution}`;
        let sharp = this.sharpTextures.get(id);
        if (!sharp) {
            const make = (src: string | undefined) => {
                if (!src) return undefined;
                // Not PIXI.Texture.from: its cache is keyed by the URL alone, and would hand back the plain one.
                const texture = new PIXI.Texture(new PIXI.BaseTexture(src, { resolution, resourceOptions: { scale: resolution } }));
                if (!texture.baseTexture.valid) texture.baseTexture.once("loaded", () => this.redraw());
                return texture;
            };
            sharp = { icon: make(art.icon), footprint: make(art.footprint) };
            this.sharpTextures.set(id, sharp);
        }
        const ready = sharp.icon?.baseTexture.valid && (!sharp.footprint || sharp.footprint.baseTexture.valid);
        return ready ? sharp : fallback;
    }

    /**
     * An image's texture, through Foundry's texture loader (which caches it), or null while it loads
     * and false when it cannot be loaded; the map is redrawn when the load ends. A texture the loader
     * has since freed is loaded again.
     */
    imageTexture(src: string): any {
        const known = this.imageTextures.get(src);
        if (known === null || known === false) return known;
        if (known && known.baseTexture && !known.baseTexture.destroyed && known.valid) return known;
        this.imageTextures.set(src, null);
        foundry.canvas.loadTexture(src).then((texture: any) => {
            this.imageTextures.set(src, texture ?? false);
            this.redraw();
        });
        return null;
    }

    /**
     * Move images one place up (1) or down (-1) among the map's images, as one edit: each swaps its
     * drawing order with the next image that way. Other objects are drawn above every image anyway.
     */
    reorderImages(images: MapImage[], direction: 1 | -1) {
        const all = this.objects.filter(o => o instanceof MapImage).sort(LineMapLayer.compareSort) as MapImage[];
        const moving = new Set(images);
        const order = direction > 0 ? [...all].reverse() : all;
        let changed = false;
        for (const image of order) {
            if (!moving.has(image)) continue;
            const i = all.indexOf(image);
            const other = all[i + direction];
            if (!other || moving.has(other)) continue;
            [image.sort, other.sort] = [other.sort, image.sort];
            [all[i], all[i + direction]] = [other, image];
            changed = true;
        }
        if (!changed) return;
        this.objects.sort(LineMapLayer.compareSort);
        this.registerHistory();
        this.redraw();
    }

    /** Make each image cover the Scene, so one can be the map's background. */
    fitImagesToScene(images: MapImage[]) {
        const r = canvas.dimensions.sceneRect;
        for (const image of images) image.rect = [r.x, r.y, r.width, r.height];
        if (images.length) {
            this.registerHistory();
            this.redraw();
        }
    }

    /**
     * Resize every object in the list that has a size, each kept within its own range. A label linked
     * to a symbol that grows moves out with the symbol's edge, and a linked label that grows moves out
     * by half its own growth, so neither ends up over the other. Not recorded: the caller records it.
     * Whether anything changed.
     */
    resizeObjects(objects: ObjectType[], next: (size: number) => number): boolean {
        let changed = false;
        for (const obj of objects) {
            const range = obj.sizeRange;
            const old = (obj as any).size;
            if (!range || typeof old !== "number") continue;
            const size = obj.clampSize(next(old));
            if (size === old) continue;
            changed = true;
            const height = (obj as any).sprite?.height ?? 0;
            (obj as any).size = size;
            // The drawn height scales with the size; the gap from the anchor is half of it.
            const grow = height * (size / old - 1) / 2;
            if (obj instanceof Text) {
                if (obj.point.sourceObject) Text.pushOut(obj, grow);
            } else {
                for (const label of this.objects) {
                    if (label instanceof Text && label.point.sourceObject === obj) Text.pushOut(label, grow);
                }
            }
        }
        return changed;
    }

    /** Grow or shrink the sized objects of the selection by half a size, as one edit. */
    stepSizes(delta: number) {
        if (this.resizeObjects(this.selection, size => size + delta)) {
            this.registerHistory();
            this.redraw();
        }
    }

    clear(withUndo: boolean = true) {
        this.objects = [];

        if (withUndo) {
            this.registerHistory();
        }
        // this.quadtree.clear();
    }

    addObject(obj: ObjectType) {
        obj.isRevealed = this.revealNewObjects;
        // Drawn above everything already there; kept for good, so other objects never shift.
        obj.sort = this.objects.reduce((m, o) => Math.max(m, o.sort ?? 0), 0) + 1;
        this.objects.push(obj);

        this.registerHistory();
        this.redraw();
    }

    deleteObjects(...obj: ObjectType[]) {
        const gone = new Set(obj);
        // A point linked to a deleted object is pinned where it is now. Left linked, it kept following
        // the deleted object in this session and was saved naming it, so a reload put it back where
        // it had first been drawn.
        for (const o of this.objects) if (!gone.has(o)) o.releaseConstraints(gone);
        this.objects = this.objects.filter(o => !gone.has(o));

        this.registerHistory();
        this.redraw();
    }

    async _draw(options) {
        // The render targets are made by the first redraw with something to draw (_makeTargets).
        this.lineFilter = new PIXI.Filter(`
            attribute vec2 aVertexPosition;

            uniform mat3 projectionMatrix;

            varying vec2 vTextureCoord;
            varying vec2 vMaskTextureCoord;

            uniform vec4 inputSize;
            uniform vec4 outputFrame;
            uniform vec2 screenDimensions;

            vec4 filterVertexPosition( void )
            {
                vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;

                return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
            }

            vec2 filterTextureCoord( void )
            {
                return aVertexPosition * (outputFrame.zw * inputSize.zw);
            }

            void main(void)
            {
                gl_Position = filterVertexPosition();
                vTextureCoord = filterTextureCoord();
                vMaskTextureCoord = (vTextureCoord * inputSize.xy + outputFrame.xy) / screenDimensions;
            }
        `, `
            uniform sampler2D uSampler;
            uniform sampler2D lineTexture;
            uniform sampler2D maskTexture;

            varying vec2 vTextureCoord;
            varying vec2 vMaskTextureCoord;

            void main(void)
            {
                vec2 uv = vMaskTextureCoord;
                vec4 line = texture2D(lineTexture, uv);
                vec4 mask = texture2D(maskTexture, uv);
                gl_FragColor = line * (1.0 - mask.a);
                gl_FragColor.a = line.a * (1.0 - mask.a);
            }
        `, { screenDimensions: [canvas.dimensions.width, canvas.dimensions.height] });

        // Symbols are painted in one colour each: one filter per colour, over a container of every
        // symbol in it. A filter per sprite cost a render pass per symbol on every redraw.
        const tint = `
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform vec3 tintColor;

            void main(void)
            {
                vec4 s = texture2D(uSampler, vTextureCoord);
                gl_FragColor.a = s.a;
                gl_FragColor.rgb = tintColor * s.a;
            }
        `;
        this.symbolFilter = new PIXI.Filter(null, tint, { tintColor: this._objectColor });
        this.selectedSymbolFilter = new PIXI.Filter(null, tint, { tintColor: this._selectionColor });
        // A halo is many copies of a symbol's art, overlapping: painted at full alpha, then made
        // see-through as a whole, or the overlaps of a hidden symbol's copies would add up.
        const haloTint = `
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform vec3 tintColor;
            uniform float alpha;

            void main(void)
            {
                float a = texture2D(uSampler, vTextureCoord).a * alpha;
                gl_FragColor = vec4(tintColor * a, a);
            }
        `;
        this.haloFilter = new PIXI.Filter(null, haloTint, { tintColor: this._haloColor, alpha: 1.0 });
        this.hiddenHaloFilter = new PIXI.Filter(null, haloTint, { tintColor: this._haloColor, alpha: 0.4 });

        // In the primary group, sit just above the background of the level being viewed: v14 draws
        // each level's background at that level's bottom elevation, so at elevation 0 a raised
        // level's background covered the map. Tiles, drawings and tokens there stay above it, as on
        // the ground level. Viewing another level redraws the canvas, which runs this again.
        this.elevation = canvas.level?.elevation?.bottom ?? 0;
        this.sortLayer = foundry.canvas.groups?.PrimaryCanvasGroup?.SORT_LAYERS?.SCENE ?? 0;
        this.sort = 1;
        if (this.parent) this.parent.sortDirty = true;

        this.objectContainer = new PIXI.Container();

        this.renderSprite = this.addChild(new PIXI.Sprite());

        this.preview = this.addChild(new PIXI.Container());

        await this._texturesLoaded();
        this.fetchData();
        this.redraw();
        this._migrateOnView();

        this.visible = true;
        /** A Scene's map is on the canvas: (layer, scene). */
        Hooks.callAll("linemapReady", this, canvas.scene);
    }

    /**
     * linemapObjectsChanged (scene, { changed, deleted, settings, userId }) for every save of a map, by
     * any user, on any Scene: the ids of the objects saved and of those removed, and whether the map's
     * settings were saved. A whole map saved in the old format names every object.
     */
    static _announceChanges(scene: any, changes: any, userId: string) {
        const saved = LineMapLayer.readFlag(scene);
        const present = new Set((saved?.objects ?? []).map(o => o.id));
        const whole = "serialized" in changes || "-=serialized" in changes;
        const named = whole ? [...present] : Object.keys(changes.objects ?? {}).map(k => k.replace(/^-=/, ""));
        Hooks.callAll("linemapObjectsChanged", scene, {
            changed: named.filter(id => present.has(id)),
            deleted: named.filter(id => !present.has(id)),
            settings: "map" in changes || whole,
            userId
        });
    }

    /**
     * Wait for every symbol, waypoint and pattern texture to load, or fail. The map is drawn once into
     * a texture, so a sprite whose art had not arrived yet drew nothing, and stayed so until the map
     * was next redrawn (a Gamemaster's edit).
     */
    async _texturesLoaded() {
        const textures = [this.symbolTextures, this.waypointTextures, this.patternTextures]
            .flatMap(c => Object.values(c).flatMap(t => [t.icon, t.footprint]))
            .filter(t => t && !t.baseTexture.valid);
        await Promise.all(textures.map(t => new Promise<void>(resolve => {
            t.baseTexture.once("loaded", () => resolve());
            t.baseTexture.once("error", () => resolve());
        })));
    }

    /**
     * Make the map's render targets, once there is something to draw: a Scene with no map pays for
     * none (they are each the canvas's size, and every Scene had three). A target bigger than the GPU
     * allows cannot be made at all, so a canvas that large is drawn at a lower resolution, as core
     * does for the fog of war.
     */
    _makeTargets() {
        const { width, height } = canvas.dimensions;
        const gl = canvas.app.renderer.gl;
        const max = gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 4096;
        const size = { width, height, resolution: Math.min(1, max / Math.max(width, height)) };
        this.renderTexture = PIXI.RenderTexture.create(size);
        this.lineTexture = PIXI.RenderTexture.create(size);
        this.maskTexture = PIXI.RenderTexture.create(size);
        this.renderSprite.texture = this.renderTexture;
    }

    redraw(highQuality = true) {
        // Nothing to draw into before the canvas has drawn this layer (_draw makes the containers).
        if (!this.objectContainer) return;
        if (!this.renderTexture) {
            if (!this.objects.length) return;
            this._makeTargets();
        }
        this._disposeDrawn();

        const layers = {
            images: new PIXI.Container(),
            areas: new PIXI.Container(),
            lines: new PIXI.Container(),
            footprints: new PIXI.Container(),
            halos: new PIXI.Container(),
            hiddenHalos: new PIXI.Container(),
            symbols: new PIXI.Container(),
            selectedSymbols: new PIXI.Container(),
            labels: new PIXI.Container()
        }

        this.displayUsed.clear();
        this.objects.forEach(obj => {
            obj.draw(layers);
        });
        this._pruneDisplays();

        this.symbolFilter.uniforms.tintColor = this._objectColor;
        this.selectedSymbolFilter.uniforms.tintColor = this._selectionColor;
        layers.symbols.filters = [this.symbolFilter];
        layers.selectedSymbols.filters = [this.selectedSymbolFilter];
        this.haloFilter.uniforms.tintColor = this._haloColor;
        this.hiddenHaloFilter.uniforms.tintColor = this._haloColor;
        if (layers.halos.children.length) layers.halos.filters = [this.haloFilter];
        if (layers.hiddenHalos.children.length) layers.hiddenHalos.filters = [this.hiddenHaloFilter];
        // What is rendered as "symbols": the halos, both tints, then the labels above them.
        const symbols = new PIXI.Container();
        symbols.addChild(layers.halos, layers.hiddenHalos, layers.symbols, layers.selectedSymbols, layers.labels);

        // Areas first: a probe counts a redraw's area outlines in its first container.
        this.drawn = [layers.areas, layers.lines, layers.footprints, symbols, layers.images];

        if (!highQuality) {
            this.objectContainer.addChild(layers.images);
            this.objectContainer.addChild(layers.areas);
            this.objectContainer.addChild(layers.lines);
            this.objectContainer.addChild(symbols);
            canvas.app.renderer.render(this.objectContainer, { renderTexture: this.renderTexture, clear: true });
            return;
        }

        // The line and mask targets are reused: a fresh pair per redraw was never freed (PIXI's texture
        // GC skips render textures) and leaked two scene-sized textures per click.
        canvas.app.renderer.render(layers.lines, { renderTexture: this.lineTexture, clear: true });
        canvas.app.renderer.render(layers.footprints, { renderTexture: this.maskTexture, clear: true });

        const lineContainer = new PIXI.Container();
        const lineSprite = lineContainer.addChild(new PIXI.Sprite(this.lineTexture));
        lineSprite.filters = [this.lineFilter];
        this.lineFilter.uniforms.lineTexture = this.lineTexture;
        this.lineFilter.uniforms.maskTexture = this.maskTexture;
        this.drawn.push(lineContainer);

        canvas.app.renderer.render(layers.images, { renderTexture: this.renderTexture, clear: true });
        canvas.app.renderer.render(layers.areas, { renderTexture: this.renderTexture, clear: false });
        canvas.app.renderer.render(lineContainer, { renderTexture: this.renderTexture, clear: false });
        canvas.app.renderer.render(symbols, { renderTexture: this.renderTexture, clear: false });
    }

    async _tearDown(options) {
        this.clear(false);
        this._disposeDrawn();
        this._pruneDisplays(true);
        this.objectContainer?.destroy({ children: true });
        this.objectContainer = undefined;
        // Destroys renderSprite and preview with their children (not their textures).
        await super._tearDown(options);
        for (const texture of [this.renderTexture, this.lineTexture, this.maskTexture]) texture?.destroy(true);
        this.renderTexture = this.lineTexture = this.maskTexture = undefined;
        // Asked for again through the loader on the next draw, which may have freed them meanwhile.
        this.imageTextures.clear();
    }

    getSnapPoints(pt: Vec2, types: SnapType[]): SnapPoint[] {
        return this.objects.flatMap(obj => obj.getSnapPoints(pt, types));
    }

    getSnapPoint(pt: Vec2, types: SnapType[], exclude?: ObjectType[]): SnapPoint {
        let snaps = this.objects
            .filter(obj => !exclude || !exclude.includes(obj))
            .flatMap(obj => obj.getSnapPoints(pt, types));
        if (snaps.find(s => s.type === SnapType.symbol)) {
            snaps = snaps.filter(s => s.type === SnapType.symbol);
        }
        return snaps.reduce((cur, snap) => {
            if (!cur) {
                return snap;
            }
            return length2(sub2(cur.pt, pt)) > length2(sub2(snap.pt, pt)) ? snap : cur;
        }, undefined);
    }

    get _selectionColor(): [number, number, number] {
        return foundry.utils.Color.from(this._selectionColorHex).rgb;
    }

    /**
     * Core's colour for controlled objects, unless the content is near it: then the content's
     * opposite, so a selection still shows.
     */
    get _selectionColorHex(): number {
        const controlled = CONFIG.Canvas.dispositionColors.CONTROLLED;
        const content = this._objectColor;
        const sel = foundry.utils.Color.from(controlled).rgb;
        const distance = Math.hypot(...content.map((v, i) => v - sel[i]));
        return distance < 0.3 ? 0xffffff ^ this._objectColorHex : controlled;
    }

    get _haloColor(): [number, number, number] {
        return foundry.utils.Color.from(this.haloColorShown).rgb;
    }

    get _haloColorHex(): number {
        return Number(foundry.utils.Color.from(this.haloColorShown));
    }

    /**
     * A symbol's halo: its art stamped in rings of copies around it, and its footprint, where it has
     * one, filling its gaps; under every symbol, and painted in the halo colour as a whole.
     */
    stampHalo(layers: any, icon: any, footprint: any, x: number, y: number, scale: number, rotation: number, revealed: boolean) {
        const target = revealed ? layers.halos : layers.hiddenHalos;
        if (!target || !icon) return;
        const stamps: [any, Vec2][] = LineMapLayer._haloOffsets(LineMapLayer.haloWidth).map(offset => [icon, offset]);
        if (footprint) stamps.push([footprint, [0, 0]]);
        for (const [texture, [dx, dy]] of stamps) {
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.x = x + dx;
            sprite.y = y + dy;
            sprite.rotation = rotation;
            sprite.scale = { x: scale, y: scale };
            target.addChild(sprite);
        }
    }

    /** The offsets of a halo's copies: rings at half and full width, so that thin art is covered between them. */
    static _haloOffsets(r: number): Vec2[] {
        const ring = (radius: number, n: number): Vec2[] =>
            Array.from({ length: n }, (_, i) => [radius * Math.cos(2 * Math.PI * i / n), radius * Math.sin(2 * Math.PI * i / n)] as Vec2);
        return [[0, 0], ...ring(r / 2, 8), ...ring(r, 16)];
    }

    get _objectColor(): [number, number, number] {
        return foundry.utils.Color.from(this.color).rgb;
    }

    get _objectColorHex(): number {
        return Number(foundry.utils.Color.from(this.color));
    }

    get selection(): ObjectType[] {
        return this.objects.filter(o => o.isSelected);
    }

    setSelection(...input: ObjectType[]) {
        const objects = input.filter(i => i);
        this.objects.forEach(o => o.isSelected = false);
        objects.forEach(o => o.isSelected = true);

        this.redraw();
    }

    /**
     * End a drag without dropping it. The tools change the objects as the pointer moves and save on
     * the drop, so the objects go back to the saved state (the baseline). Before, a tool change or a
     * release off the canvas left them half-moved and unsaved, until the next edit saved them as its own.
     */
    cancelDrag() {
        const dragging = this.interactionData?.isDragging;
        this.interactionData = undefined;
        this.interactionDataRight = undefined;
        if (dragging && this.baseline) {
            const state = this._captureState();
            this.clearPreview();
            this.applyData(structuredClone(this.baseline));
            this.redraw();
            this._stateInvalidated(state);
        }
        this._flushMerges();
    }

    /** Escape closes the right-click menu (core's Escape closes framed windows only). */
    _onDismissKey(event) {
        if ((this.tools.selectObject as SelectTool)?.closeMenu()) return true;
        return super._onDismissKey(event);
    }

    _leftMouseDown(event) {
        (this.tools.selectObject as SelectTool)?.closeMenu();
        const pt = event.data.getLocalPosition(canvas.app.stage);
        this.interactionData = {
            screenOrigin: { x: event.global.x, y: event.global.y },
            origin: pt,
            destination: pt
        };
    }
    
    _leftMouseUp(event) {
        if (this.interactionData) {
            const pt = event.data.getLocalPosition(canvas.app.stage);
            this.interactionData.destination = pt;
            event.interactionData = this.interactionData;

            let isDoubleClick = false;
            if (this.lastInteractionData) {
                const dx = this.interactionData.screenOrigin.x - this.lastInteractionData.screenOrigin.x;
                const dy = this.interactionData.screenOrigin.y - this.lastInteractionData.screenOrigin.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist <= 3) {
                    isDoubleClick = true;
                }

                this.lastInteractionData = undefined;
            }

            if (!isDoubleClick) {
                if (!this.interactionData.isDragging) {
                    this.tools[game.activeTool]?.onClickLeft(event);     
                } else {
                    // Saves that came in during the drag are taken in once it is dropped.
                    Promise.resolve(this.tools[game.activeTool]?.onDragLeftDrop(event)).finally(() => this._flushMerges());
                }
    
                this.interactionData.timer = setTimeout(() => {
                    this.lastInteractionData = undefined;
                }, 250);
                this.lastInteractionData = this.interactionData;
            } else {
                this.tools[game.activeTool]?.onDoubleClick(event);
            }
        }

        this.interactionData = undefined;
    }

    _rightMouseDown(event) {
        (this.tools.selectObject as SelectTool)?.closeMenu();
        const pt = event.data.getLocalPosition(canvas.app.stage);
        this.interactionDataRight = {
            screenOrigin: { x: event.global.x, y: event.global.y },
            origin: pt,
            destination: pt
        };
    }

    _rightMouseUp(event) {
        if (this.interactionDataRight && !this.interactionDataRight.isDragging) {
            event.interactionData = this.interactionDataRight;
            this.tools[game.activeTool]?.onClickRight(event);
        }
        this.interactionDataRight = undefined;
    }

    _pointerMove(event) {
        (this.tools.selectObject as SelectTool)?.closeMenuIfAway(event.global);
        if (this.interactionData) {
            const pt = event.data.getLocalPosition(canvas.app.stage);
            this.interactionData.destination = pt;
            event.interactionData = this.interactionData;

            if (!this.interactionData.isDragging) {
                const dx = this.interactionData.screenOrigin.x - event.global.x;
                const dy = this.interactionData.screenOrigin.y - event.global.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 3) {
                    this.interactionData.isDragging = true;
                    this.tools[game.activeTool]?.onDragLeftStart(event);
                }
            } else {
                this.tools[game.activeTool]?.onDragLeftMove(event);
            }
        }

        if (this.interactionDataRight) {
            if (!this.interactionDataRight.isDragging) {
                const dx = this.interactionDataRight.screenOrigin.x - event.global.x;
                const dy = this.interactionDataRight.screenOrigin.y - event.global.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 3) {
                    this.interactionDataRight.isDragging = true;
                }
            }
        }

        if (!this.interactionData?.isDragging && event.srcElement === canvas.app.view) {
            const pt = event.data.getLocalPosition(canvas.app.stage);
            pt.x = Math.round(pt.x);
            pt.y = Math.round(pt.y);
            this.tools[game.activeTool]?.onMouseMove(event, pt);
        }
    }

    _pointerOut(event) {
        event.interactionData = this.interactionData;
        this.tools[game.activeTool]?.onMouseOut(event);
        // The release will not reach the canvas, so the drag will never be dropped.
        this.cancelDrag();
    }

    async _onDeleteKey(event) {
        await this.tools[game.activeTool]?.onDeleteKey(event);
    }

    /**
     * Record an edit for undo and save it. The record is the difference from the last saved state,
     * taken before the save is awaited: callers do not await this, and a record pushed after the
     * await held whatever the map looked like by then, so two quick edits came back as one.
     */
    async registerHistory() {
        const entry = this._diff(this.baseline, this.serialized);
        if (entry.changes.length) {
            this.undoHistory.push(entry);
            if (this.undoHistory.length > LineMapLayer.MaxUndo) this.undoHistory.shift();
        }
        await this._saveData();
    }

    /** The objects that differ between two states, each with what it was in the first. */
    _diff(from: LayerData | undefined, to: LayerData): HistoryEntry {
        const before = new Map((from?.objects ?? []).map((o, index) => [o.id, { o, index }]));
        const after = new Map(to.objects.map(o => [o.id, o]));
        const changes: ObjectChange[] = [];
        for (const [id, { o, index }] of before) {
            const now = after.get(id);
            if (!now || JSON.stringify(now) !== JSON.stringify(o)) changes.push({ id, index, before: o });
        }
        for (const id of after.keys()) {
            if (!before.has(id)) changes.push({ id, index: -1, before: null });
        }
        return { changes: structuredClone(changes) };
    }

    /** Take back this user's last edit: what it made goes, what it changed or removed comes back. */
    async undo() {
        const entry = this.undoHistory.pop();
        if (!entry) return;
        const state = this._captureState();
        // What the undo removes may have been linked to since (by another Gamemaster): pin those points.
        const removed = new Set(entry.changes.filter(c => !c.before).map(c => c.id));
        const gone = new Set(this.objects.filter(o => removed.has(o.id)));
        if (gone.size) for (const o of this.objects) if (!gone.has(o)) o.releaseConstraints(gone);
        const data = structuredClone(this.serialized);
        const pending = new Map(entry.changes.map(c => [c.id, c]));
        const objects = data.objects.flatMap(o => {
            const change = pending.get(o.id);
            if (!change) return [o];
            pending.delete(o.id);
            return change.before ? [change.before] : [];
        });
        // What the edit removed (or changed, and someone has removed since) comes back; its sort
        // puts it where it was.
        for (const c of pending.values()) if (c.before) objects.push(c.before);
        this.applyData({ ...data, objects: structuredClone(objects) });
        this.redraw();
        await this._saveData();
        this._stateInvalidated(state);
    }

    _captureState(): InterfaceState {
        return {
            selectedIds: this.objects.filter(o => o.isSelected).map(o => o.id)
        };
    }

    _stateInvalidated(state: InterfaceState) {
        this.setSelection(...this.objects.filter(o => state.selectedIds.includes(o.id)));

        this.tools[game.activeTool]?.stateInvalidated();        
    }

    get serialized(): LayerData {
        const objects = this.objects.map(o => o.serialized);
        return { objects, ...LineMapLayer.settingsOf(this) };
    }

    /** Save a change that is not undoable (the scene settings). */
    async dataChanged() {
        await this._saveData();
    }

    fetchData() {
        this.applyData(LineMapLayer.readFlag(canvas.scene));
        this.baseline = structuredClone(this.serialized);
    }

    /**
     * A map still in the old format moves to the new one when a Gamemaster views it: by the active
     * Gamemaster's client, so that two do not both write it, or by this one's if the active Gamemaster
     * is viewing another Scene. It used to move at its first edit,
     * which wrote the whole map: two Gamemasters' first edits at one moment each wrote it, and the
     * later put back what the earlier had deleted.
     */
    _migrateOnView() {
        const flag = canvas.scene?.flags?.linemap;
        if (!flag?.serialized || flag?.objects || !game.user.isGM) return;
        const active = game.users.activeGM;
        if (active?.isSelf || active?.viewedScene !== canvas.scene.id) this._saveData();
    }

    /**
     * Save what changed since the last save or load: only those objects, unless the map is still in
     * the old format.
     * - Saves go one at a time, each after the server has answered the one before. Foundry's client
     *   compares an update with its copy of the Scene, which an unanswered save has not reached yet,
     *   so an undo sent straight after its edit matched that copy and was never sent.
     * - Each changed object is sent whole (`diff: false`), not as its changed keys: a few keys
     *   merged into an object another Gamemaster had just deleted left a fragment of it.
     * - A save goes to the Scene it was made on, even if the canvas has moved on by the time it is
     *   sent.
     */
    async _saveData() {
        const scene = canvas.scene;
        const data = structuredClone(this.serialized);
        const from = this.baseline;
        this.baseline = structuredClone(data);
        this.pendingSaves++;
        const run = async () => {
            try {
                const flag = scene.flags?.linemap;
                const migrate = !flag?.objects && !!flag?.serialized;
                const update = { ...(LineMapLayer.flagUpdate(from, data, migrate) ?? {}), ...LineMapLayer.strayDeletions(scene) };
                if (!Object.keys(update).length) return;
                await scene.update(update, { diff: false });
                if (this.pendingSaves === 1 && scene === canvas.scene) this._takeSavedVersions(update);
            } catch (err) {
                // The edit never reached the Scene: show the map as the Scene holds it.
                console.error(err);
                ui.notifications.error(game.i18n.localize("linemap.error.saveFailed"));
                if (scene === canvas.scene) {
                    this.fetchData();
                    this.redraw();
                }
            } finally {
                this.pendingSaves--;
            }
        };
        const done = this.saveQueue.then(run);
        this.saveQueue = done;
        await done;
    }

    /**
     * After this client's last pending save is answered: an object it saved that the Scene now holds
     * differently was edited by another Gamemaster at the same moment, and the server merged the two.
     * Their save reached this canvas first and this one's was put on top of it, so take the Scene's.
     */
    _takeSavedVersions(update: Record<string, any>) {
        const prefix = "flags.linemap.objects.";
        const ids = Object.keys(update).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
        if (!ids.length) return;
        const saved = new Map((LineMapLayer.readFlag(canvas.scene)?.objects ?? []).map(o => [o.id, o]));
        const shown = new Map(this.serialized.objects.map(o => [o.id, o]));
        const differ = ids.filter(id => JSON.stringify(saved.get(id) ?? null) !== JSON.stringify(shown.get(id) ?? null));
        if (differ.length) this._mergeRemote({ objects: Object.fromEntries(differ.map(id => [id, true])) });
    }

    /**
     * Take in another user's save. Only the objects it names are replaced or removed, so an edit of
     * this client's that the server has not echoed yet stays on the canvas, and the baseline takes
     * them too, so the next save here does not send them back as this user's own.
     */
    _mergeRemote(changes: any) {
        // During a drag the tool holds the objects it moves; rebuilding them would leave it moving
        // copies no longer on the map, and the drop would save nothing. Take the save in after the drop.
        if (this.interactionData?.isDragging) {
            this.deferredMerges.push(changes);
            return;
        }
        const saved = LineMapLayer.readFlag(canvas.scene);
        const named = Object.keys(changes.objects ?? {}).map(k => k.replace(/^-=/, ""));
        // A save in the old format (an older build) or the move to the new one replaces the whole map.
        const whole = "serialized" in changes || "-=serialized" in changes || (!changes.objects && !changes.map);
        const state = this._captureState();
        if (whole) {
            this.applyData(saved);
            this.baseline = structuredClone(this.serialized);
        } else {
            const merge = (data: LayerData, byId: Map<string, ObjectData>): LayerData => {
                const objects = data.objects.filter(o => !named.includes(o.id));
                for (const id of named) if (byId.has(id)) objects.push(structuredClone(byId.get(id)));
                const settings = changes.map ? LineMapLayer.settingsOf(saved) : {};
                return { ...data, ...settings, objects };
            };
            this.applyData(merge(structuredClone(this.serialized), new Map((saved?.objects ?? []).map(o => [o.id, o]))));
            // The baseline takes the objects as the canvas now serialises them, not as saved: the two
            // can differ in form, and a difference would be saved back by the next edit as this user's.
            const loaded = new Map(this.serialized.objects.map(o => [o.id, o]));
            this.baseline = merge(this.baseline ?? { objects: [], color: LineMapLayer.defaultColor, isLightMode: false, symbolScale: 1 }, loaded);
        }
        this.redraw();
        this._stateInvalidated(state);
        if (whole || changes.map) ScenePropertiesApp.refresh();
    }

    /** Take in the saves that came in during a drag. */
    _flushMerges() {
        const merges = this.deferredMerges.splice(0);
        for (const changes of merges) this._mergeRemote(changes);
    }

    /**
     * Objects from their saved data, in drawing order, with their links resolved by id. Needs no
     * canvas, so the API builds a Scene's map with it whether the Scene is viewed or not.
     */
    static buildObjects(data: ObjectData[]): ObjectType[] {
        const sorted = [...data]
            .map((o, i) => ({ ...o, sort: o?.sort ?? i }))
            .sort(LineMapLayer.compareSort);
        const objectEntries: [ObjectType, ObjectData][] = sorted.map(o => [ObjectType.create(o), o]);
        // A link to an object of a type this build does not know is kept, and drawn at the point
        // saved with it (UnknownObject gives no point of its own).
        const objectMap = Object.fromEntries(objectEntries.map(([obj]) => [obj.id, obj]));
        objectEntries.forEach(([obj, data]) => obj.deserialize(data, objectMap));
        return objectEntries.map(o => o[0]);
    }

    applyData(data: LayerData) {
        if (data) {
            this.objects = LineMapLayer.buildObjects(data.objects ?? []);
            this.color = LineMapLayer.colorOf(data);
            this.symbolScale = data.symbolScale ?? 1.0;
            // Maps saved before the setting existed get the default font.
            this.labelFont = data.labelFont || LineMapLayer.defaultLabelFont;
            this.halo = !!data.halo;
            this.haloColor = LineMapLayer.haloColorOf(data.haloColor);
            this.theme = LineMapLayer.settingsOf(data).theme;
        } else {
            // A scene with no drawing yet starts from the defaults. The layer outlives scenes, so
            // without this the previous scene's colour and scale showed here and were saved into
            // this scene on its first edit.
            this.objects = [];
            this.color = LineMapLayer.defaultColor;
            this.symbolScale = 1.0;
            this.labelFont = LineMapLayer.defaultLabelFont;
            this.halo = false;
            this.haloColor = null;
            this.theme = null;
        }
    }

    static prepareSceneControls(): any {
        if (game.user.isGM) {
            return {
                name: "linemap",
                // After core's controls (0 to 8 in v14). Unset, core's sort compared against
                // undefined (NaN), so where Line Map landed was left to the sort.
                order: 9,
                title: "linemap.tools.control",
                layer: "linemap",
                icon: "fas fa-route",
                onChange: (event, active) => {
                    if (active) {
                        canvas.linemap.activate();
                    } else {
                        canvas.linemap.deactivate();
                    }
                },
                tools: {
                    selectObject: {
                        order: 1,
                        name: "selectObject",
                        title: "linemap.tools.selectObject",
                        icon: "fas fa-arrow-pointer",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("selectObject"); }
                    },
                    adjustObject: {
                        order: 2,
                        name: "adjustObject",
                        title: "linemap.tools.adjustObject",
                        icon: "fas fa-up-down-left-right",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("adjustObject"); }
                    },
                    drawLine: {
                        order: 3,
                        name: "drawLine",
                        title: "linemap.tools.drawLine",
                        icon: "fas fa-slash",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawLine"); }
                    },
                    drawSymbol: {
                        order: 4,
                        name: "drawSymbol",
                        title: "linemap.tools.drawSymbol",
                        icon: "fas fa-shapes",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawSymbol"); }
                    },
                    drawWaypoint: {
                        order: 5,
                        name: "drawWaypoint",
                        title: "linemap.tools.drawWaypoint",
                        icon: "fas fa-circle-nodes",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawWaypoint"); }
                    },
                    drawArea: {
                        order: 6,
                        name: "drawArea",
                        title: "linemap.tools.drawArea",
                        icon: "fas fa-vector-polygon",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawArea"); }
                    },
                    drawText: {
                        order: 7,
                        name: "drawText",
                        title: "linemap.tools.drawText",
                        icon: "fas fa-text",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawText"); }
                    },
                    drawImage: {
                        order: 8,
                        name: "drawImage",
                        title: "linemap.tools.drawImage",
                        icon: "fas fa-image",
                        visible: true,
                        onChange: (event, active) => { active && canvas.linemap.activateTool("drawImage"); }
                    },
                    clearObjects: {
                        order: 9,
                        name: "clearObjects",
                        title: "linemap.tools.trash",
                        icon: "fas fa-trash",
                        visible: true,
                        button: true,
                        onChange: async () => {
                            if (await foundry.applications.api.DialogV2.confirm({
                                window: { title: 'linemap.ui.confirmDeleteTitle' },
                                content: game.i18n.localize('linemap.ui.confirmDelete'),
                                modal: true
                            })) {
                                // clear() saves and records history; a redraw replaces the old
                                // _draw() call, which made a second set of textures and children.
                                const state = canvas.linemap._captureState();
                                canvas.linemap.clear();
                                canvas.linemap.redraw();
                                canvas.linemap._stateInvalidated(state);
                            }
                        }
                    },
                    newObjectsRevealed: {
                        order: 10,
                        name: "newObjectsRevealed",
                        title: "linemap.tools.newObjectsRevealed",
                        icon: "fas fa-eye",
                        toggle: true,
                        // Live state: the controls are rebuilt on every canvas draw.
                        active: canvas.linemap?.revealNewObjects ?? true,
                        onChange: (event, active) => {
                            canvas.linemap.revealNewObjects = active;
                        }
                    },
                    adjustLinked: {
                        order: 11,
                        name: "adjustLinked",
                        title: "linemap.tools.adjustLinked",
                        icon: "fas fa-arrows-left-right",
                        toggle: true,
                        active: canvas.linemap?.adjustLinked ?? true,
                        // onChange(event, active): the deprecated onClick is called with one
                        // argument, which left adjustLinked undefined.
                        onChange: (event, active) => {
                            canvas.linemap.adjustLinked = active;
                        }
                    },
                    linemapSettings: {
                        order: 12,
                        name: "linemapSettings",
                        title: "linemap.tools.settings",
                        icon: "fas fa-cog",
                        visible: true,
                        button: true,
                        onChange: () => {
                            ScenePropertiesApp.activate();
                        }
                    }
                },
                activeTool: "selectObject",
                visible: true
            };
        }
    }
}
