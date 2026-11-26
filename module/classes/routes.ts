import { Vec2 } from "../dto.js";
import { pathLength } from "../helpers/utils.js";
import { Line } from "../objects/line.js";
import { Symbol } from "../objects/symbol.js";
import { Waypoint } from "../objects/waypoint.js";
import { ObjectType } from "./object.js";

/** A stretch of a route: along one line, from one fraction of its length to another. */
export interface RouteSegment {
    line: Line;
    t0: number;
    t1: number;
}

export interface Route {
    /** The ids of the waypoints passed, in travel order. */
    waypoints: string[];
    /** The ids of the lines travelled, in travel order. */
    lines: string[];
    /** In canvas pixels. */
    length: number;
    segments: RouteSegment[];
    /** The route as drawn: a polyline from one end to the other. */
    points: Vec2[];
}

/**
 * The route between two symbols (or waypoints) along linked lines that passes the fewest waypoints,
 * since waypoints mark days of travel; of those, the shortest. null when no lines join them.
 *
 * The map is a graph. Its places are the symbols and waypoints, every point where a line ends on
 * another line, and each line's two ends; a line's end linked to a symbol, or to a point on another
 * line, is that same place. Each line is cut at the places on it into stretches, and a route is a
 * chain of stretches. Passing a place costs the waypoints standing there.
 */
export function findRoute(objects: ObjectType[], from: ObjectType, to: ObjectType): Route | null {
    if (!(from instanceof Symbol) || !(to instanceof Symbol) || from === to) return null;
    const parent = new Map<string, string>();
    const find = (k: string): string => {
        let r = k;
        while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
        if (!parent.has(k)) parent.set(k, k);
        // Path compression.
        for (let n = k; parent.get(n) !== r; ) { const next = parent.get(n); parent.set(n, r); n = next; }
        return r;
    };
    const union = (a: string, b: string) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    const symbolKey = (o: ObjectType) => `s:${o.id}`;
    // The places on each line, by fraction of its length.
    const stops = new Map<Line, Map<string, number>>();
    const lineKey = (line: Line, t: number) => {
        const tt = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1);
        const key = `l:${line.id}:${tt.toFixed(6)}`;
        if (!stops.has(line)) stops.set(line, new Map());
        stops.get(line).set(key, tt);
        return key;
    };
    const lines = objects.filter(o => o instanceof Line && o.points?.length >= 2) as Line[];
    const lineSet = new Set(lines);
    const isLine = (o: any): o is Line => o instanceof Line && lineSet.has(o);

    for (const line of lines) {
        const ends: [number, any][] = [[0, line.points[0]], [1, line.points[line.points.length - 1]]];
        for (const [t, cp] of ends) {
            const here = lineKey(line, t);
            const src = cp.sourceObject;
            if (src instanceof Symbol) union(here, symbolKey(src));
            else if (isLine(src)) union(here, lineKey(src, cp.sourceT ?? 0));
        }
    }
    const symbols = objects.filter(o => o instanceof Symbol) as Symbol[];
    for (const s of symbols) {
        find(symbolKey(s));
        const src = s.point?.sourceObject;
        if (isLine(src)) union(symbolKey(s), lineKey(src, s.point.sourceT ?? 0));
    }

    // Waypoints standing at each place.
    const waypointsAt = new Map<string, string[]>();
    for (const s of symbols) {
        if (!(s instanceof Waypoint)) continue;
        const r = find(symbolKey(s));
        waypointsAt.set(r, [...(waypointsAt.get(r) ?? []), s.id]);
    }

    // The stretches between consecutive places on each line.
    const edges = new Map<string, { to: string, segment: RouteSegment, length: number }[]>();
    const addEdge = (a: string, b: string, segment: RouteSegment, length: number) => {
        if (!edges.has(a)) edges.set(a, []);
        edges.get(a).push({ to: b, segment, length });
    };
    for (const [line, places] of stops) {
        const length = pathLength(line.centerline);
        const ts = [...places.entries()].sort((x, y) => x[1] - y[1]);
        for (let i = 0; i < ts.length - 1; i++) {
            const [ka, ta] = ts[i], [kb, tb] = ts[i + 1];
            const a = find(ka), b = find(kb);
            if (a === b) continue;
            const l = (tb - ta) * length;
            addEdge(a, b, { line, t0: ta, t1: tb }, l);
            addEdge(b, a, { line, t0: tb, t1: ta }, l);
        }
    }

    // Fewest waypoints, then shortest (Dijkstra on the pair).
    const start = find(symbolKey(from)), goal = find(symbolKey(to));
    if (start === goal) return { waypoints: [], lines: [], length: 0, segments: [], points: [from.point.point, to.point.point] };
    const best = new Map<string, [number, number]>([[start, [0, 0]]]);
    const prev = new Map<string, { from: string, segment: RouteSegment }>();
    const done = new Set<string>();
    const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 1e-6);
    while (true) {
        let u: string | null = null;
        for (const [k, c] of best) if (!done.has(k) && (u === null || less(c, best.get(u)))) u = k;
        if (u === null || u === goal) break;
        done.add(u);
        const [w, l] = best.get(u);
        // Passing a place costs its waypoints; the start and the goal cost nothing.
        const leave = u === start ? 0 : (waypointsAt.get(u)?.length ?? 0);
        for (const e of edges.get(u) ?? []) {
            if (done.has(e.to)) continue;
            const c: [number, number] = [w + leave, l + e.length];
            const old = best.get(e.to);
            if (!old || less(c, old)) {
                best.set(e.to, c);
                prev.set(e.to, { from: u, segment: e.segment });
            }
        }
    }
    if (!prev.has(goal)) return null;

    const segments: RouteSegment[] = [];
    const passed: string[] = [];
    for (let k = goal; k !== start; k = prev.get(k).from) {
        segments.unshift(prev.get(k).segment);
        if (k !== goal) passed.unshift(...(waypointsAt.get(k) ?? []));
    }
    const points: Vec2[] = [];
    for (const { line, t0, t1 } of segments) {
        const steps = line.smooth ? Math.max(2, Math.ceil(Math.abs(t1 - t0) * 40)) : 1;
        for (let i = points.length ? 1 : 0; i <= steps; i++) {
            const pt = line.getParametricPoint(t0 + (t1 - t0) * i / steps, line.pointType);
            if (pt) points.push([pt[0], pt[1]]);
        }
    }
    return {
        waypoints: passed,
        lines: [...new Set(segments.map(s => s.line.id))],
        length: best.get(goal)[1],
        segments,
        points
    };
}

/**
 * The route between the two symbols or waypoints the Gamemaster has selected, drawn over the map in
 * the selection colour with the count of waypoints it passes. It is this client's alone: nothing is
 * saved, and it shows only while the Line Map tools are in use.
 */
export class TravelRoutes {
    layer: any;
    container: any = null;
    /** What is shown: the two ends, and the route between them (null: none). */
    shown: { from: string, to: string, route: Route | null } | null = null;

    constructor(layer: any) {
        this.layer = layer;
    }

    /** The two ends of a route, when exactly two symbols or waypoints are selected. */
    get ends(): [Symbol, Symbol] | null {
        if (!this.layer.active) return null;
        const selection = this.layer.selection;
        if (selection.length !== 2 || !selection.every((o: any) => o instanceof Symbol)) return null;
        return selection as [Symbol, Symbol];
    }

    /** After every redraw: find the route for the selection, and draw it. */
    update() {
        this.clear();
        const ends = this.ends;
        if (!ends || !this.container) return;
        const [from, to] = ends;
        const route = findRoute(this.layer.objects, from, to);
        this.shown = { from: from.id, to: to.id, route };

        const color = this.layer._selectionColorHex;
        let at: Vec2;
        if (route && route.points.length > 1) {
            const g = new PIXI.Graphics();
            g.lineStyle({ width: 14, color, alpha: 0.5, join: "round", cap: "round" });
            g.moveTo(...route.points[0]);
            for (const pt of route.points.slice(1)) g.lineTo(...pt);
            this.container.addChild(g);
            at = this._halfway(route.points);
        } else {
            const [a, b] = [from.point.point, to.point.point];
            at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        }

        const light = this.layer.constructor.isLight(foundry.utils.Color.from(color).css);
        const text = new PIXI.Text(this.countText(route), {
            fontFamily: [this.layer.labelFont ?? "Alegreya", "serif"],
            fontSize: 30,
            fontWeight: "bold",
            fill: color,
            stroke: light ? 0x000000 : 0xffffff,
            strokeThickness: 6,
            lineJoin: "round"
        });
        text.anchor.set(0.5, 1);
        text.position.set(at[0], at[1] - 18);
        this.container.addChild(text);
        this.container.visible = true;
    }

    /** "3 waypoints", "1 waypoint", or "No route". */
    countText(route: Route | null): string {
        if (!route) return game.i18n.localize("linemap.route.none");
        const n = route.waypoints.length;
        const rule = new Intl.PluralRules(game.i18n.lang).select(n);
        const key = game.i18n.has(`linemap.route.${rule}`) ? `linemap.route.${rule}` : "linemap.route.other";
        return game.i18n.format(key, { n });
    }

    _halfway(points: Vec2[]): Vec2 {
        const total = pathLength(points);
        let left = total / 2;
        for (let i = 0; i < points.length - 1; i++) {
            const [a, b] = [points[i], points[i + 1]];
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (l && left <= l) return [a[0] + (b[0] - a[0]) * left / l, a[1] + (b[1] - a[1]) * left / l];
            left -= l;
        }
        return points[points.length - 1];
    }

    clear() {
        this.shown = null;
        if (!this.container || this.container.destroyed) return;
        this.container.removeChildren().forEach((c: any) => c.destroy(true));
        this.container.visible = false;
    }
}
