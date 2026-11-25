import { ConstrainedPoint } from "../classes/constrained-point.js";
import { ObjectData, ObjectDrawLayers, ObjectIdMapping, ObjectType, PointMover } from "../classes/object.js";
import { AdjustmentPoint, PointType, Vec2 } from "../dto.js";

export type Rect = [number, number, number, number];

export interface ImageData extends ObjectData {
    src: string;
    /** x, y, width and height, in canvas pixels. */
    rect: Rect;
    /** Radians about the image's centre; null when unrotated. */
    rotation?: number | null;
}

/** The smallest an image can be resized to, in either direction. */
const MIN_SIZE = 8;

/**
 * A picture drawn inside the map, under its areas, lines and symbols, untinted. Foundry 14 draws tiles
 * above the map at the same elevation, so a picture meant to lie under it has to be drawn by the map.
 * Named MapImage in code: Image is the browser's.
 */
export class MapImage extends ObjectType {
    static type = "image"

    src = "";
    rect: Rect = [0, 0, 0, 0];
    rotation = 0;

    /** The sprite drawn, or the outline drawn for the Gamemaster where a file could not be loaded. */
    sprite: any;

    construct(src: string, rect: Rect) {
        this.src = src;
        this.rect = rect;
    }

    deserialize(data: ImageData, objectMap: ObjectIdMapping) {
        super.deserialize(data, objectMap);
        const rect = Array.isArray(data.rect) && data.rect.length === 4 && data.rect.every(Number.isFinite) ? data.rect : [0, 0, 0, 0];
        this.construct(String(data.src ?? ""), [...rect] as Rect);
        this.rotation = Number(data.rotation) || 0;
    }

    /** Both corners move, so an image stretches with a Scene that is resized. */
    static moveData(data: ImageData, move: PointMover): ImageData {
        if (!Array.isArray(data.rect) || data.rect.length !== 4) return data;
        const [x, y, w, h] = data.rect;
        const a = move([x, y]);
        const b = move([x + w, y + h]);
        return { ...data, rect: [a[0], a[1], b[0] - a[0], b[1] - a[1]] };
    }

    get serialized(): ImageData {
        return { ...super.serialized, ...{
            src: this.src,
            rect: this.rect,
            rotation: this.rotation || null
        }};
    }

    get pointType(): PointType {
        return PointType.line;
    }

    get centre(): Vec2 {
        const [x, y, w, h] = this.rect;
        return [x + w / 2, y + h / 2];
    }

    /** Top left, top right, bottom right, bottom left. */
    get corners(): Vec2[] {
        const [x, y, w, h] = this.rect;
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }

    draw(layers: ObjectDrawLayers) {
        // The previous redraw's display object is destroyed by the layer; never keep a reference to it.
        this.sprite = undefined;
        if (!this.isVisible) return;
        const [x, y, w, h] = this.rect;
        // A texture, null while it loads, or false when it could not be loaded.
        const texture = canvas.linemap.imageTexture(this.src);
        let display: any;
        if (texture) {
            display = new PIXI.Sprite(texture);
            display.anchor.set(0.5);
            display.x = x + w / 2;
            display.y = y + h / 2;
            display.width = w;
            display.height = h;
            display.rotation = this.rotation;
        } else if (texture === false && game.user.isGM) {
            // Where the picture was, so the Gamemaster can see it is gone and select or delete it.
            display = new PIXI.Graphics()
                .lineStyle(4, this._currentColorHex)
                .drawRect(x, y, w, h)
                .moveTo(x, y).lineTo(x + w, y + h)
                .moveTo(x + w, y).lineTo(x, y + h);
        }
        if (display) {
            display.alpha = this.isRevealed ? 1.0 : 0.4;
            layers.images?.addChild(display);
            this.sprite = display;
        }
        if (this.isSelected) {
            layers.images?.addChild(new PIXI.Graphics().lineStyle(4, canvas.linemap._selectionColorHex).drawRect(x, y, w, h));
        }
    }

    /** A click inside it; a drawn selection box only when the box holds the whole image, so a background is not caught by every box. */
    testSelection(pt1: Vec2, pt2?: Vec2): boolean {
        const [x, y, w, h] = this.rect;
        if (pt2) return pt1[0] <= x && pt1[1] <= y && pt2[0] >= x + w && pt2[1] >= y + h;
        return pt1[0] >= x && pt1[0] <= x + w && pt1[1] >= y && pt1[1] <= y + h;
    }

    /**
     * The adjust tool resizes by the four corners; the select tool moves the selected image by its
     * centre. Unselected, it offers the select tool nothing, so a point that happens to lie on its
     * centre does not drag it along.
     */
    getAdjustmentPoints(): AdjustmentPoint[] {
        const L = canvas.linemap;
        if (L.activeTool === L.tools['selectObject']) {
            return this.isSelected ? [new AdjustmentPoint(this.pointType, this, 4, this.centre, false)] : [];
        }
        return this.corners.map((pt, i) => new AdjustmentPoint(this.pointType, this, i, pt, false));
    }

    setAdjustmentPoint(index: number, point: ConstrainedPoint, isFinal: boolean): boolean {
        const [x, y, w, h] = this.rect;
        const pt = point.point;
        if (index === 4) {
            this.rect = [pt[0] - w / 2, pt[1] - h / 2, w, h];
            return true;
        }
        // The opposite corner stays put. A corner cannot cross it, so each keeps its index for the drag.
        const opposite = this.corners[(index + 2) % 4];
        const sx = index === 1 || index === 2 ? 1 : -1;
        const sy = index >= 2 ? 1 : -1;
        let nw = Math.max(sx * (pt[0] - opposite[0]), MIN_SIZE);
        let nh = Math.max(sy * (pt[1] - opposite[1]), MIN_SIZE);
        if (game.keyboard?.isModifierActive("Shift") && w > 0 && h > 0) {
            const k = Math.max(nw / w, nh / h);
            nw = w * k;
            nh = h * k;
        }
        this.rect = [sx > 0 ? opposite[0] : opposite[0] - nw, sy > 0 ? opposite[1] : opposite[1] - nh, nw, nh];
        return true;
    }

    getParametricPoint(t: number, type: PointType): Vec2 {
        return this.centre;
    }
}
