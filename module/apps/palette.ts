const { api } = foundry.applications;

/**
 * The floating tool palette: the Line Map tools, toggles and buttons in a small window you can drag
 * anywhere, instead of the tools column on Foundry's left bar (hidden while it shows). A client
 * setting, off by default. It shows only while the Line Map control is active; the control's own
 * button stays on the left bar, since Foundry switches to the layer through it. The palette mirrors
 * Foundry's scene controls: a click does what the same button on the left bar does.
 */
export class PaletteApp extends api.HandlebarsApplicationMixin(api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'linemap-palette',
        classes: ['linemap-palette'],
        window: {
            title: 'linemap.palette.title',
            icon: 'fas fa-map-location-dot',
            minimizable: false,
            resizable: false
        },
        position: { width: 'auto', height: 'auto' },
        actions: {
            tool: PaletteApp.onTool
        }
    };

    static PARTS = {
        main: {
            template: "modules/linemap/templates/palette.hbs"
        }
    };

    static instance: PaletteApp | null = null;
    /** The palette is being closed because the Line Map control was left, not by its close button. */
    static closingForSync = false;

    static get enabled(): boolean {
        try { return !!game.settings.get("linemap", "floatingPalette"); } catch { return false; }
    }

    static get savedPosition(): { left?: number, top?: number } {
        try { return game.settings.get("linemap", "palettePosition") ?? {}; } catch { return {}; }
    }

    constructor(options: any = {}) {
        const saved = PaletteApp.savedPosition;
        const left = Number.isFinite(saved.left) ? saved.left : 110;
        const top = Number.isFinite(saved.top) ? saved.top : 90;
        super(foundry.utils.mergeObject({ position: { left, top } }, options));
    }

    async _prepareContext(options: any) {
        const control = ui.controls.controls?.linemap;
        const tools = Object.values(control?.tools ?? {})
            .filter((t: any) => t.visible !== false)
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)) as any[];
        const current = ui.controls.control?.name === "linemap" ? ui.controls.tool?.name : null;
        const view = (t: any) => ({
            name: t.name,
            icon: t.icon,
            title: t.title,
            active: t.toggle ? !!t.active : (!t.button && t.name === current)
        });
        return {
            drawing: tools.filter(t => !t.toggle && !t.button).map(view),
            others: tools.filter(t => t.toggle || t.button).map(view)
        };
    }

    /** What the same button on the left bar does: pick a tool, flip a toggle, or run a button. */
    static onTool(event: any, target: any) {
        const name = target.dataset.tool;
        const tool = ui.controls.controls?.linemap?.tools?.[name];
        if (!tool) return;
        if (tool.button) {
            tool.onChange?.(event, true);
            return;
        }
        if (tool.toggle) {
            ui.controls.activate({ control: "linemap", toggles: { [name]: !tool.active } });
            return;
        }
        ui.controls.activate({ control: "linemap", tool: name });
    }

    /** Where it was dragged, kept for the next time (a client setting), a moment after the drag. */
    _savePosition = foundry.utils.debounce((left: number, top: number) => {
        game.settings.set("linemap", "palettePosition", { left: Math.round(left), top: Math.round(top) });
    }, 300);

    _onPosition(position: any) {
        super._onPosition?.(position);
        if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) this._savePosition(position.left, position.top);
    }

    /** Closed by its close button: the palette is turned off, and the tools go back to the left bar. */
    _onClose(options: any) {
        super._onClose?.(options);
        if (PaletteApp.instance === this) PaletteApp.instance = null;
        if (!PaletteApp.closingForSync && PaletteApp.enabled) game.settings.set("linemap", "floatingPalette", false);
        document.body.classList.remove("linemap-palette-on");
    }

    /** Show the current tool and toggles again, when the palette is open. */
    static refresh() {
        if (PaletteApp.instance?.rendered) PaletteApp.instance.render();
    }

    /**
     * Show the palette while it is turned on and the Line Map control is active, and hide the left bar's
     * tools column meanwhile; otherwise close it. Called when the scene controls render (a tool, a toggle
     * or a control changed) and when the setting changes.
     */
    static sync() {
        const show = PaletteApp.enabled && !!canvas?.ready && !!canvas.linemap && ui.controls?.control?.name === "linemap";
        document.body.classList.toggle("linemap-palette-on", show);
        if (show) {
            PaletteApp.instance ??= new PaletteApp();
            PaletteApp.instance.render({ force: true });
        } else if (PaletteApp.instance) {
            const app = PaletteApp.instance;
            PaletteApp.instance = null;
            PaletteApp.closingForSync = true;
            Promise.resolve(app.close({ animate: false })).finally(() => { PaletteApp.closingForSync = false; });
        }
    }
}
