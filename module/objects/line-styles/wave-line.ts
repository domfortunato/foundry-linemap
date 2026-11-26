import { PointType, SnapPoint, SnapType, Vec2 } from "../../dto.js";
import { add2, dotProduct, length2, lengthAndUnitVector, mult2, normal, pathLength, pointAlongPath, sub2 } from "../../helpers/utils.js";
import { Line } from "../line.js";

export class WaveLine extends Line {
    get path(): Vec2[] {
        if (this.smooth) return this._curvedPath();
        const gfx = new PIXI.Graphics();
        for (let i = 0; i < this.points.length - 1; i++) {
            const pt1 = this.points[i].point;
            const pt2 = this.points[i+1].point;
            const d = sub2(pt2, pt1);
            const [l, u] = lengthAndUnitVector(d);
            let n = normal(u);

            const step = 32.0 * this.size;
            const intermediateCount = Math.max(Math.floor((l - step / 2) / step), 0);
            const pts = [
                ...[...Array(intermediateCount).keys()].map(j => add2(pt1, mult2(u, step * (j+1)))),
                pt2
            ];

            gfx.moveTo(...pt1);
            let prevPt = pt1;
            for (const nextPt of pts) {
                const cp1 = add2(prevPt, mult2(add2(u, n), 8.0 * this.size));
                const cp2 = add2(nextPt, mult2(add2(mult2(u, -1), n), 8.0 * this.size));
                gfx.bezierCurveTo(...cp1, ...cp2, ...nextPt);

                prevPt = nextPt;
                n = mult2(n, -1);
            }
        }
        const points = gfx.currentPath.points;
        return [...Array(points.length / 2).keys()].map(i => [points[i * 2], points[i * 2 + 1]]);
    }

    /**
     * The waves along a smooth line's curve: a crest every 32 px of its length, as a straight line has,
     * each bent to the curve's direction between them.
     */
    _curvedPath(): Vec2[] {
        const base = this.centerline;
        const l = pathLength(base);
        const step = 32.0 * this.size;
        const count = Math.max(Math.floor((l - step / 2) / step), 0);
        const stops = [...[...Array(count).keys()].map(j => step * (j + 1) / l), 1].map(t => pointAlongPath(base, t).pt);
        const gfx = new PIXI.Graphics();
        let prevPt = base[0];
        let side = 1;
        gfx.moveTo(...prevPt);
        for (const nextPt of stops) {
            const [, u] = lengthAndUnitVector(sub2(nextPt, prevPt));
            const n = mult2(normal(u), side);
            const cp1 = add2(prevPt, mult2(add2(u, n), 8.0 * this.size));
            const cp2 = add2(nextPt, mult2(add2(mult2(u, -1), n), 8.0 * this.size));
            gfx.bezierCurveTo(...cp1, ...cp2, ...nextPt);
            prevPt = nextPt;
            side = -side;
        }
        const points = gfx.currentPath.points;
        return [...Array(points.length / 2).keys()].map(i => [points[i * 2], points[i * 2 + 1]]);
    }

    makeGraphics(): any {
        const gfx = new PIXI.Graphics()
            .lineStyle(3 * this.size, this._currentColorHex);
        const poly = new PIXI.Polygon(...this.path.flatMap(p => p));
        poly.closeStroke = false;
        return gfx.drawPolygon(poly);
    }

    getSnapPoints(pt: Vec2, types: SnapType[]) {
        // A smooth line snaps to its curve's centre (Line); the waves are 8 px (times its size) either side of it.
        if (this.smooth) return super.getSnapPoints(pt, types);
        const result: SnapPoint[] = [];
        const config = CONFIG.linemap.snap;

        if (types.includes(SnapType.lineEnd)) {
            const d0 = length2(sub2(pt, this.points[0].point));
            const d1 = length2(sub2(pt, this.points[1].point));
            if (d0 <= config.lineEnd) {
                result.push(new SnapPoint(this.points[0].point, this, 0, SnapType.lineEnd));
            }
            if (d1 <= config.lineEnd) {
                result.push(new SnapPoint(this.points[1].point, this, 1, SnapType.lineEnd));
            }
        }
        if (!result.length && types.includes(SnapType.lineContour)) {
            const pt0 = this.points[0].point;
            const pt1 = this.points[1].point;
            const p = sub2(pt, pt0);
            const d = sub2(pt1, pt0);
            const [l, u] = lengthAndUnitVector(d);
            const pl = dotProduct(u, p);
            const path = this.path;
            const n = path.findIndex((pt, i) => (i < path.length - 1) && (dotProduct(u, sub2(pt, pt0)) <= pl) && (dotProduct(u, sub2(path[i+1], pt0)) > pl));
            if (n >= 0) {
                const pt1s = path[n];
                const pt2s = path[n+1];
                const ds = sub2(pt2s, pt1s);
                const l1 = dotProduct(u, sub2(pt1s, pt0));
                const l2 = dotProduct(u, sub2(pt2s, pt0));
                const t = (pl - l1) / (l2 - l1);
                const [ls, us] = lengthAndUnitVector(ds);
                const spt = add2(pt1s, mult2(us, t * ls));
                const dist = length2(sub2(spt, pt));

                if (dist <= config.line) {
                    result.push(new SnapPoint(spt, this, pl / l, SnapType.lineContour));
                }
            }
        }
        if (!result.length && types.includes(SnapType.line)) {
            result.push(...super.getSnapPoints(pt, [SnapType.line]));
        }

        return result;
    }

    getParametricPoint(t: number, type: PointType): Vec2 {
        if (type === PointType.line && !this.smooth) {
            const pt0 = this.points[0].point;
            const pt1 = this.points[1].point;
            const [l, u] = lengthAndUnitVector(sub2(pt1, pt0));
            const pl = l * t;
            const path = this.path;
            const n = path.findIndex((pt, i) => (i < path.length - 1) && (dotProduct(u, sub2(pt, pt0)) <= pl) && (dotProduct(u, sub2(path[i+1], pt0)) > pl));
            if (n >= 0) {
                const pt1s = path[n];
                const pt2s = path[n+1];
                const ds = sub2(pt2s, pt1s);
                const l1 = dotProduct(u, sub2(pt1s, pt0));
                const l2 = dotProduct(u, sub2(pt2s, pt0));
                const t = (pl - l1) / (l2 - l1);
                const [ls, us] = lengthAndUnitVector(ds);
                return add2(pt1s, mult2(us, t * ls));
            }
        }
        return super.getParametricPoint(t, type);
    }
}