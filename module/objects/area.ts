import { ConstrainedPoint } from "../classes/constrained-point.js";
import { ObjectData, ObjectDrawLayers, ObjectIdMapping, ObjectType, PointMover } from "../classes/object.js";
import { AdjustmentPoint, PointType, Vec2 } from "../dto.js";
import { add2, distanceToLine, dotProduct, lengthAndUnitVector, mult2, sub2 } from "../helpers/utils.js";

export interface AreaData extends ObjectData {
    points: Vec2[];
    pattern: string;
    /** The fill's opacity, 0.05 to 1; null or absent: the pattern's own (solid 35%, the others 100%). */
    opacity?: number | null;
    /** Drawn over lines (a lake over a road); null or absent: under them, as areas are. */
    over?: boolean | null;
}

export class Area extends ObjectType {
    static type = "area"

    points: Vec2[];
    pattern: string;
    opacity: number | null = null;
    /** Drawn over the lines, still under symbols and labels. */
    over = false;

    /** A fill opacity in steps of 5%, from 5% to 100%; anything unreadable is null (the pattern's own). */
    static clampOpacity(value: any): number | null {
        const n = Number(value);
        if (value == null || value === "" || !Number.isFinite(n)) return null;
        return Math.min(Math.max(Math.round(n * 20) / 20, 0.05), 1);
    }

    /** A pattern's own fill opacity. */
    static patternOpacity(pattern: string): number {
        return CONFIG.linemap.patterns[pattern]?.opacity ?? 1;
    }

    /** How opaque the fill is drawn: the area's own opacity, or its pattern's. */
    get fillOpacity(): number {
        return this.opacity ?? Area.patternOpacity(this.pattern);
    }

    construct(points: Vec2[], pattern: string) {
        this.points = [...points];
        this.pattern = pattern;
    }

    deserialize(data: AreaData, objectMap: ObjectIdMapping) {
        super.deserialize(data, objectMap);
        this.construct(
            data.points,
            data.pattern
        );
        this.opacity = Area.clampOpacity(data.opacity);
        this.over = !!data.over;
    }

    get colorable(): boolean {
        return true;
    }

    static moveData(data: AreaData, move: PointMover): AreaData {
        return { ...data, points: data.points?.map(move) };
    }

    get serialized(): AreaData {
        return { ...super.serialized, ...{
            points: this.points,
            pattern: this.pattern,
            opacity: this.opacity,
            over: this.over ? true : null
        }};
    }

    /**
     * Scale the area around the middle of its bounds: from `from` (its points as they were; its own
     * points by default) by `factor`. An area has no size of its own, so the size slider and ] and [
     * move its points instead.
     */
    scale(factor: number, from: Vec2[] = this.points) {
        if (factor === 1) {
            this.points = from.map(pt => [...pt] as Vec2);
            return;
        }
        const xs = from.map(pt => pt[0]), ys = from.map(pt => pt[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const round = (v: number) => Math.round(v * 100) / 100;
        this.points = from.map(([x, y]) => [round(cx + (x - cx) * factor), round(cy + (y - cy) * factor)] as Vec2);
    }

    get _polygon(): any {
        const poly = new PIXI.Polygon(...this.points.flatMap(pt => pt));
        poly.closeStroke = true;
        return poly;
    }

    draw(layers: ObjectDrawLayers) {
        if (this.isVisible && this.points) {
            const target = this.over ? (layers.overAreas ?? layers.areas) : layers.areas;
            const poly = this._polygon;
            const texture = canvas.linemap.patternTextures[this.pattern]?.icon;
            if (texture) {
                const points = poly.points;
                const uvs = points.map(pt => pt / texture.width);
                const indices = PIXI.utils.earcut(points);
    
                const tintColor = this._currentColor;
                // A custom shader ignores the mesh's alpha: the fill's opacity (and a hidden area's
                // dimming) goes in as a uniform.
                const fillAlpha = (this.isRevealed ? 1.0 : 0.2) * this.fillOpacity;
                const shader = PIXI.Shader.from(`
                    precision highp float;
                    attribute vec2 aVertexPosition;
                    attribute vec2 aTextureCoord;
    
                    uniform mat3 projectionMatrix;
    
                    varying vec2 vTextureCoord;
    
                    void main(void){
                        gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
                        vTextureCoord = aTextureCoord;
                    }
                `, `
                    precision mediump float;
                    varying vec2 vTextureCoord;
    
                    uniform sampler2D uSampler;
                    uniform vec3 tintColor;
                    uniform float fillAlpha;
    
                    void main(void){
                        vec4 s = texture2D(uSampler, vTextureCoord);
                        float a = s.a * fillAlpha;
                        gl_FragColor.a = a;
                        gl_FragColor.rgb = tintColor * a;
                    }            
                `, { uSampler: texture, tintColor, fillAlpha })
                const geometry = new PIXI.Geometry();
                geometry.addAttribute('aVertexPosition', points, 2);
                geometry.addAttribute('aTextureCoord', uvs, 2);
                geometry.addIndex(indices);
                const mesh = new PIXI.Mesh(geometry, shader, undefined, PIXI.DRAW_MODES.TRIANGLES);
                target?.addChild(mesh);
            }

            const lineWidth = CONFIG.linemap.patterns[this.pattern]?.lineWidth ?? 4;
            const gfx = new PIXI.Graphics()
                .lineStyle(lineWidth, this._currentColorHex)
                .drawPolygon(poly);
            gfx.alpha = this.isRevealed ? 1.0 : 0.2;
            target?.addChild(gfx);
        }
    }

    testSelection(pt1: Vec2, pt2?: Vec2): boolean {
        if (pt2) {
            const d = sub2(pt2, pt1);
            return !!new PIXI.Rectangle(...pt1, ...d).intersectPolygon(this._polygon).points.length;
        } else {
            return this._polygon.contains(...pt1);
        }
    }

    lineHitTest(point: Vec2): [number, number] {
        for (let i = 0; i < this.points.length; i++) {
            const pt1 = this.points[i];
            const pt2 = this.points[(i+1) % this.points.length];
            if (distanceToLine(point, pt1, pt2, false) < 5) {
                const d = sub2(pt2, pt1);
                const [l, u] = lengthAndUnitVector(d);
                const t = dotProduct(u, sub2(point, pt1)) / l;
                return [i, t];
            }
        }
        return undefined;
    }

    getAdjustmentPoints(): AdjustmentPoint[] {
        return this.points.map((pt, i) => new AdjustmentPoint(PointType.line, this, i, pt, false));
    }
    setAdjustmentPoint(index: number, point: ConstrainedPoint, isFinal: boolean): boolean {
        this.points[index] = [...point.point];
        return true;
    }

    removeVertex(index: number) {
        if (index !== undefined && this.points.length > 3) {
            this.points.splice(index, 1);
        }
    }
    addVertex(index: number, t: number) {
        const pt1 = this.points[index];
        const pt2 = this.points[(index + 1) % this.points.length];
        const d = sub2(pt2, pt1);
        const [l, u] = lengthAndUnitVector(d);
        const pt = add2(pt1, mult2(u, l * t));

        this.points.splice(index + 1, 0, pt);
    }
}