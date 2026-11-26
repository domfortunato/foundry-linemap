import { Vec2 } from "../dto.js";
import { generateId } from "../helpers/generate-id.js";
import { ObjectData, ObjectType } from "./object.js";

/**
 * Copy, cut, paste and duplicate (ROADMAP 7.7). What is copied is the selection's data: the links
 * among the copied objects are kept, and a point linked to an object outside the selection is pinned
 * where it is. The clipboard is this client's, kept while the page is open, so a copy can be pasted
 * into another Scene.
 */
export class MapClipboard {
    static objects: ObjectData[] | null = null;

    /** The data of some of a map's objects, without links to the rest. */
    static copyOf(layer: any, selection: ObjectType[]): ObjectData[] {
        const ids = new Set(selection.map(o => o.id));
        // Copies, built from the map's data, so the map's own objects are not touched.
        const built: ObjectType[] = layer.constructor.buildObjects(structuredClone(layer.serialized.objects));
        const outside = new Set(built.filter(o => !ids.has(o.id)));
        const kept = built.filter(o => ids.has(o.id));
        for (const o of kept) {
            o.releaseConstraints(outside);
            // A linked point is saved with where it is, so a paste can move it with the rest.
            for (const cp of o.constrainedPoints) {
                const pt = cp?.sourceObject ? cp.point : undefined;
                if (pt) cp.unconstrainedPoint = [pt[0], pt[1]];
            }
        }
        return structuredClone(kept.map(o => o.serialized));
    }

    /**
     * Copied data made ready to add to a map: new ids, links among the objects following them, drawn
     * above everything from `sort` up, and moved, either by `offset` or so the middle of the group is
     * at `at`.
     */
    static place(objects: ObjectData[], { at, offset, sort }: { at?: Vec2, offset?: Vec2, sort: number }): ObjectData[] {
        const ids = new Map(objects.map(o => [o.id, generateId()]));
        const relink = (v: any): any => {
            if (Array.isArray(v)) return v.map(relink);
            if (!v || typeof v !== "object") return v;
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "sourceId" && ids.has(x as string) ? ids.get(x as string) : relink(x)]));
        };
        const typeOf = (o: ObjectData) => CONFIG.linemap.objectTypes[o.type];
        let d: Vec2 = offset ?? [0, 0];
        if (at) {
            const pts: Vec2[] = [];
            for (const o of objects) typeOf(o)?.moveData(o, (pt: Vec2) => { pts.push(pt); return pt; });
            if (pts.length) {
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
                d = [at[0] - (Math.min(...xs) + Math.max(...xs)) / 2, at[1] - (Math.min(...ys) + Math.max(...ys)) / 2];
            }
        }
        const move = (pt: Vec2): Vec2 => [Math.round(pt[0] + d[0]), Math.round(pt[1] + d[1])];
        return objects.map((o, i) => {
            const moved = typeOf(o)?.moveData(structuredClone(o), move) ?? structuredClone(o);
            return { ...relink(moved), id: ids.get(o.id), sort: sort + i };
        });
    }
}
