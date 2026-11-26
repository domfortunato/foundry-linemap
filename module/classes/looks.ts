import { LookOption } from "../apps/context-menu.js";
import { Area } from "../objects/area.js";
import { Line } from "../objects/line.js";
import { Symbol } from "../objects/symbol.js";
import { Waypoint } from "../objects/waypoint.js";
import { ObjectType } from "./object.js";

/**
 * An existing object's look, changed from the select tool's right-click menu (ROADMAP 7.5): a line's
 * style, a symbol's or a waypoint's kind, an area's pattern. Each kind of object names the field that
 * holds its look and the collection it is picked from, as its drawing tool offers it.
 */
const Kinds: Record<string, { field: string, options: (layer: any) => Record<string, any>, image: (entry: any) => string | undefined }> = {
    line: { field: "style", options: layer => layer.themed(CONFIG.linemap.lineStyles, "lineStyles"), image: e => e.icon },
    waypoint: { field: "symbol", options: () => CONFIG.linemap.waypoints, image: e => e.icon },
    symbol: { field: "symbol", options: layer => layer.themed(CONFIG.linemap.symbols, "symbols"), image: e => e.icon },
    area: { field: "pattern", options: () => CONFIG.linemap.patterns, image: e => e.texture }
};

const all: Record<string, () => Record<string, any>> = {
    line: () => CONFIG.linemap.lineStyles,
    waypoint: () => CONFIG.linemap.waypoints,
    symbol: () => CONFIG.linemap.symbols,
    area: () => CONFIG.linemap.patterns
};

export function lookKind(o: ObjectType): string | null {
    if (o instanceof Line) return "line";
    if (o instanceof Waypoint) return "waypoint";
    if (o instanceof Symbol) return "symbol";
    if (o instanceof Area) return "area";
    return null;
}

/** The menu's row of looks, for a selection all of one kind; none for a mixed one. */
export function lookOption(layer: any, selection: ObjectType[]): LookOption | undefined {
    const kind = selection.length ? lookKind(selection[0]) : null;
    if (!kind || !selection.every(o => lookKind(o) === kind)) return undefined;
    const { field, options, image } = Kinds[kind];
    const current = new Set(selection.map(o => (o as any)[field]));
    const entries: Record<string, any> = { ...options(layer) };
    // A selected object's own look stays on offer when the map's theme does not list it.
    for (const key of current) if (!(key in entries) && key in all[kind]()) entries[key] = all[kind]()[key];
    return {
        label: `linemap.menu.look.${kind}`,
        options: Object.entries(entries).map(([key, entry]) => ({
            key,
            label: entry.label ?? key,
            image: image(entry),
            lineWidth: entry.lineWidth ?? 4,
            area: kind === "area",
            wide: kind === "line",
            active: current.size === 1 && current.has(key)
        })),
        pick: (key: string) => setLook(layer, selection, key)
    };
}

/**
 * Give objects of one kind another look, as one edit. The map is rebuilt from its data, since a
 * line's style decides its class; ids, points and links are kept as they are.
 */
export async function setLook(layer: any, objects: ObjectType[], key: string) {
    const kind = objects.length ? lookKind(objects[0]) : null;
    if (!kind || !(key in all[kind]())) return;
    const field = Kinds[kind].field;
    const ids = new Set(objects.filter(o => lookKind(o) === kind && (o as any)[field] !== key).map(o => o.id));
    if (!ids.size) return;
    const state = layer._captureState();
    const data = structuredClone(layer.serialized);
    for (const o of data.objects) if (ids.has(o.id)) (o as any)[field] = key;
    layer.applyData(data);
    layer.redraw();
    await layer.registerHistory();
    layer._stateInvalidated(state);
}
