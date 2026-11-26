import { ObjectData, ObjectType } from "./classes/object.js";
import { Vec2 } from "./dto.js";
import { generateId } from "./helpers/generate-id.js";
import { LineMapLayer } from "./linemap-layer.js";
import { findRoute } from "./classes/routes.js";

/** Where an edit or a read applies: a Scene document or its id. The viewed Scene when left out. */
interface SceneOption {
    scene?: any;
}

/** A point given to a builder: a position, or an object's id to link to. */
type PointOrId = Vec2 | string;

/** The parts of an object's data every builder takes. */
interface Common {
    /** Whether players see the object; true when left out. */
    revealed?: boolean;
    /** The object's id; a new one is made when left out. */
    id?: string;
}

/**
 * The scripting API, at `game.modules.get("linemap").api` (README, "Scripting").
 *
 * - Reading: `objects` and `get` hand back copies of a Scene's saved objects; `route` finds the travel
 *   route between two symbols.
 * - Editing: `add`, `update`, `delete`, `hide` and `reveal`. On the viewed Scene an edit is drawn at
 *   once and goes through the tools' undo record, so the tools see the objects and Ctrl+Z (or `undo`)
 *   takes the edit back. Another Scene's map is saved directly, without an undo record.
 * - Building: `symbol`, `waypoint`, `line`, `label`, `area` and `image` make an object's data, for
 *   `add`. Lines, labels and waypoints link to objects by id, and follow them as they move.
 *
 * Only a user who may update the Scene (a Gamemaster) can edit it; anything else is refused before
 * anything is saved.
 */
export class LineMapApi {
    // ---- reading

    /** Copies of every object saved on a Scene's map, in drawing order. */
    objects(options: SceneOption | string = {}): ObjectData[] {
        const scene = this._scene(options);
        return structuredClone(this._current(scene).objects);
    }

    /** A copy of one object's saved data, or null. */
    get(id: string, options: SceneOption | string = {}): ObjectData | null {
        return this.objects(options).find(o => o.id === id) ?? null;
    }

    /**
     * The travel route between two symbols or waypoints, by id: along linked lines, passing the
     * fewest waypoints, then the shortest. The ids of the waypoints passed and of the lines
     * travelled, in order, and its length in pixels; null when no lines join them.
     */
    route(from: string, to: string, options: SceneOption | string = {}): { waypoints: string[], lines: string[], length: number } | null {
        const scene = this._scene(options);
        const objects: ObjectType[] = this._viewed(scene)
            ? canvas.linemap.objects
            : LineMapLayer.buildObjects(this._current(scene).objects);
        const route = findRoute(objects, objects.find(o => o.id === from), objects.find(o => o.id === to));
        return route ? { waypoints: route.waypoints, lines: route.lines, length: route.length } : null;
    }

    // ---- editing

    /** Put objects (data from the builders, or saved data) on a map; their ids, in the order given. */
    async add(data: ObjectData | ObjectData[], options: SceneOption = {}): Promise<string[]> {
        const list = (Array.isArray(data) ? data : [data]).map(d => structuredClone(d));
        const ids: string[] = [];
        await this._edit(options, (objects) => {
            const taken = new Set(objects.map(o => o.id));
            let sort = objects.reduce((m, o) => Math.max(m, o.sort ?? 0), 0);
            for (const d of list) {
                if (!d || typeof d !== "object") throw new Error("Line Map: add takes an object's data");
                if (!d.id || taken.has(d.id)) d.id = generateId();
                taken.add(d.id);
                d.sort = ++sort;
                d.isRevealed = d.isRevealed !== false;
                ids.push(d.id);
            }
            return [...objects, ...list];
        });
        return ids;
    }

    /**
     * Change objects: each change names an object by `id` and is merged into its data (so
     * `{ id, point: { point: [x, y] } }` moves a symbol). Their ids.
     */
    async update(changes: (Partial<ObjectData> & { id: string }) | (Partial<ObjectData> & { id: string })[], options: SceneOption = {}): Promise<string[]> {
        const list = Array.isArray(changes) ? changes : [changes];
        await this._edit(options, (objects) => {
            const byId = new Map(objects.map(o => [o.id, o]));
            for (const change of list) {
                const old = byId.get(change?.id);
                if (!old) throw new Error(`Line Map: there is no object ${change?.id} to update`);
                if (change.type && change.type !== old.type) throw new Error("Line Map: update cannot change an object's type");
                byId.set(old.id, foundry.utils.mergeObject(structuredClone(old), structuredClone(change), { inplace: false }));
            }
            return objects.map(o => byId.get(o.id));
        });
        return list.map(c => c.id);
    }

    /** Remove objects. A point linked to one of them stays where it is, unlinked, as with the tools. */
    async delete(ids: string | string[], options: SceneOption = {}): Promise<void> {
        const gone = new Set(Array.isArray(ids) ? ids : [ids]);
        await this._edit(options, (objects) => objects.filter(o => !gone.has(o.id)), gone);
    }

    async hide(ids: string | string[], options: SceneOption = {}): Promise<void> {
        await this._reveal(ids, false, options);
    }

    async reveal(ids: string | string[], options: SceneOption = {}): Promise<void> {
        await this._reveal(ids, true, options);
    }

    /** Take back this user's last edit on the viewed Scene, as Ctrl+Z does. */
    async undo(): Promise<void> {
        await canvas.linemap?.undo();
    }

    // ---- building

    /** A symbol at a point. `symbol` is a CONFIG.linemap.symbols key; size 1 to 4; `link` a document's UUID. */
    symbol({ x, y, symbol, size, link, revealed, id }: { x: number, y: number, symbol?: string, size?: number, link?: string } & Common): ObjectData {
        return {
            ...this._common("symbol", revealed, id),
            point: { point: [x, y], sourceId: null, sourceT: null },
            symbol: symbol ?? Object.keys(CONFIG.linemap.symbols)[0],
            size: size ?? null,
            link: link ?? null
        } as ObjectData;
    }

    /** A waypoint on a line, at `t` along it (0 its start, 1 its end). */
    waypoint({ line, t, symbol, size, link, revealed, id }: { line: string, t?: number, symbol?: string, size?: number, link?: string } & Common): ObjectData {
        return {
            ...this._common("waypoint", revealed, id),
            point: { point: null, sourceId: line, sourceT: t ?? 0.5 },
            symbol: symbol ?? Object.keys(CONFIG.linemap.waypoints)[0],
            size: size ?? null,
            link: link ?? null
        } as ObjectData;
    }

    /**
     * A line from one point to another, each a position or an object's id to link to. With `via`
     * (positions between), or `smooth`, it is a smooth curve through them all.
     */
    line({ from, to, via, style, smooth, revealed, id }: { from: PointOrId, to: PointOrId, via?: Vec2[], style?: string, smooth?: boolean } & Common): ObjectData {
        const points = [this._point(from), ...(via ?? []).map(pt => this._point(pt)), this._point(to)];
        return {
            ...this._common("line", revealed, id),
            points,
            style: style ?? Object.keys(CONFIG.linemap.lineStyles)[0],
            smooth: points.length > 2 || smooth ? true : null
        } as ObjectData;
    }

    /**
     * A label: at a point (`x`, `y`), or `on` an object (by id), linked to it and moved by `offset`
     * (above it when left out). `t` places it along a line it is on. Style: normal, bold, italic,
     * bolditalic; size 0.5 to 4.
     */
    label({ text, x, y, on, t, offset, style, size, link, revealed, id }: { text: string, x?: number, y?: number, on?: string, t?: number, offset?: Vec2, style?: string, size?: number, link?: string } & Common): ObjectData {
        return {
            ...this._common("text", revealed, id),
            point: on ? { point: null, sourceId: on, sourceT: t ?? 0.5 } : { point: [x, y], sourceId: null, sourceT: null },
            offset: offset ?? (on ? [0, -50] : [0, 0]),
            text: String(text ?? ""),
            style: style ?? "normal",
            size: size ?? null,
            link: link ?? null
        } as ObjectData;
    }

    /** An area: a polygon of three or more points, filled with a CONFIG.linemap.patterns pattern. */
    area({ points, pattern, revealed, id }: { points: Vec2[], pattern?: string } & Common): ObjectData {
        return {
            ...this._common("area", revealed, id),
            points: points?.map(pt => [pt[0], pt[1]]),
            pattern: pattern ?? Object.keys(CONFIG.linemap.patterns)[0]
        } as ObjectData;
    }

    /** A picture under the map's lines: at `x`, `y`, `width`, `height`, or with `fit`, covering the Scene. */
    image({ src, x, y, width, height, fit, revealed, id, scene }: { src: string, x?: number, y?: number, width?: number, height?: number, fit?: boolean, scene?: any } & Common): ObjectData {
        let rect = [x, y, width, height];
        if (fit) {
            const s = this._scene({ scene }).dimensions.sceneRect;
            rect = [s.x, s.y, s.width, s.height];
        }
        return { ...this._common("image", revealed, id), src, rect, rotation: null } as ObjectData;
    }

    // ---- internals

    _common(type: string, revealed: boolean | undefined, id: string | undefined): ObjectData {
        return { id: id ?? generateId(), type, isRevealed: revealed !== false };
    }

    _point(pt: PointOrId) {
        return typeof pt === "string"
            ? { point: null, sourceId: pt, sourceT: 0 }
            : { point: [pt[0], pt[1]], sourceId: null, sourceT: null };
    }

    async _reveal(ids: string | string[], revealed: boolean, options: SceneOption) {
        const list = Array.isArray(ids) ? ids : [ids];
        await this.update(list.map(id => ({ id, isRevealed: revealed })), options);
    }

    _scene(options: SceneOption | string | undefined): any {
        const given = typeof options === "string" ? options : options?.scene;
        const scene = typeof given === "string" ? game.scenes.get(given) : given ?? canvas.scene;
        if (!scene) throw new Error("Line Map: there is no such Scene");
        return scene;
    }

    _viewed(scene: any): boolean {
        return scene === canvas.scene && !!canvas.linemap?.objectContainer;
    }

    /** A Scene's map as saved, or as the canvas holds it when viewed (with edits not yet saved). */
    _current(scene: any): { objects: ObjectData[], [key: string]: any } {
        if (this._viewed(scene)) return structuredClone(canvas.linemap.serialized);
        const saved = LineMapLayer.readFlag(scene);
        return structuredClone(saved ?? { objects: [], ...LineMapLayer.settingsOf({}) });
    }

    /**
     * One edit of a map: `change` takes the objects' data and gives the new list. `gone` names
     * objects being removed, whose linked points are pinned first. The result is built into objects
     * and checked before anything is saved; then the viewed Scene's layer takes it (drawn, recorded
     * for undo, saved), or another Scene's flag is updated.
     */
    async _edit(options: SceneOption, change: (objects: ObjectData[]) => ObjectData[], gone?: Set<string>) {
        const scene = this._scene(options);
        if (!scene.canUserModify(game.user, "update")) {
            throw new Error(`Line Map: ${game.user.name} may not edit the map of ${scene.name}`);
        }
        const current = this._current(scene);
        let objects = current.objects;
        if (gone?.size) {
            const built = LineMapLayer.buildObjects(objects);
            const removed = new Set(built.filter(o => gone.has(o.id)));
            for (const o of built) if (!removed.has(o)) o.releaseConstraints(removed);
            objects = built.map(o => o.serialized);
        }
        const before = new Map(objects.map(o => [o.id, JSON.stringify(o)]));
        const next = change(objects);
        let built: ObjectType[];
        try {
            built = LineMapLayer.buildObjects(next);
        } catch (err) {
            throw new Error(`Line Map: an object's data could not be read (${err?.message ?? err})`);
        }
        // Only what this edit adds or changes: a map may hold another build's objects, kept as they are.
        const byId = new Map(next.map(d => [d.id, d]));
        for (const o of built) {
            const d = byId.get(o.id);
            if (before.get(o.id) !== JSON.stringify(d)) LineMapApi._check(o, d);
        }
        // A point given as a link only is saved with the point it is linked to, as the tools save it.
        for (const o of built) {
            for (const cp of o.constrainedPoints) {
                if (cp && !cp.unconstrainedPoint && cp.sourceObject) {
                    const pt = cp.point;
                    if (pt) cp.unconstrainedPoint = [pt[0], pt[1]];
                }
            }
        }
        const data = { ...current, objects: built.map(o => o.serialized) };

        if (this._viewed(scene)) {
            const layer = canvas.linemap;
            const state = layer._captureState();
            layer.applyData(data);
            layer.redraw();
            await layer.registerHistory();
            layer._stateInvalidated(state);
            return;
        }
        const from = LineMapLayer.readFlag(scene);
        const flag = scene.flags?.linemap;
        const migrate = !flag?.objects && !!flag?.serialized;
        const update = LineMapLayer.flagUpdate(from, data as any, migrate);
        if (update) await scene.update(update, { diff: false });
    }

    /** Refuse an object this build cannot draw: an unknown type, or one missing what it is drawn from. */
    static _check(o: ObjectType, data: any) {
        const type = data?.type;
        if (!CONFIG.linemap.objectTypes[type]) throw new Error(`Line Map: unknown object type "${type}"`);
        const isPoint = (pt: any) => Array.isArray(pt) && pt.length === 2 && pt.every((v: any) => Number.isFinite(v));
        const cps = o.constrainedPoints;
        for (const cp of cps) {
            if (!cp || (!cp.sourceObject && !isPoint(cp.unconstrainedPoint))) {
                throw new Error(`Line Map: a ${type} needs a point, or the id of an object on the map to link to`);
            }
        }
        if (type === "line" && cps.length < 2) throw new Error("Line Map: a line needs two points");
        if (type === "area" && !(Array.isArray(data.points) && data.points.length >= 3 && data.points.every(isPoint))) {
            throw new Error("Line Map: an area needs three or more points");
        }
        if (type === "image" && !(typeof data.src === "string" && data.src && Array.isArray(data.rect) && data.rect.length === 4 && data.rect.every((v: any) => Number.isFinite(v)))) {
            throw new Error("Line Map: an image needs a src and a rect [x, y, width, height]");
        }
    }
}
