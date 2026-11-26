import { ConstrainedPoint, ConstrainedPointData } from "../classes/constrained-point.js";
import { ObjectData, ObjectDrawLayers, ObjectIdMapping, ObjectType, PointMover } from "../classes/object.js";
import { AdjustmentPoint, PointType, SnapPoint, SnapType, Vec2 } from "../dto.js";
import { add2, containsAabb, intersectAabb, length2, sub2 } from "../helpers/utils.js";
import { TextureCollection } from "../linemap-layer.js";

export interface SymbolData extends ObjectData {
    point: ConstrainedPointData;
    symbol: string;
    /** 1 to 4, multiplying the scene's symbol scale; null at 1. */
    size?: number | null;
    /** The UUID of a document it links to, or null. */
    link?: string | null;
}

export class Symbol extends ObjectType {
    static type = "symbol"

    point: ConstrainedPoint;
    symbol: string;
    size = 1;
    /** The UUID of a document this symbol opens (DocumentLinks), or null. */
    link: string | null = null;

    sprite: any;

    construct(point: ConstrainedPoint, symbol: string) {
        this.point = point;
        this.symbol = symbol;
    }

    deserialize(data: SymbolData, objectMap: ObjectIdMapping) {
        super.deserialize(data, objectMap);
        this.construct(
            new ConstrainedPoint(this.pointType, data.point.point, objectMap[data.point.sourceId], data.point.sourceT),
            data.symbol
        );
        this.size = this.clampSize(data.size);
        this.link = typeof data.link === "string" && data.link ? data.link : null;
    }

    static moveData(data: SymbolData, move: PointMover): SymbolData {
        return data.point?.point ? { ...data, point: { ...data.point, point: move(data.point.point) } } : data;
    }

    get constrainedPoints(): ConstrainedPoint[] {
        return [this.point];
    }

    get colorable(): boolean {
        return true;
    }

    get serialized(): SymbolData {
        return { ...super.serialized, ...{
            point: this.point.serialized,
            symbol: this.symbol,
            size: this.size === 1 ? null : this.size,
            link: this.link
        }};
    }

    get textureCollection(): TextureCollection {
        return canvas.linemap.symbolTextures;
    }

    /** Where this type's art is configured: CONFIG.linemap.symbols or .waypoints. */
    get artConfig(): "symbols" | "waypoints" {
        return "symbols";
    }

    get sizeRange(): [number, number] {
        return [1, 4];
    }

    get orientation(): number {
        return 0;
    }

    /** The scale of the art at size 1. */
    get baseScale(): number {
        return 0.5 * canvas.linemap.symbolScale;
    }

    get scale(): number {
        return this.baseScale * this.size;
    }

    get textAscent(): number {
        return (this.sprite?.height ?? 0) / 2 + 5;
    }

    draw(layers: ObjectDrawLayers) {
        // The previous redraw's sprite is destroyed by the layer; never keep a reference to it.
        this.sprite = undefined;
        const pt = this.point.point;
        // A symbol this build does not know is drawn as the collection's first, and keeps its own key.
        // Rasterised for the scale it is drawn at, so a big symbol stays sharp.
        const scale = this.scale;
        const textures = canvas.linemap.texturesAt(this.artConfig, this.textureCollection, this.symbol, scale);
        const icon = textures?.icon;
        const footprint = textures?.footprint;
        if (this.isVisible && icon) {
            const sprite = new PIXI.Sprite(icon);
            sprite.anchor.set(0.5);
            sprite.x = pt[0];
            sprite.y = pt[1];
            sprite.rotation = this.orientation;
            sprite.scale = { x: scale, y: scale };
            sprite.alpha = this.isRevealed ? 1.0 : 0.4;

            if (canvas.linemap.halo) {
                canvas.linemap.stampHalo(layers, icon, footprint, pt[0], pt[1], scale, this.orientation, this.isRevealed);
            }

            // Tinted by the container it goes in: the selection colour, its own, or the map's.
            const container = this.isSelected ? layers.selectedSymbols : this.color ? (layers.tinted?.(this.color) ?? layers.symbols) : layers.symbols;
            container?.addChild(sprite);
            this.sprite = sprite;

            if (footprint) {
                const sprite = new PIXI.Sprite(footprint);
                sprite.anchor.set(0.5);
                sprite.x = pt[0];
                sprite.y = pt[1];
                sprite.scale = { x: scale, y: scale };
                sprite.rotation = this.orientation;
                
                layers.footprints?.addChild(sprite);
            }
        }
    }

    getSnapPoints(pt: Vec2, types: SnapType[]) {
        const result: SnapPoint[] = [];
        const config = CONFIG.linemap.snap;

        if (types.includes(SnapType.symbol)) {
            const d = length2(sub2(pt, this.point.point));
            // The radius grows with the symbol, so a big one is as easy to link to.
            if (d <= config.symbol * this.size) {
                result.push(new SnapPoint(this.point.point, this, 0, SnapType.symbol));
            }
        }

        return result;
    }

    testSelection(pt1: Vec2, pt2?: Vec2): boolean {
        const w = this.sprite?.width ?? 0;
        const h = this.sprite?.height ?? 0;
        const spriteAabb = [
            sub2(this.point.point, [w/2, h/2]),
            add2(this.point.point, [w/2, h/2])
        ];

        return pt2 ? intersectAabb([pt1, pt2], spriteAabb) : containsAabb(pt1, spriteAabb);
    }

    getAdjustmentPoints(): AdjustmentPoint[] {
        return [new AdjustmentPoint(this.pointType, this, 0, this.point.point, !!this.point.sourceObject)];
    }
    setAdjustmentPoint(index: number, point: ConstrainedPoint, isFinal: boolean): boolean {
        this.point.setFrom(point, this);
        return true;
    }

    getParametricPoint(t: number, type: PointType): Vec2 {
        return this.point.point;
    }

    hasConstraintTo(object: ObjectType): boolean {
        return this.point.sourceObject === object || this.point.sourceObject?.hasConstraintTo(object);
    }
}
