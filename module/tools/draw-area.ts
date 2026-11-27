import { ConstrainedPoint } from "../classes/constrained-point.js";
import { Tool } from "../classes/tool.js";
import { AdjustmentPoint, Vec2 } from "../dto.js";
import { add2, compareDistance, length2, sub2 } from "../helpers/utils.js";
import { Area } from "../objects/area.js";
import { AdjustTool } from "./adjust-tool.js";

const { getTemplate } = foundry.applications.handlebars;

export class DrawAreaTool extends Tool {
    optionsElement: any;
    optionsTemplate: any;

    selectedAdjustmentPoint: AdjustmentPoint;

    /** An area being drawn corner by corner: the corners placed so far. */
    corners: Vec2[] = [];

    get drafting(): boolean {
        return this.corners.length > 0;
    }

    activePattern: string = Object.keys(CONFIG.linemap.patterns)[0];

    get selectedArea(): Area {
        const obj = this.layer.selection[0];
        return obj instanceof Area ? obj as Area : undefined;
    }

    activate() {
        this._setupOptionsElement();
        this.layer.setSelection();
    }

    deactivate() {
        this.cancel();
        this.optionsElement?.remove();
    }

    async _setupOptionsElement() {
        const activation = this.activation;
        this.optionsTemplate = await getTemplate("modules/linemap/templates/draw-area-tool-options.hbs");
        // Deactivated (or activated again) while the template loaded: the bar is not this activation's.
        if (!activation || this.activation !== activation) return;
        this.optionsElement = $('<div class="linemap-tool-ui"></div>');
        $("#ui-top").append(this.optionsElement);

        this._updateOptionsElement();
    }

    _updateOptionsElement() {
        const htmlStr = this.optionsTemplate({
            styles: CONFIG.linemap.patterns,
            activePattern: this.activePattern
        });
        const html = $(htmlStr);

        html.on('click', '[data-action="set-area-pattern"]', (event) => {
            this.activePattern = event.currentTarget.dataset.areaPattern;
            this._updateOptionsElement();

            if (this.selectedArea) {
                this.selectedArea.pattern = this.activePattern;
                this.layer.registerHistory();
                this.layer.redraw();
            }
        });

        this.optionsElement.html("");
        this.optionsElement.append(html);
    }

    updateIndicators() {
        this.layer.clearPreview();

        const adjPts = this.selectedArea?.getAdjustmentPoints() ?? [];

        for (let i = 0; i < adjPts.length; i++) {
            const pt = adjPts[i];
            const gfx = new PIXI.Graphics()
            if (pt.index === this.selectedAdjustmentPoint?.index) {
                gfx.lineStyle(4, canvas.linemap._selectionColorHex);
            } else {
                gfx.lineStyle(2, 0xffffff);
            }

            this.layer.preview.addChild(gfx.drawCircle(...pt.current, AdjustTool.PointRadius));
        }
    }

    stateInvalidated() {
        this.cancel();
        this.selectedAdjustmentPoint = undefined;
        this.updateIndicators();
    }

    /** Drop an unfinished shape. */
    cancel() {
        if (!this.corners.length) return;
        this.corners = [];
        this.layer.clearPreview();
    }

    /** Make the shape drawn corner by corner an area, with 3 corners at least, as one edit. */
    finish() {
        const corners = this.corners;
        this.corners = [];
        this.layer.clearPreview();
        if (corners.length < 3) return;
        const area = new Area();
        area.construct(corners, this.activePattern);
        this.layer.addObject(area);
        this.layer.setSelection(area);
        this.selectedAdjustmentPoint = undefined;
        this.updateIndicators();
    }

    /** The unfinished shape: its corners joined, an edge on to the pointer, and a faint one back to the first. */
    drawDraft(pointer?: Vec2) {
        this.layer.clearPreview();
        if (!this.corners.length) return;
        const color = canvas.linemap._selectionColorHex;
        const width = (CONFIG.linemap.patterns[this.activePattern]?.lineWidth ?? 4) / (canvas.stage.scale.x || 1) * 0.75;
        const pts = pointer ? [...this.corners, pointer] : this.corners;
        const gfx = new PIXI.Graphics().lineStyle(Math.max(width, 2), color);
        gfx.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) gfx.lineTo(...pt);
        if (pts.length > 2) {
            gfx.lineStyle(Math.max(width, 2), color, 0.35).lineTo(...pts[0]);
        }
        const closing = pointer && this.corners.length >= 3 && compareDistance(this.corners[0], pointer, AdjustTool.PointRadius) <= 0;
        this.corners.forEach((pt, i) => {
            gfx.lineStyle(2, i === 0 && closing ? color : 0xffffff).drawCircle(...pt, i === 0 && closing ? AdjustTool.PointRadius * 1.5 : AdjustTool.PointRadius * 0.6);
        });
        this.layer.preview.addChild(gfx);
    }

    /** Place a corner (rounded to the pixel), or close the shape at the first one. */
    _addCorner(pt: Vec2) {
        const corner: Vec2 = [Math.round(pt[0]), Math.round(pt[1])];
        if (this.corners.length >= 3 && compareDistance(this.corners[0], corner, AdjustTool.PointRadius) <= 0) {
            this.finish();
            return;
        }
        const last = this.corners[this.corners.length - 1];
        if (last && compareDistance(last, corner, 3) <= 0) return;
        this.corners.push(corner);
        this.drawDraft();
    }

    onMouseMove(event: any, point: any) {
        if (this.drafting) this.drawDraft([point.x, point.y]);
    }

    onClickLeft(event: any) {
        const eventPt: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];

        // Drawing corner by corner: every click is a corner, except that with only the first one down, a
        // click on an area's edge selects that area instead (so "click away, then pick an area" works).
        if (this.drafting) {
            const onArea = this.corners.length === 1 && (this.layer.pickable.filter(o => o instanceof Area) as Area[]).some(a => a.lineHitTest(eventPt));
            if (!onArea) {
                this._addCorner(eventPt);
                return;
            }
            this.cancel();
        }

        const select = (area, pt) => {
            if (area) {
                this.layer.setSelection(area);

                this.activePattern = area.pattern;
                this._updateOptionsElement();
            } else {
                this.layer.setSelection();
            }
            this.selectedAdjustmentPoint = pt;
            this.updateIndicators();
        }

        const adjPts = this.selectedArea?.getAdjustmentPoints() ?? [];
        const adjPt = adjPts.find(pt => compareDistance(pt.original, eventPt, AdjustTool.PointRadius) <= 0);
        if (adjPt) {
            select(this.selectedArea, adjPt);
            return;
        }

        for (const area of this.layer.pickable.filter(o => o instanceof Area) as Area[]) {
            if (area.lineHitTest(eventPt)) {
                select(area, undefined);
                return;
            }
        }

        // Empty map: nothing selected, and the first corner of a new area.
        select(undefined, undefined);
        this._addCorner(eventPt);
    }

    async onDoubleClick(event: any) {
        const eventPt: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];

        // The double-click's first click placed the last corner.
        if (this.drafting) {
            this.finish();
            return;
        }

        const area = this.selectedArea;
        const adjPts = area?.getAdjustmentPoints() ?? [];
        const adjPt = adjPts.find(pt => compareDistance(pt.original, eventPt, AdjustTool.PointRadius) <= 0);
        if (adjPt) {
            area.removeVertex(adjPt.index);
            this.selectedAdjustmentPoint = undefined;
            await this.layer.registerHistory();
        } else {
            for (const area of this.layer.pickable.filter(o => o instanceof Area) as Area[]) {
                const hit = area.lineHitTest(eventPt);
                if (hit) {
                    area.addVertex(...hit);
                    await this.layer.registerHistory();
                    break;
                }
            }
        }

        this.layer.redraw();
        this.updateIndicators();
    }

    onDragLeftStart(event: any): void {
        const pt1: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        if (this.drafting) return;

        const adjPts = this.selectedArea?.getAdjustmentPoints() ?? [];
        const adjPt = adjPts.find(pt => compareDistance(pt.original, pt1, AdjustTool.PointRadius) <= 0);

        this.selectedAdjustmentPoint = adjPt;
    }

    onDragLeftMove(event: any) {
        const pt1: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        const pt2: Vec2 = [event.interactionData.destination.x, event.interactionData.destination.y];
        const d = sub2(pt2, pt1);
        if (this.drafting) {
            this.drawDraft(pt2);
            return;
        }

        if (this.selectedAdjustmentPoint) {
            const apt = this.selectedAdjustmentPoint;
            const pt = add2(apt.original, d);
            if (apt.object.setAdjustmentPoint(apt.index, new ConstrainedPoint(apt.type, pt), false)) {
                apt.current = pt;
            }
            this.layer.redraw(false);
            this.updateIndicators();
        } else {
            this.layer.clearPreview();

            if (length2(d) > 3) {
                const lineWidth = CONFIG.linemap.patterns[this.activePattern]?.lineWidth ?? 4;
                const gfx = this.layer.preview.addChild(new PIXI.Graphics());
                gfx
                    .lineStyle(lineWidth, 0x0)
                    .drawRect(...pt1, ...d)
            }
        }
    }

    async onDragLeftDrop(event: any) {
        const pt1: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        const pt2: Vec2 = [event.interactionData.destination.x, event.interactionData.destination.y];
        const d = sub2(pt2, pt1);
        // Drawing corner by corner: a click that wobbled into a drag is still a corner.
        if (this.drafting) {
            this._addCorner(pt2);
            return;
        }

        if (this.selectedAdjustmentPoint) {
            const apt = this.selectedAdjustmentPoint;
            const pt = add2(apt.original, d);
            if (apt.object.setAdjustmentPoint(apt.index, new ConstrainedPoint(apt.type, pt), true)) {
                apt.current = pt;
            }
            await this.layer.registerHistory();
            this.layer.redraw(false);
            this.updateIndicators();
        } else {
            this.layer.clearPreview();

            const area = new Area();
            area.construct([pt1, [pt2[0], pt1[1]], pt2, [pt1[0], pt2[1]]], this.activePattern);
            this.layer.addObject(area);
            this.layer.setSelection(area);
            this.selectedAdjustmentPoint = undefined;
            this.updateIndicators();
        }
    }

    async onDeleteKey(event: any) {
        // Drawing corner by corner: take back the last corner.
        if (this.drafting) {
            this.corners.pop();
            this.drawDraft();
            return;
        }
        this.selectedArea?.removeVertex(this.selectedAdjustmentPoint?.index);
        await this.layer.registerHistory();
        this.layer.redraw();
        this.updateIndicators();
    }
}