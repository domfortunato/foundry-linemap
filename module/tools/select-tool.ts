import { DocumentLinks } from "../classes/links.js";
import { lookOption } from "../classes/looks.js";
import { colorOption } from "../classes/colors.js";
import { ObjectType } from "../classes/object.js";
import { Tool, ToolHotkey } from "../classes/tool.js";
import { AdjustmentPoint, SnapPoint, Vec2 } from "../dto.js";
import { add2, eq2, length2, sub2 } from "../helpers/utils.js";
import { Symbol } from "../objects/symbol.js";
import { ContextMenu, SizeOption } from "../apps/context-menu.js";
import { ConstrainedPoint } from "../classes/constrained-point.js";
import { Waypoint } from "../objects/waypoint.js";
import { Text } from "../objects/text.js";
import { DrawTextTool } from "./draw-text.js";
import { MapImage } from "../objects/image.js";
import { Area } from "../objects/area.js";

/**
 * Which of the objects under a click is picked first: symbols, then lines, labels and areas, then
 * images, the topmost image first. An image is under everything else, and may cover the Scene.
 */
function pickOrder(a: ObjectType, b: ObjectType): number {
    const rank = (o: ObjectType) => o instanceof Symbol ? 0 : o instanceof MapImage ? 2 : 1;
    return (rank(a) - rank(b)) || (a instanceof MapImage && b instanceof MapImage ? b.sort - a.sort : 0);
}

enum DragOperation {
    move,
    select
}

export class SelectTool extends Tool {
    selectedObjects = [];
    snapPoint: SnapPoint;

    menu: ContextMenu;
    /** Where the menu is centred, in the canvas view's pixels. */
    menuAt: { x: number, y: number };

    dragOperation: DragOperation;
    adjustmentPoints: AdjustmentPoint[];

    _updateSelection(preserve: boolean, pt1: Vec2, pt2?: Vec2) {
        const selection = preserve ? this.layer.selection : [];

        if (pt2) {
            const min: Vec2 = [Math.min(pt1[0], pt2[0]), Math.min(pt1[1], pt2[1])];
            const max: Vec2 = [Math.max(pt1[0], pt2[0]), Math.max(pt1[1], pt2[1])];
    
            const selected = this.layer.objects
                .filter(obj => obj.testSelection(min, max))
                .filter(obj => !selection.includes(obj));
            this.layer.setSelection(...selection, ...selected);
        } else {
            const selected: ObjectType[] = this.layer.objects.filter(obj => obj.testSelection([pt1[0], pt1[1]]));
            selected.sort(pickOrder);
            const target = selected[0];
            if (preserve) {
                if (selection.includes(target)) {
                    this.layer.setSelection(...selection.filter(o => o !== target));
                } else {
                    this.layer.setSelection(...selection, target);
                }
            } else {
                this.layer.setSelection(target);
            }
        }
    }

    onClickLeft(event: any): void {
        const point: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        this._updateSelection(event.shiftKey, point);
    }

    async onDoubleClick(event: any) {
        await DrawTextTool.editTextAt(this.layer, [event.interactionData.destination.x, event.interactionData.destination.y]);
    }

    deactivate() {
        this.closeMenu();
    }

    /**
     * The menu closes when the pointer leaves it. A pointer that had left before the menu appeared
     * (its template loads first) never left it, and the menu stayed on screen: a pointer moving on
     * the canvas well away from it closes it too. The menu reaches 80 px either side of its centre.
     */
    closeMenuIfAway(pt: { x: number, y: number }) {
        // Over the menu itself (its row of looks reaches further): it stays.
        if (document.elementFromPoint(pt.x, pt.y)?.closest?.(".linemap-menu")) return;
        if (this.menu && this.menuAt && Math.hypot(pt.x - this.menuAt.x, pt.y - this.menuAt.y) > 110) this.closeMenu();
    }

    /** Close the right-click menu; whether one was open. */
    closeMenu(): boolean {
        const menu = this.menu;
        this.menu = undefined;
        if (!menu?.rendered) return false;
        menu.close({ animate: false });
        return true;
    }

    onClickRight(event: any): void {
        if (this.layer.selection.length) {
            this.closeMenu();
            const { x, y } = event.interactionData.origin;
            const screenCoords = this.layer.worldTransform.apply({ x, y });
            const images = this.layer.selection.filter(o => o instanceof MapImage) as MapImage[];
            const imageOptions = images.length ? {
                fitToScene: {
                    icon: 'fa-expand',
                    label: 'linemap.menu.fitToScene',
                    handler: () => this.layer.fitImagesToScene(images)
                },
                bringForward: {
                    icon: 'fa-arrow-up',
                    label: 'linemap.menu.bringForward',
                    handler: () => this.layer.reorderImages(images, 1)
                },
                sendBack: {
                    icon: 'fa-arrow-down',
                    label: 'linemap.menu.sendBack',
                    handler: () => this.layer.reorderImages(images, -1)
                }
            } : {};
            const single: any = this.layer.selection.length === 1 ? this.layer.selection[0] : null;
            const linkOptions = DocumentLinks.linkable(single) ? {
                linkDocument: {
                    icon: 'fa-link',
                    label: 'linemap.menu.linkDocument',
                    handler: () => this.layer.links.prompt(single)
                },
                ...(single.link ? {
                    unlinkDocument: {
                        icon: 'fa-link-slash',
                        label: 'linemap.menu.unlinkDocument',
                        handler: () => this.layer.links.setLink([single], null)
                    }
                } : {})
            } : {};
            const menu = new ContextMenu({
                duplicate: {
                    icon: 'fa-clone',
                    label: 'linemap.menu.duplicate',
                    handler: () => this.layer.duplicateSelection()
                },
                bringToFront: {
                    icon: 'fa-angles-up',
                    label: 'linemap.menu.bringToFront',
                    handler: () => this.layer.reorderObjects(this.layer.selection, "front")
                },
                sendToBack: {
                    icon: 'fa-angles-down',
                    label: 'linemap.menu.sendToBack',
                    handler: () => this.layer.reorderObjects(this.layer.selection, "back")
                },
                ...imageOptions,
                ...linkOptions,
                left: {
                    icon: 'fa-eye-slash',
                    label: 'linemap.menu.hide',
                    handler: () => {
                        const objs = this.layer.selection.filter(o => o.isRevealed);
                        if (objs.length) {
                            objs.forEach(obj => { obj.isRevealed = false; });
                            this.layer.registerHistory();
                            this.layer.redraw();
                        }
                    }
                },
                right: {
                    icon: 'fa-eye',
                    label: 'linemap.menu.reveal',
                    handler: () => {
                        const objs = this.layer.selection.filter(o => !o.isRevealed);
                        if (objs.length) {
                            objs.forEach(obj => { obj.isRevealed = true; });
                            this.layer.registerHistory();
                            this.layer.redraw();
                        }
                    }
                }
            }, [this._sizeOption(), this._scaleOption(), this._opacityOption(), this._rotationOption()].filter(o => o), lookOption(this.layer, this.layer.selection), colorOption(this.layer, this.layer.selection));
            menu.render(true, { position: { left: screenCoords.x, top: screenCoords.y }});
            this.menu = menu;
            this.menuAt = { x: screenCoords.x, y: screenCoords.y };
        }
    }

    /**
     * The menu's size slider, for a selection with symbols, waypoints or labels. Sliding redraws the
     * map at each step; the edit is recorded once, when the slider is let go or the menu closes.
     */
    _sizeOption(): SizeOption | undefined {
        const sized = this.layer.selection.filter(o => o.sizeRange);
        if (!sized.length) return undefined;
        const min = Math.min(...sized.map(o => o.sizeRange[0]));
        const max = Math.max(...sized.map(o => o.sizeRange[1]));
        let dirty = false;
        return {
            name: 'size',
            label: 'linemap.menu.size',
            icon: 'fa-up-right-and-down-left-from-center',
            min, max, step: 0.25,
            reset: 1,
            value: (sized[0] as any).size,
            input: (size: number) => {
                if (this.layer.resizeObjects(sized, () => size)) {
                    dirty = true;
                    this.layer.redraw();
                }
            },
            commit: () => {
                if (!dirty) return;
                dirty = false;
                this.layer.registerHistory();
            }
        };
    }

    /**
     * The menu's size slider for areas, which have no size of their own: it scales each selected area
     * around its middle, from how it was when the menu opened (1, and a double-click, put it back).
     * Recorded once, like the size slider.
     */
    _scaleOption(): SizeOption | undefined {
        const areas = this.layer.selection.filter(o => o instanceof Area) as Area[];
        if (!areas.length) return undefined;
        const start = new Map(areas.map(a => [a, a.points.map(pt => [...pt] as Vec2)]));
        let factor = 1;
        let dirty = false;
        return {
            name: 'scale',
            label: 'linemap.menu.scale',
            icon: 'fa-draw-polygon',
            min: 0.25, max: 4, step: 0.05,
            reset: 1,
            value: 1,
            input: (f: number) => {
                if (!Number.isFinite(f) || f <= 0 || f === factor) return;
                factor = f;
                areas.forEach(a => a.scale(f, start.get(a)));
                dirty = true;
                this.layer.redraw();
            },
            commit: () => {
                if (!dirty) return;
                dirty = false;
                this.layer.registerHistory();
            }
        };
    }

    /**
     * The menu's fill opacity slider, for a selection with areas. A value that is an area's pattern's
     * own opacity is saved as null, so the area follows its pattern; a double-click puts every selected
     * area back to its pattern's. Recorded once, like the size slider.
     */
    _opacityOption(): SizeOption | undefined {
        const areas = this.layer.selection.filter(o => o instanceof Area) as Area[];
        if (!areas.length) return undefined;
        const reset = Area.patternOpacity(areas[0].pattern);
        let dirty = false;
        return {
            name: 'opacity',
            label: 'linemap.menu.opacity',
            icon: 'fa-droplet',
            min: 0.05, max: 1, step: 0.05,
            reset,
            value: areas[0].fillOpacity,
            input: (value: number) => {
                const v = Area.clampOpacity(value);
                let changed = false;
                for (const a of areas) {
                    const next = v === null || v === Area.patternOpacity(a.pattern) ? null : v;
                    if (a.opacity === next) continue;
                    a.opacity = next;
                    changed = true;
                }
                if (!changed) return;
                dirty = true;
                this.layer.redraw();
            },
            commit: () => {
                if (!dirty) return;
                dirty = false;
                this.layer.registerHistory();
            }
        };
    }

    /**
     * The menu's rotation slider, for a selection with labels: degrees on top of a line's direction.
     * Recorded once, like the size slider.
     */
    _rotationOption(): SizeOption | undefined {
        const labels = this.layer.selection.filter(o => o instanceof Text) as Text[];
        if (!labels.length) return undefined;
        let dirty = false;
        return {
            name: 'rotation',
            label: 'linemap.menu.rotation',
            icon: 'fa-rotate',
            min: -180, max: 180, step: 1,
            reset: 0,
            value: labels[0].rotation,
            input: (degrees: number) => {
                const r = Text.clampRotation(degrees);
                const changed = labels.filter(t => t.rotation !== r);
                if (!changed.length) return;
                changed.forEach(t => { t.rotation = r; });
                dirty = true;
                this.layer.redraw();
            },
            commit: () => {
                if (!dirty) return;
                dirty = false;
                this.layer.registerHistory();
            }
        };
    }

    onDragLeftStart(event: any): void {
        const pt: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        const objects = this.layer.objects.filter(obj => obj.testSelection(pt));
        objects.sort(pickOrder);
        const target = objects[0];
        const selection = this.layer.selection;
        const selected = selection.includes(target);
        
        this.dragOperation = (!objects.length || !selected) ? DragOperation.select : DragOperation.move;

        if (this.dragOperation === DragOperation.move) {
            this.adjustmentPoints = this._movePoints(selection);
        }
    }

    /**
     * The points a move of the selection takes along: its own, and the other objects' points on
     * them, unless linking is off (then those are unlinked, and stay).
     */
    _movePoints(selection: ObjectType[]): AdjustmentPoint[] {
        const pts = selection.flatMap(obj => obj.getAdjustmentPoints());
        const otherPts = this.layer.objects
            .filter(obj => !selection.includes(obj))
            .flatMap(obj => obj.getAdjustmentPoints())
            .filter(candidate => pts.find(pt => eq2(pt.original, candidate.original)));
        if (this.layer.adjustLinked) {
            pts.push(...otherPts);
        } else {
            otherPts
                .filter(pt => pt.isConstrained)
                .forEach(pt => pt.object.setAdjustmentPoint(pt.index, new ConstrainedPoint(pt.object.pointType, pt.original), false));
        }
        return pts;
    }

    /**
     * Move the selection by a few pixels (the arrow keys), as a drag would, linked objects following.
     * A burst of presses is saved once, when they stop. Whether there was a selection to move.
     */
    nudge(d: Vec2): boolean {
        const selection = this.layer.selection;
        if (!selection.length || this.dragOperation !== undefined) return false;
        this.adjustmentPoints = this._movePoints(selection);
        for (const apt of this.affectedAdjustmentPoints) {
            apt.object.setAdjustmentPoint(apt.index, new ConstrainedPoint(apt.type, add2(apt.original, d)), true);
        }
        this.adjustmentPoints = undefined;
        this.layer.redraw();
        this.layer.recordSoon();
        return true;
    }

    onDragLeftMove(event: any): void {
        const pt1: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        const pt2: Vec2 = [event.interactionData.destination.x, event.interactionData.destination.y];
        const d = sub2(pt2, pt1);

        if (this.dragOperation === DragOperation.select) {
            this.layer.clearPreview();

            if (length2(d) > 3) {
                const gfx = this.layer.preview.addChild(new PIXI.Graphics());
                gfx
                    .lineStyle(2, 0x00ffff)
                    .drawRect(...pt1, ...d)
            }
        } else {
            for (const apt of this.affectedAdjustmentPoints) {
                apt.object.setAdjustmentPoint(apt.index, new ConstrainedPoint(apt.type, add2(apt.original, d)), false);
            }
            this.layer.redraw(false);
        }
    }

    async onDragLeftDrop(event: any) {
        const pt1: Vec2 = [event.interactionData.origin.x, event.interactionData.origin.y];
        const pt2: Vec2 = [event.interactionData.destination.x, event.interactionData.destination.y];
        const d = sub2(pt2, pt1);

        if (this.dragOperation === DragOperation.select) {
            this.layer.clearPreview();

            this._updateSelection(event.shiftKey, pt1, pt2);
        } else {
            for (const apt of this.affectedAdjustmentPoints) {
                apt.object.setAdjustmentPoint(apt.index, new ConstrainedPoint(apt.type, add2(apt.original, d)), true);
            }
            await this.layer.registerHistory();
            this.layer.redraw();
        }

        this.dragOperation = undefined;
    }

    async onDeleteKey(event: any) {
        this.layer.deleteObjects(...this.layer.selection);
    }

    hotkeyPressed(key: ToolHotkey): void {
        if (key === ToolHotkey.reveal) {
            this.layer.selection.forEach(obj => { obj.isRevealed = true; });
            this.layer.registerHistory();
            this.layer.redraw();
        }
        if (key === ToolHotkey.hide) {
            this.layer.selection.forEach(obj => { obj.isRevealed = false; });
            this.layer.registerHistory();
            this.layer.redraw();
        }
        if (key === ToolHotkey.grow) this.layer.stepSizes(0.5);
        if (key === ToolHotkey.shrink) this.layer.stepSizes(-0.5);
        if (key === ToolHotkey.reverse) {
            this.layer.selection.filter(obj => obj instanceof Waypoint).forEach(wp => wp.reverseDirection());
            canvas.linemap.registerHistory();
            canvas.linemap.redraw();
        }
    }

    get affectedAdjustmentPoints(): AdjustmentPoint[] {
        const pointGroups: Record<string, AdjustmentPoint[]> = {};
        for (const pt of this.adjustmentPoints) {
            const key = `${pt.original[0]},${pt.original[1]}`;
            pointGroups[key] = [...(pointGroups[key] ?? []), pt];
        }

        return Object.values(pointGroups).flatMap(pts => {
            let candidates;
            if (this.layer.adjustLinked) {
                candidates = pts.filter(pt => !pt.isConstrained);
            } else {
                candidates = pts.filter(pt => !!pt.isConstrained).slice(0, 1);
            }
            return candidates.length ? candidates : pts;
        });
    }
}
