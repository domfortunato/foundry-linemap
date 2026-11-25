import { PointType, SnapPoint, Vec2 } from "../dto.js";
import { ObjectType } from "./object.js";

export interface ConstrainedPointData {
    point?: Vec2 | null;
    sourceId?: string | null;
    sourceT?: number | null;
}

export class ConstrainedPoint {
    type: PointType;
    unconstrainedPoint: Vec2 | undefined;
    sourceObject: ObjectType | undefined;
    sourceT: number | undefined;

    constructor(type: PointType, point?: Vec2 | null, object?: ObjectType, t?: number | null) {
        this.type = type;
        // Saved data holds null for an unset key.
        this.unconstrainedPoint = point ?? undefined;
        this.sourceObject = object ?? undefined;
        this.sourceT = t ?? undefined;
    }

    // Every key, null when unset: a save merges each object into the one already saved, so a key
    // left out (a link just dropped) would keep its old value.
    get serialized(): ConstrainedPointData {
        return {
            point: this.unconstrainedPoint ?? null,
            sourceId: this.sourceObject?.id ?? null,
            sourceT: this.sourceObject ? this.sourceT ?? null : null
        };
    }

    get point(): Vec2 {
        if (this.sourceObject) {
            return this.sourceObject?.getParametricPoint(this.sourceT!, this.type);
        }
        return this.unconstrainedPoint;
    }

    /** Drop the link, keeping the point where the linked object puts it now. */
    release() {
        const pt = this.point;
        this.unconstrainedPoint = pt ? [pt[0], pt[1]] : this.unconstrainedPoint;
        this.sourceObject = undefined;
        this.sourceT = undefined;
    }

    setFrom(other: ConstrainedPoint, owner: ObjectType) {
        const isCyclic = other.sourceObject?.hasConstraintTo(owner);

        if (isCyclic) {
            ui.notifications.warn(game.i18n.localize('linemap.error.cyclicConstraint'));
        }

        if (!isCyclic && other.sourceObject) {
            this.unconstrainedPoint = other.unconstrainedPoint;
            this.sourceObject = other.sourceObject;
            this.sourceT = other.sourceT;
        } else {
            this.unconstrainedPoint = other.unconstrainedPoint;
            this.sourceObject = this.sourceT = undefined;
        }
    }

    static fromSnapOrPoint(type: PointType, point: Vec2, snapPoint: SnapPoint): ConstrainedPoint {
        if (snapPoint) {
            return new ConstrainedPoint(type, [...point], snapPoint.object, snapPoint.t);
        } else {
            return new ConstrainedPoint(type, [...point], undefined, undefined);
        }
    }
}