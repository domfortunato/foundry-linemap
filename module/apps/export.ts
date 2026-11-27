const { api } = foundry.applications;

type Rect = { x: number, y: number, width: number, height: number };

/**
 * The Export map window: the whole scene or a dragged area, as PNG, WebP or PDF (the image in the
 * browser's print dialog, where "Save as PDF" and the paper are chosen), at 1×, 2× or 4×, on a
 * transparent or white background or the scene's background picture. The drawing is the layer's
 * exportImage.
 */
export class ExportApp extends api.HandlebarsApplicationMixin(api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'linemap-export',
        classes: ['linemap-export'],
        tag: 'form',
        window: {
            title: 'linemap.export.title',
            icon: 'fas fa-file-export'
        },
        position: { width: 380 },
        form: {
            submitOnChange: true,
            handler: ExportApp.onChange
        },
        actions: {
            pick: ExportApp.pick,
            export: ExportApp.export
        }
    };

    static PARTS = {
        main: {
            template: "modules/linemap/templates/export.hbs"
        }
    };

    static instance: ExportApp;

    rect: Rect | null = null;
    choices = { area: "scene", format: "png", scale: 1, background: "transparent", hidden: false };

    /** The area exported, in map coordinates. */
    get area(): Rect {
        return this.choices.area === "picked" && this.rect ? this.rect : canvas.dimensions.sceneRect;
    }

    async _prepareContext(options: any) {
        const area = this.area;
        const max = canvas.linemap.maxExportSize;
        const c = this.choices;
        const scales = [1, 2, 4].map(s => ({ value: s, label: `${s}×`, selected: c.scale === s, disabled: Math.max(area.width, area.height) * s > max }));
        const scale = scales.find(s => s.selected && !s.disabled) ? c.scale : 1;
        return {
            choices: c,
            picked: !!this.rect,
            scales,
            pdf: c.format === "pdf",
            sceneBackground: !!canvas.scene.background?.src,
            pixels: game.i18n.format("linemap.export.pixels", { width: Math.round(area.width * scale), height: Math.round(area.height * scale) }),
            tooBig: Math.max(area.width, area.height) * scale > max
        };
    }

    static async onChange(event: any, form: any, formData: any) {
        const data = formData.object;
        const c = this.choices;
        c.area = data.area === "picked" && this.rect ? "picked" : "scene";
        c.format = ["png", "webp", "pdf"].includes(data.format) ? data.format : "png";
        c.scale = [1, 2, 4].includes(Number(data.scale)) ? Number(data.scale) : 1;
        c.background = ["transparent", "white", "scene"].includes(data.background) ? data.background : "transparent";
        // A PDF has no transparency: paper is white.
        if (c.format === "pdf" && c.background === "transparent") c.background = "white";
        c.hidden = !!data.hidden;
        this.render();
    }

    /** Step aside while the area is dragged on the map. */
    static async pick(event: any, target: any) {
        await this.minimize();
        ui.notifications.info(game.i18n.localize("linemap.export.pickHint"));
        const rect = await canvas.linemap.pickRect();
        await this.maximize();
        if (rect) {
            this.rect = rect;
            this.choices.area = "picked";
            canvas.linemap.showRect(rect);
        }
        this.render();
    }

    static async export(event: any, target: any) {
        const c = this.choices;
        const name = (canvas.scene.name || "map").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "map";
        try {
            const blob = await canvas.linemap.exportImage({
                rect: this.area,
                scale: c.scale,
                background: c.background,
                hidden: c.hidden,
                type: c.format === "webp" ? "image/webp" : "image/png"
            });
            if (c.format === "pdf") ExportApp.print(blob, name);
            else ExportApp.download(blob, `${name}.${c.format}`);
        } catch (err) {
            ui.notifications.error(err?.message ?? String(err));
        }
    }

    static download(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    /** The image alone in a new window, fitted to the page, and the print dialog over it. */
    static print(blob: Blob, name: string) {
        const url = URL.createObjectURL(blob);
        const win = window.open("", "_blank");
        if (!win) {
            ui.notifications.warn(game.i18n.localize("linemap.export.popupBlocked"));
            return;
        }
        const doc = win.document;
        doc.title = name;
        const style = doc.createElement("style");
        style.textContent = "@page { margin: 0; } html, body { margin: 0; height: 100%; } body { display: flex; align-items: center; justify-content: center; } img { max-width: 100%; max-height: 100vh; object-fit: contain; }";
        doc.head.appendChild(style);
        const img = doc.createElement("img");
        img.alt = game.i18n.localize("linemap.export.printTitle");
        img.addEventListener("load", () => win.print(), { once: true });
        img.src = url;
        doc.body.appendChild(img);
        win.addEventListener("afterprint", () => URL.revokeObjectURL(url), { once: true });
    }

    async close(options: any = {}) {
        canvas.linemap?.capture?.cancel();
        canvas.linemap?.clearPreview();
        return super.close(options);
    }

    static activate() {
        this.instance = this.instance ?? new ExportApp();
        this.instance.render(true);
    }
}
