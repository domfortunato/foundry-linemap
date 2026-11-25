import { Vec2 } from "../dto.js";

export function compareDistance(pt1: Vec2, pt2: Vec2, ref: number): number {
    return (pt1[0] - pt2[0]) * (pt1[0] - pt2[0]) + (pt1[1] - pt2[1]) * (pt1[1] - pt2[1]) - ref * ref;
}

export function absAngle(pt1: Vec2, pt2: Vec2, pt3: Vec2): number {
    const dAx = pt2[0] - pt1[0];
    const dAy = pt2[1] - pt1[1];
    const dBx = pt3[0] - pt2[0];
    const dBy = pt3[1] - pt2[1];
    let angle = Math.atan2(dAx * dBy - dAy * dBx, dAx * dBx + dAy * dBy);
    if (angle < 0) { angle = angle * -1; }
    return angle;
}

export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 {
    const det = d1[0] * d2[1] - d2[0] * d1[1];
    if (det === 0) {
        return null;
    }

    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / det;

    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

export function distanceToLine(testPt: Vec2, linePt1: Vec2, linePt2: Vec2, allowNonparallel = false): number {
    const d = sub2(linePt2, linePt1);
    const [l, u] = lengthAndUnitVector(d);
    const n = normal(u);

    const cmp = sub2(testPt, linePt1);
    const parallel = dotProduct(u, cmp);
    const perpendicular = dotProduct(n, cmp);

    if (parallel >= 0 && parallel <= l) {
        return Math.abs(perpendicular);
    } else if (allowNonparallel) {
        if (parallel < 0) {
            return length2(cmp);
        } else {
            return length2(sub2(testPt, linePt2));
        }
    }
}

export function length2(v: Vec2): number {
    return Math.sqrt(v[0]*v[0]+v[1]*v[1]);
}

export function normalize(v: Vec2): Vec2 {
    const l = length2(v);
    return [v[0]/l, v[1]/l];
}

export function lengthAndUnitVector(v: Vec2): [number, Vec2] {
    const l = length2(v);
    return [l, [v[0]/l, v[1]/l]];
}

export function normal(v: Vec2): Vec2 {
    return [-v[1], v[0]];
}

export function dotProduct(a: Vec2, b: Vec2): number {
    return a[0] * b[0] + a[1] * b[1]
}

export function add2(...v: Vec2[]): Vec2 {
    return [v.reduce((a, b) => a + b[0], 0), v.reduce((a, b) => a + b[1], 0)];
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
    return [a[0] - b[0], a[1] - b[1]];
}

export function mult2(a: Vec2, c: number): Vec2 {
    return [a[0] * c, a[1] * c];
}

export function div2(a: Vec2, c: number): Vec2 {
    return [a[0] / c, a[1] / c];
}

export function eq2(a: Vec2, b: Vec2): boolean {
    return a && b && a[0] == b[0] && a[1] == b[1];
}

export function vec2fromXY({ x, y }: { x: number, y: number }): Vec2 {
    return [x, y];
}

export function intersectAabb(box1: Vec2[], box2: Vec2[]): boolean {
    const [x1min, y1min] = box1[0];
    const [x1max, y1max] = box1[1];
    const [x2min, y2min] = box2[0];
    const [x2max, y2max] = box2[1];

    const intersectX = (x1min <= x2max && x1max >= x2min);
    const intersectY = (y1min <= y2max && y1max >= y2min);

    return intersectX && intersectY;
}

export function containsAabb(point: Vec2, box: Vec2[]): boolean {
    const [x1min, y1min] = box[0];
    const [x1max, y1max] = box[1];

    const intersectX = (x1min <= point[0] && x1max >= point[0]);
    const intersectY = (y1min <= point[1] && y1max >= point[1]);

    return intersectX && intersectY;
}

export function lineIntersectsBox(points: Vec2[], box: Vec2[]): boolean {
    const [p1, p2] = points;
    const [ [xMin, yMin], [xMax, yMax] ] = box;

    function onSegment(p, q, r) {
        return (q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) &&
                q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]));
    }

    function orientation(p, q, r) {
        const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
        if (val === 0) return 0;
        return (val > 0) ? 1 : 2;
    }

    function doIntersect(p1, p2, q1, q2) {
        const o1 = orientation(p1, p2, q1);
        const o2 = orientation(p1, p2, q2);
        const o3 = orientation(q1, q2, p1);
        const o4 = orientation(q1, q2, p2);

        if (o1 !== o2 && o3 !== o4) return true;

        if (o1 === 0 && onSegment(p1, q1, p2)) return true;
        if (o2 === 0 && onSegment(p1, q2, p2)) return true;
        if (o3 === 0 && onSegment(q1, p1, q2)) return true;
        if (o4 === 0 && onSegment(q1, p2, q2)) return true;

        return false;
    }

    const boxEdges = [
        [[xMin, yMin], [xMax, yMin]],
        [[xMax, yMin], [xMax, yMax]],
        [[xMax, yMax], [xMin, yMax]],
        [[xMin, yMax], [xMin, yMin]],
    ];

    for (let edge of boxEdges) {
        if (doIntersect(p1, p2, edge[0], edge[1])) {
            return true;
        }
    }

    return (p1[0] >= xMin && p1[0] <= xMax && p1[1] >= yMin && p1[1] <= yMax) ||
           (p2[0] >= xMin && p2[0] <= xMax && p2[1] >= yMin && p2[1] <= yMax);
}
/** Ramer–Douglas–Peucker: the points of a polyline that keep it within `epsilon` of the original. */
export function simplifyPath(points: Vec2[], epsilon: number): Vec2[] {
    if (points.length < 3) return [...points];
    const [a, b] = [points[0], points[points.length - 1]];
    let worst = -1, index = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = eq2(a, b) ? length2(sub2(points[i], a)) : distanceToLine(points[i], a, b, true);
        if (d > worst) { worst = d; index = i; }
    }
    if (worst <= epsilon) return [a, b];
    const left = simplifyPath(points.slice(0, index + 1), epsilon);
    return [...left.slice(0, -1), ...simplifyPath(points.slice(index), epsilon)];
}

/** A Catmull–Rom curve through every point, as a polyline with a vertex about every `step` px. */
export function catmullRom(points: Vec2[], step = 5): Vec2[] {
    if (points.length < 3) return [...points];
    const out: Vec2[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
        const n = Math.max(1, Math.ceil(length2(sub2(p2, p1)) / step));
        for (let k = 1; k <= n; k++) {
            const t = k / n, t2 = t * t, t3 = t2 * t;
            const c = (q0: number, q1: number, q2: number, q3: number) =>
                0.5 * ((2 * q1) + (-q0 + q2) * t + (2 * q0 - 5 * q1 + 4 * q2 - q3) * t2 + (-q0 + 3 * q1 - 3 * q2 + q3) * t3);
            out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
        }
    }
    return out;
}

/** The length of a polyline. */
export function pathLength(path: Vec2[]): number {
    let l = 0;
    for (let i = 0; i < path.length - 1; i++) l += length2(sub2(path[i + 1], path[i]));
    return l;
}

/** The point at a fraction `t` (0 to 1) of a polyline's length, and the direction of travel there. */
export function pointAlongPath(path: Vec2[], t: number): { pt: Vec2, dir: Vec2 } {
    const total = pathLength(path);
    let left = Math.min(Math.max(t, 0), 1) * total;
    for (let i = 0; i < path.length - 1; i++) {
        const l = length2(sub2(path[i + 1], path[i]));
        if (!l) continue;
        const u = mult2(sub2(path[i + 1], path[i]), 1 / l);
        if (left <= l) return { pt: add2(path[i], mult2(u, left)), dir: u };
        left -= l;
    }
    // Past the end (rounding): the last point, in the last segment's direction.
    for (let i = path.length - 1; i > 0; i--) {
        const l = length2(sub2(path[i], path[i - 1]));
        if (l) return { pt: path[path.length - 1], dir: mult2(sub2(path[i], path[i - 1]), 1 / l) };
    }
    return { pt: path[0], dir: [1, 0] };
}

/** The nearest point on a polyline, its distance, and where it is as a fraction of the length. */
export function nearestOnPath(path: Vec2[], pt: Vec2): { pt: Vec2, dist: number, t: number } {
    const total = pathLength(path) || 1;
    let best = { pt: path[0], dist: Infinity, t: 0 };
    let before = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const l = length2(sub2(path[i + 1], path[i]));
        if (!l) continue;
        const u = mult2(sub2(path[i + 1], path[i]), 1 / l);
        const s = Math.min(Math.max(dotProduct(u, sub2(pt, path[i])), 0), l);
        const q = add2(path[i], mult2(u, s));
        const dist = length2(sub2(pt, q));
        if (dist < best.dist) best = { pt: q, dist, t: (before + s) / total };
        before += l;
    }
    return best;
}
