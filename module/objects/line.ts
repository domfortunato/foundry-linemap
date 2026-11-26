import { ObjectData, ObjectDrawLayers, ObjectIdMapping, ObjectType, PointMover } from "../classes/object.js";
import { ConstrainedPoint, ConstrainedPointData } from "../classes/constrained-point.js";
import { Vec2, SnapPoint, SnapType, AdjustmentPoint, PointType } from "../dto.js";
import { add2, catmullRom, distanceToLine, dotProduct, length2, lengthAndUnitVector, lineIntersectsBox, mult2, nearestOnPath, pointAlongPath, sub2 } from "../helpers/utils.js";

export interface LineData extends ObjectData {
    points: ConstrainedPointData[];
    style: string;
    /** A freehand line: a smooth curve through all its points. null (saved) or absent: straight. */
    smooth?: boolean | null;
    /** 1 to 4, multiplying the style's widths, dashes, waves and dots; null at 1. */
    size?: number | null;
}

export class Line extends ObjectType {
    static type = "line"

    points: ConstrainedPoint[];
    style: string;
    /**
     * A freehand line holds any number of points and is drawn as a Catmull–Rom curve through them;
     * only its two ends snap and link. A straight line has two points, and keeps the geometry it
     * always had (none of the path code below runs for it).
     */
    smooth = false;
    /** Thickness: every measure of the style's drawing is multiplied by it (the size slider, ] and [). */
    size = 1;
    _centerlineKey: string;
    _centerline: Vec2[];

    static getType(data: { id?: string, style: string }): typeof ObjectType {
        const styles = CONFIG.linemap.lineStyles;
        return styles[data.style]?.lineClass ?? styles[Object.keys(styles)[0]].lineClass;
    }

    construct(points: ConstrainedPoint[], style: string, smooth = false) {
        this.points = points;
        this.style = style;
        this.smooth = smooth && points.length > 2;
    }

    deserialize(data: LineData, objectMap: ObjectIdMapping) {
        super.deserialize(data, objectMap);
        this.construct(
            data.points.map(ptData => new ConstrainedPoint(PointType.line, ptData.point, objectMap[ptData.sourceId], ptData.sourceT)),
            data.style,
            !!data.smooth
        );
        this.size = this.clampSize(data.size);
    }

    get sizeRange(): [number, number] {
        return [1, 4];
    }

    get colorable(): boolean {
        return true;
    }

    /** How far from the line's middle a click selects it: the style's tolerance, grown with the line. */
    get selectTolerance(): number {
        return (CONFIG.linemap.lineStyles[this.style]?.selectTolerance ?? 5) * this.size;
    }

    /** The line as drawn, before any style's own shape: the curve of a smooth line, else its points. */
    get centerline(): Vec2[] {
        const pts = this.points.map(pt => pt.point);
        if (!this.smooth) return pts;
        const key = JSON.stringify(pts);
        if (key !== this._centerlineKey) {
            this._centerlineKey = key;
            this._centerline = catmullRom(pts);
        }
        return this._centerline;
    }

    static moveData(data: LineData, move: PointMover): LineData {
        return { ...data, points: data.points?.map(pt => pt.point ? { ...pt, point: move(pt.point) } : pt) };
    }

    get constrainedPoints(): ConstrainedPoint[] {
        return this.points ?? [];
    }

    get serialized(): LineData {
        return { ...super.serialized, ...{
            points: this.points.map(pt => pt.serialized),
            style: this.style,
            smooth: this.smooth ? true : null,
            size: this.size === 1 ? null : this.size
        }};
    }

    /** Opacity of a hidden line, as the Gamemaster sees it. */
    get hiddenAlpha(): number {
        return 0.4;
    }

    /** This line's graphics, built from scratch (each style draws its own). */
    makeGraphics(): any {
        return new PIXI.Graphics();
    }

    /** What the line's graphics depend on: a change of any of it rebuilds them. */
    get _drawKey(): string {
        return JSON.stringify([this.style, this._currentColorHex, this.smooth, this.size, this.points.map(pt => pt.point)]);
    }

    draw(layers: ObjectDrawLayers) {
        if (!this.isVisible || !this.points) return;
        this._place(layers, canvas.linemap.cachedDisplay(this.id, this._drawKey, () => this.makeGraphics()));
    }

    /** Draw a line that is not on the map (the line tool's preview), outside the layer's cache. */
    drawPreview(layers: ObjectDrawLayers) {
        if (this.points) this._place(layers, this.makeGraphics());
    }

    _place(layers: ObjectDrawLayers, gfx: any) {
        gfx.alpha = this.isRevealed ? 1.0 : this.hiddenAlpha;
        layers.lines?.addChild(gfx);
    }

    get pointType(): PointType {
        return PointType.line;
    }

    /** How far above the line a label put on it starts: further on a thicker line. */
    get textAscent(): number {
        return 15 * this.size;
    }

    getSnapPoints(pt: Vec2, types: SnapType[]) {
        if (this.smooth) return this._pathSnapPoints(pt, types);
        const result: SnapPoint[] = [];
        const config = CONFIG.linemap.snap;

        const pt0 = this.points[0].point;
        const pt1 = this.points[1].point;

        if (types.includes(SnapType.lineEnd)) {
            const d0 = length2(sub2(pt, pt0));
            const d1 = length2(sub2(pt, pt1));
            if (d0 <= config.lineEnd) {
                result.push(new SnapPoint(pt0, this, 0, SnapType.lineEnd));
            }
            if (d1 <= config.lineEnd) {
                result.push(new SnapPoint(pt1, this, 1, SnapType.lineEnd));
            }
        }
        if (!result.length && (types.includes(SnapType.line) || types.includes(SnapType.lineContour))) {
            const dLine = distanceToLine(pt, pt0, pt1);
            if (dLine <= config.line) {
                const d = sub2(pt1, pt0);
                const [l, u] = lengthAndUnitVector(d);
                const s = dotProduct(u, sub2(pt, pt0));
                const ptLine = add2(pt0, mult2(u, s));
                const t = s / l;
                result.push(new SnapPoint(ptLine, this, t, SnapType.line))
            }
        }

        return result;
    }

    /** A smooth line's snap points: its two ends, else the nearest point of its curve. */
    _pathSnapPoints(pt: Vec2, types: SnapType[]): SnapPoint[] {
        const config = CONFIG.linemap.snap;
        const ends: [Vec2, number][] = [[this.points[0].point, 0], [this.points.at(-1).point, 1]];
        if (types.includes(SnapType.lineEnd)) {
            const near = ends.filter(([p]) => length2(sub2(pt, p)) <= config.lineEnd);
            if (near.length) return near.map(([p, t]) => new SnapPoint(p, this, t, SnapType.lineEnd));
        }
        if (types.includes(SnapType.line) || types.includes(SnapType.lineContour)) {
            const near = nearestOnPath(this.centerline, pt);
            if (near.dist <= config.line) return [new SnapPoint(near.pt, this, near.t, SnapType.line)];
        }
        return [];
    }

    testSelection(pt1: Vec2, pt2?: Vec2): boolean {
        if (this.smooth) {
            const path = this.centerline;
            if (pt2) return path.slice(1).some((p, i) => lineIntersectsBox([path[i], p], [pt1, pt2]));
            return nearestOnPath(path, pt1).dist <= this.selectTolerance;
        }
        if (pt2) {
            return lineIntersectsBox(this.points.map(pt => pt.point), [pt1, pt2]);
        } else {
            const dist = distanceToLine(pt1, this.points[0].point, this.points[1].point, true);
            // A style this build does not know is drawn as the first style (getType), and selected like one.
            return dist <= this.selectTolerance;
        }
    }

    getAdjustmentPoints(): AdjustmentPoint[] {
        return this.points.map((pt, i) => new AdjustmentPoint(PointType.line, this, i, pt.point, !!pt.sourceObject));
    }
    setAdjustmentPoint(index: number, point: ConstrainedPoint, isFinal: boolean): boolean {
        this.points[index].setFrom(point, this);
        return true;
    }

    getParametricPoint(t: number, type: PointType): Vec2 {
        // A smooth line's t is a fraction of the curve's length (a straight line's, of its one segment).
        if (this.smooth) return pointAlongPath(this.centerline, t).pt;
        const pt0 = this.points[0].point;
        const pt1 = this.points[1].point;
        const [l, u] = lengthAndUnitVector(sub2(pt1, pt0));
        return add2(pt0, mult2(u, l*t));
    }
    getParametricOrientation(t: number): number {
        if (this.smooth) {
            const { dir } = pointAlongPath(this.centerline, t);
            return Math.atan2(dir[1], dir[0]);
        }
        const d = sub2(this.points[1].point, this.points[0].point);
        return Math.atan2(d[1], d[0]);
    }

    hasConstraintTo(object: ObjectType): boolean {
        return !!this.points.find(pt => pt.sourceObject === object || pt.sourceObject?.hasConstraintTo(object));
    }
}
