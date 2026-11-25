import { ObjectData, ObjectType, UnknownObject } from "./classes/object.js";
import { Tool, ToolHotkey } from "./classes/tool.js";
import { Vec2, SnapType, SnapPoint } from "./dto.js";
import { length2, sub2 } from "./helpers/utils.js";
import { DrawLineTool } from "./tools/draw-line.js";
import { DrawSymbolTool } from "./tools/draw-symbol.js";
import { DrawWaypointTool } from "./tools/draw-waypoint.js";
import { DrawAreaTool } from "./tools/draw-area.js";
import { DrawTextTool } from "./tools/draw-text.js";
import { SelectTool } from "./tools/select-tool.js";
import { AdjustTool } from "./tools/adjust-tool.js";
import { ScenePropertiesApp } from "./apps/scene-properties.js";

const { layers } = foundry.canvas;

interface LayerData {
    objects: ObjectData[];
    isLightMode: boolean;
    symbolScale: number;
    labelFont?: string;
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

    tools: Record<string, Tool> = {};
    activeTool: Tool;
    revealNewObjects = true;
    adjustLinked = true;

    symbolTextures: TextureCollection = {};
    waypointTextures: TextureCollection = {};
    patternTextures: TextureCollection = {};

    isLightMode = false;
    symbolScale = 1.0;
    labelFont = LineMapLayer.defaultLabelFont;

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
            drawText: new DrawTextTool(this)
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
            if (obj === canvas.scene && updates.flags?.linemap && userId !== game.user.id) {
                this._mergeRemote(updates.flags.linemap);
            }
        });

        // A canvas draw restores the active layer (layerOptions.name) and only afterwards clears every
        // stage listener (Canvas#addListeners: stage.removeAllListeners()), then fires canvasReady. So
        // when this layer is the one restored, its handlers are put back here.
        Hooks.on("canvasReady", () => {
            if (this.active) this._attachStageHandlers();
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
     *   format, all at once, the first time it is saved.
     */
    static readFlag(scene: any): LayerData | undefined {
        const flag = scene?.flags?.linemap;
        if (flag?.objects) {
            const objects = Object.values(flag.objects as Record<string, ObjectData>)
                .filter(o => o && typeof o === "object")
                .sort(LineMapLayer.compareSort);
            return { ...(flag.map ?? {}), objects };
        }
        const old = flag?.serialized;
        if (!old) return undefined;
        return { ...old, objects: (old.objects ?? []).map((o, i) => ({ ...o, sort: o?.sort ?? i })) };
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
        const settings = { isLightMode: to.isLightMode, symbolScale: to.symbolScale, labelFont: to.labelFont };
        const oldSettings = from && { isLightMode: from.isLightMode, symbolScale: from.symbolScale, labelFont: from.labelFont };
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
        this.clearTool();
        this.activeTool = this.tools[tool];
        this.activeTool?.activate();
        this.redraw();
    }

    clearTool() {
        this.activeTool?.deactivate();
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
        const size = { width: canvas.dimensions.width, height: canvas.dimensions.height };
        this.renderTexture = PIXI.RenderTexture.create(size);
        this.lineTexture = PIXI.RenderTexture.create(size);
        this.maskTexture = PIXI.RenderTexture.create(size);
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
        `, { screenDimensions: [this.renderTexture.width, this.renderTexture.height] });

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

        // In the primary group, sit just above the background of the level being viewed: v14 draws
        // each level's background at that level's bottom elevation, so at elevation 0 a raised
        // level's background covered the map. Tiles, drawings and tokens there stay above it, as on
        // the ground level. Viewing another level redraws the canvas, which runs this again.
        this.elevation = canvas.level?.elevation?.bottom ?? 0;
        this.sortLayer = foundry.canvas.groups?.PrimaryCanvasGroup?.SORT_LAYERS?.SCENE ?? 0;
        this.sort = 1;
        if (this.parent) this.parent.sortDirty = true;

        this.objectContainer = new PIXI.Container();

        this.renderSprite = this.addChild(new PIXI.Sprite(this.renderTexture));

        this.preview = this.addChild(new PIXI.Container());

        this.fetchData();
        this.redraw();

        this.visible = true;
    }

    redraw(highQuality = true) {
        // Nothing to draw into before the canvas has drawn this layer (_draw makes the targets).
        if (!this.renderTexture) return;
        this._disposeDrawn();

        const layers = {
            areas: new PIXI.Container(),
            lines: new PIXI.Container(),
            footprints: new PIXI.Container(),
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
        // What is rendered as "symbols": both tints, then the labels above them.
        const symbols = new PIXI.Container();
        symbols.addChild(layers.symbols, layers.selectedSymbols, layers.labels);

        this.drawn = [layers.areas, layers.lines, layers.footprints, symbols];

        if (!highQuality) {
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

        canvas.app.renderer.render(layers.areas, { renderTexture: this.renderTexture, clear: true });
        canvas.app.renderer.render(lineContainer, { renderTexture: this.renderTexture, clear: false });
        canvas.app.renderer.render(symbols, { renderTexture: this.renderTexture, clear: false });
    }

    assetsLoaded() {
        this.activeTool?.deactivate();
        this.activeTool?.activate();
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
        return [
            (CONFIG.Canvas.dispositionColors.CONTROLLED >> 16 & 0xff) / 256,
            (CONFIG.Canvas.dispositionColors.CONTROLLED >> 8 & 0xff) / 256,
            (CONFIG.Canvas.dispositionColors.CONTROLLED & 0xff) / 256
        ]
    }

    get _selectionColorHex(): number {
        return CONFIG.Canvas.dispositionColors.CONTROLLED;
    }

    get _objectColor(): [number, number, number] {
        return this.isLightMode ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0];
    }

    get _objectColorHex(): number {
        return this.isLightMode ? 0xffffff : 0x0;
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

    _leftMouseDown(event) {
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
                    this.tools[game.activeTool]?.onDragLeftDrop(event);
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
        this.interactionData = undefined;
        this.interactionDataRight = undefined;
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
        const isLightMode = this.isLightMode;
        const symbolScale = this.symbolScale;
        const labelFont = this.labelFont;
        return { objects, isLightMode, symbolScale, labelFont };
    }

    /** Save a change that is not undoable (the scene settings). */
    async dataChanged() {
        await this._saveData();
    }

    fetchData() {
        this.applyData(LineMapLayer.readFlag(canvas.scene));
        this.baseline = structuredClone(this.serialized);
    }

    /** Save what changed since the last save or load: only those objects, unless the map is still in the old format. */
    async _saveData() {
        const data = structuredClone(this.serialized);
        const from = this.baseline;
        this.baseline = structuredClone(data);
        const flag = canvas.scene.flags?.linemap;
        const migrate = !flag?.objects && !!flag?.serialized;
        const update = LineMapLayer.flagUpdate(from, data, migrate);
        if (update) await canvas.scene.update(update);
    }

    /**
     * Take in another user's save. Only the objects it names are replaced or removed, so an edit of
     * this client's that the server has not echoed yet stays on the canvas, and the baseline takes
     * them too, so the next save here does not send them back as this user's own.
     */
    _mergeRemote(changes: any) {
        const saved = LineMapLayer.readFlag(canvas.scene);
        const named = Object.keys(changes.objects ?? {}).map(k => k.replace(/^-=/, ""));
        // A save in the old format (an older build) or the move to the new one replaces the whole map.
        const whole = "serialized" in changes || "-=serialized" in changes || (!changes.objects && !changes.map);
        const state = this._captureState();
        if (whole) {
            this.applyData(saved);
            this.baseline = structuredClone(this.serialized);
        } else {
            const byId = new Map((saved?.objects ?? []).map(o => [o.id, o]));
            const merge = (data: LayerData): LayerData => {
                const objects = data.objects.filter(o => !named.includes(o.id));
                for (const id of named) if (byId.has(id)) objects.push(structuredClone(byId.get(id)));
                const settings = changes.map ? { isLightMode: saved.isLightMode, symbolScale: saved.symbolScale, labelFont: saved.labelFont } : {};
                return { ...data, ...settings, objects };
            };
            this.baseline = merge(this.baseline ?? { objects: [], isLightMode: false, symbolScale: 1 });
            this.applyData(merge(structuredClone(this.serialized)));
        }
        this.redraw();
        this._stateInvalidated(state);
    }

    applyData(data: LayerData) {
        if (data) {
            // this.quadtree.clear();
            const sorted = [...(data.objects ?? [])]
                .map((o, i) => ({ ...o, sort: o?.sort ?? i }))
                .sort(LineMapLayer.compareSort);
            const objectEntries: [ObjectType, ObjectData][] = sorted.map(o => [ObjectType.create(o), o]);
            // Links resolve only to objects this build can draw; a link to an unknown one falls
            // back to the point saved with it.
            const objectMap = objectEntries?.reduce((acc, obj) => {
                if (!(obj[0] instanceof UnknownObject)) acc[obj[0].id] = obj[0];
                return acc;
            }, {}) ?? {};
            objectEntries?.forEach(([obj, data]: [ObjectType, ObjectData]) => obj.deserialize(data, objectMap));
            this.objects = objectEntries?.map(o => o[0]) ?? [];
            this.isLightMode = !!data.isLightMode;
            this.symbolScale = data.symbolScale ?? 1.0;
            // Maps saved before the setting existed get the default font.
            this.labelFont = data.labelFont || LineMapLayer.defaultLabelFont;
        } else {
            // A scene with no drawing yet starts from the defaults. The layer outlives scenes, so
            // without this the previous scene's colour and scale showed here and were saved into
            // this scene on its first edit.
            this.objects = [];
            this.isLightMode = false;
            this.symbolScale = 1.0;
            this.labelFont = LineMapLayer.defaultLabelFont;
        }
    }

    static prepareSceneControls(): any {
        if (game.user.isGM) {
            return {
                name: "linemap",
                // After core's controls (0 to 8 in v14). Unset, core's sort compared against
                // undefined (NaN), so where Line Map landed was left to the sort.
                order: 9,
                title: "Line Map",
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
                    clearObjects: {
                        order: 8,
                        name: "clearObjects",
                        title: "linemap.tools.trash",
                        icon: "fas fa-trash",
                        visible: true,
                        button: true,
                        onChange: async () => {
                            if (await foundry.applications.api.DialogV2.confirm({
                                content: game.i18n.localize('linemap.ui.confirmDelete'),
                                rejectClose: false,
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
                        order: 9,
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
                        order: 10,
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
                        order: 11,
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
