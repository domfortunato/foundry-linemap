import { Vec2 } from "../../dto.js";
import { add2, lengthAndUnitVector, mult2, sub2 } from "../../helpers/utils.js";
import { Line } from "../line.js";

export class DashLine extends Line {
    makeGraphics(): any {
        {
            let coverage = 0;
            const config = CONFIG.linemap.lineStyles[this.style];
            const [on, off]: [number, number] = config?.dash ?? [12, 8];
            const period = on + off;
            const gfx = new PIXI.Graphics()
                .lineStyle(config?.width ?? 4, this._currentColorHex);

            const drawSegment = (pt: Vec2, u: Vec2, l: number, coverage: number) => {
                let first = true;
                let c = 0;
                while (c < l) {
                    const phase = first ? (coverage + c) % period : 0;

                    if (phase < on) {
                        const lineLength = Math.min(on - phase, l - c);
                        gfx
                            .moveTo(...add2(pt, mult2(u, c)))
                            .lineTo(...add2(pt, mult2(u, c + lineLength)));
                    }

                    c += period - phase;
                    first = false;
                }
            }

            const path = this.centerline;
            for (let i = 0; i < path.length - 1; i++) {
                const pt1 = path[i];
                const pt2 = path[i+1];
                const d = sub2(pt2, pt1);
                const [l, u] = lengthAndUnitVector(d);

                drawSegment(pt1, u, l, coverage);

                coverage += l;
            }

            return gfx;
        }
    }
}