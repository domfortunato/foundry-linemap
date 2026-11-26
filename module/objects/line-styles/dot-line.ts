import { pathLength, pointAlongPath } from "../../helpers/utils.js";
import { Line } from "../line.js";

/** Round dots along the line, as Foundry's own dotted stroke draws them. */
export class DotLine extends Line {
    makeGraphics(): any {
        const path = this.centerline;
        const length = pathLength(path);
        const gap = 13 * this.size;
        const count = Math.max(Math.round(length / gap), 1);
        const gfx = new PIXI.Graphics().beginFill(this._currentColorHex);
        for (let i = 0; i <= count; i++) gfx.drawCircle(...pointAlongPath(path, i / count).pt, 3.2 * this.size);
        return gfx.endFill();
    }
}
