import { add2, mult2, normal, normalize, sub2 } from "../../helpers/utils.js";
import { Line } from "../line.js";

export class BarrierLine extends Line {
    get hiddenAlpha(): number {
        return 0.2;
    }

    makeGraphics(): any {
        {
            const poly = new PIXI.Polygon(...this.centerline.flat());
            poly.closeStroke = false;
            const gfx = new PIXI.Graphics()
                .lineStyle(12 * this.size, this._currentColorHex)
                .drawPolygon(poly);

            const path = this.centerline;
            const pt1b = path[0];
            const pt2b = path[1];
            const db = sub2(pt2b, pt1b);
            const nb = normalize(normal(db));
            gfx
                .lineStyle(4 * this.size, this._currentColorHex)
                .moveTo(...add2(pt1b, mult2(nb, 20 * this.size)))
                .lineTo(...add2(pt1b, mult2(nb, -20 * this.size)));

            const pt1e = path.at(-2);
            const pt2e = path.at(-1);
            const de = sub2(pt2e, pt1e);
            const ne = normalize(normal(de));
            gfx
                .lineStyle(4 * this.size, this._currentColorHex)
                .moveTo(...add2(pt2e, mult2(ne, 20 * this.size)))
                .lineTo(...add2(pt2e, mult2(ne, -20 * this.size)));
            return gfx;
        }
    }
}