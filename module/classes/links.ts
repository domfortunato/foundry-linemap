import { Vec2 } from "../dto.js";
import { ObjectType } from "./object.js";

/**
 * Document links on symbols, waypoints and labels, working like core's map notes (ROADMAP 7.2), and
 * hover tooltips (7.3). Players have no Line Map control, so the map answers the pointer on every
 * layer: hovering a linked object shows a pointer and the document's name, and a double-click opens
 * the document; hovering a symbol, waypoint or line with labels shows their text, so a crowded map
 * can be read. Nothing answers for a hidden object or label, a document the user may not see, or
 * while map notes are toggled off. On the Line Map layer itself the tools own the pointer.
 */
export class DocumentLinks {
    layer: any;
    hovered: ObjectType | null = null;
    lastDown: { object: ObjectType, time: number } | null = null;
    anchor: any = null;
    viewListening = false;

    static DoubleClickMs = 400;

    constructor(layer: any) {
        this.layer = layer;
    }

    /** Whether an object can hold a link (symbols, waypoints and labels). */
    static linkable(o: any): boolean {
        return !!o && "link" in o;
    }

    /** After every canvas draw, which clears the stage's listeners. */
    attach() {
        canvas.stage.on("pointermove", this._onMove, this);
        canvas.stage.on("pointerdown", this._onDown, this);
        if (!this.viewListening) {
            canvas.app.view.addEventListener("pointerleave", () => this.clear());
            this.viewListening = true;
        }
    }

    /** Map notes shown (core's toggle, or the Notes layer active), and the Line Map tools not in use. */
    get enabled(): boolean {
        if (this.layer.active) return false;
        return !!(game.settings.get("core", "notesDisplayToggle") || canvas.notes?.active);
    }

    /** The document an object links to, if this user may see it. */
    static viewable(o: any): any {
        if (!o?.link) return null;
        let doc: any;
        try { doc = fromUuidSync(o.link); } catch { return null; }
        if (!doc || typeof doc.testUserPermission !== "function") return null;
        if (game.user.isGM) return doc;
        if (doc.documentName === "JournalEntryPage" && doc.type === "image" && doc.testUserPermission(game.user, "LIMITED")) return doc;
        if (doc.documentName === "Scene") return doc.testUserPermission(game.user, "LIMITED") ? doc : null;
        return doc.testUserPermission(game.user, "OBSERVER") ? doc : null;
    }

    /** The topmost object at a point that can hold a link, drawn for this user. */
    linkableAt(pt: Vec2): ObjectType | null {
        for (let i = this.layer.objects.length - 1; i >= 0; i--) {
            const o = this.layer.objects[i];
            if (DocumentLinks.linkable(o) && o.isVisible && (o as any).sprite && o.testSelection(pt)) return o;
        }
        return null;
    }

    /** The topmost linked object at a point whose document this user may see. */
    linkedAt(pt: Vec2): ObjectType | null {
        for (let i = this.layer.objects.length - 1; i >= 0; i--) {
            const o: any = this.layer.objects[i];
            if (!o.link || !DocumentLinks.linkable(o) || !o.isVisible || !o.sprite || !o.testSelection(pt)) continue;
            if (DocumentLinks.viewable(o)) return o;
        }
        return null;
    }

    /**
     * What hovering a point shows: the topmost symbol, waypoint or label (then line) with a document
     * this user may open or labels this user sees, with that document and the labels' text.
     */
    hoverAt(pt: Vec2): { object: any, doc: any, labels: string[] } | null {
        const objects = this.layer.objects;
        const passes = [(o: any) => DocumentLinks.linkable(o) && !!o.sprite, (o: any) => (o.constructor as any).type === "line"];
        for (const pass of passes) {
            for (let i = objects.length - 1; i >= 0; i--) {
                const o: any = objects[i];
                if (!pass(o) || !o.isVisible || !o.testSelection(pt)) continue;
                const doc = DocumentLinks.viewable(o);
                const labels = this.labelsOf(o);
                if (doc || labels.length) return { object: o, doc, labels };
            }
        }
        return null;
    }

    /** The text of the labels linked to an object that this user sees. */
    labelsOf(o: any): string[] {
        return this.layer.objects
            .filter((t: any) => (t.constructor as any).type === "text" && t !== o && t.point?.sourceObject === o && t.isVisible && t.text?.trim())
            .map((t: any) => t.text.trim());
    }

    /** Whether a pointer event is on a placeable (a token, a note): those answer it themselves. */
    static onPlaceable(event: any): boolean {
        for (let t = event.target; t; t = t.parent) {
            if (t instanceof foundry.canvas.placeables.PlaceableObject) return true;
        }
        return false;
    }

    _point(event: any): Vec2 {
        const pt = event.getLocalPosition(canvas.stage);
        return [pt.x, pt.y];
    }

    _onMove(event: any) {
        const pt = this._point(event);
        const hit = this.enabled && !DocumentLinks.onPlaceable(event) ? this.hoverAt(pt) : null;
        if ((hit?.object ?? null) === this.hovered) return;
        this.clear();
        if (hit) this._show(hit, pt);
    }

    _onDown(event: any) {
        if (event.button !== 0 || !this.enabled || DocumentLinks.onPlaceable(event)) return;
        const o = this.linkedAt(this._point(event));
        if (!o) {
            this.lastDown = null;
            return;
        }
        const now = performance.now();
        if (this.lastDown?.object === o && now - this.lastDown.time < DocumentLinks.DoubleClickMs) {
            this.lastDown = null;
            this.open(o);
        } else {
            this.lastDown = { object: o, time: now };
        }
    }

    /**
     * Over the object, its labels' text and the name of the document it opens; the pointer cue only
     * when there is a document. A line's tooltip is at the pointer.
     */
    _show(hit: { object: any, doc: any, labels: string[] }, pt: Vec2) {
        const { object: o, doc, labels } = hit;
        this.hovered = o;
        if (doc) document.body.classList.add("linemap-link-hover");
        const b = o.sprite ? o.sprite.getBounds() : { x: pt[0], y: pt[1] - 8, width: 1, height: 1 };
        const a = canvas.clientCoordinatesFromCanvas({ x: b.x, y: b.y });
        const c = canvas.clientCoordinatesFromCanvas({ x: b.x + b.width, y: b.y + b.height });
        if (!this.anchor) {
            this.anchor = document.createElement("div");
            this.anchor.id = "linemap-link-anchor";
            document.body.append(this.anchor);
        }
        Object.assign(this.anchor.style, {
            left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(c.x - a.x, 1)}px`, height: `${Math.max(c.y - a.y, 1)}px`
        });
        const lines = [...labels, ...(doc ? [doc.name] : [])];
        if (lines.length === 1) game.tooltip.activate(this.anchor, { text: lines[0], direction: "UP" });
        else game.tooltip.activate(this.anchor, { html: lines.map(l => foundry.utils.escapeHTML(l)).join("<br>"), direction: "UP" });
    }

    clear() {
        this.hovered = null;
        document.body.classList.remove("linemap-link-hover");
        if (this.anchor && game.tooltip?.element === this.anchor) game.tooltip.deactivate();
    }

    /** Open what an object links to: a journal at its page, a Scene by viewing it, else its sheet. */
    open(o: any) {
        const doc = DocumentLinks.viewable(o);
        if (!doc) return;
        this.clear();
        if (doc.documentName === "JournalEntryPage") {
            const JournalEntrySheet = foundry.applications.sheets.journal.JournalEntrySheet;
            if (doc.type === "image" && !doc.parent.testUserPermission(game.user, "OBSERVER")) {
                new foundry.applications.apps.ImagePopout({ src: doc.src, uuid: doc.uuid, window: { title: doc.name } }).render({ force: true });
                return;
            }
            doc.parent.sheet.render(true, { mode: JournalEntrySheet.VIEW_MODES.SINGLE, pageId: doc.id });
        } else if (doc.documentName === "Scene") {
            doc.view();
        } else {
            doc.sheet?.render(true);
        }
    }

    /** Ask the Gamemaster for a document to link an object to (by UUID), and link it. */
    async prompt(object: any) {
        const id = object.id;
        const current = foundry.utils.escapeHTML?.(object.link ?? "") ?? (object.link ?? "");
        const result = await foundry.applications.api.DialogV2.input({
            window: { title: "linemap.menu.linkDocument" },
            content: `<p class="hint">${game.i18n.localize("linemap.ui.linkHint")}</p>
                <input type="text" name="uuid" value="${current}" placeholder="JournalEntry.…" autofocus>`,
            rejectClose: false
        });
        const uuid = String(result?.uuid ?? "").trim();
        if (!uuid) return;
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) {
            ui.notifications.warn(game.i18n.format("linemap.ui.linkNotFound", { uuid }));
            return;
        }
        // The map may have been redrawn from another user's save while the dialog was open.
        const target: any = this.layer.objects.find((o: any) => o.id === id);
        if (!target) return;
        this.setLink([target], doc.uuid);
    }

    /** Link objects to a document (or unlink them, with null), as one edit. */
    setLink(objects: any[], uuid: string | null) {
        const changed = objects.filter(o => DocumentLinks.linkable(o) && o.link !== uuid);
        if (!changed.length) return;
        for (const o of changed) o.link = uuid;
        this.layer.registerHistory();
        this.layer.redraw();
    }

    /**
     * dropCanvasData: a document dropped from the sidebar onto a symbol, waypoint or label, by a
     * Gamemaster on the Line Map layer, links it; false stops core making a map note of it.
     */
    onDrop(data: any): boolean | void {
        if (!game.user.isGM || !this.layer.active || typeof data?.uuid !== "string") return;
        const o = this.linkableAt([data.x, data.y]);
        if (!o) return;
        this.setLink([o], data.uuid);
        return false;
    }
}
