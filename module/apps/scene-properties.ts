const { api } = foundry.applications;

export class ScenePropertiesApp extends api.HandlebarsApplicationMixin(
	api.ApplicationV2
) {
	static DEFAULT_OPTIONS = {
		id: 'linemap-scene-properties',
        classes: ['linemap-scene-properties'],
        tag: 'form',
        window: {
            title: 'linemap.ui.propertiesTitle'
        },
        form: {
            submitOnChange: true,
            handler: ScenePropertiesApp.handleSubmit
        }
	};

	static PARTS = {
		main: {
			template: "modules/linemap/templates/scene-properties.hbs"
		}
	};

    _prepareContext(options: any) {
        const color = canvas.linemap.color;
        const symbolScale = canvas.linemap.symbolScale;
        const labelFont = canvas.linemap.labelFont;
        const labelFonts = Object.fromEntries((CONFIG.linemap.labelFonts as string[]).map(f => [f, f]));

        const halo = canvas.linemap.halo;
        const haloColor = canvas.linemap.haloColorShown;

        return { color, symbolScale, labelFont, labelFonts, halo, haloColor };
    }

    static async handleSubmit(event, form, formData) {
        // An unfinished entry in the picker's text box is not a colour: keep the one there was.
        // The halo colour shown is the automatic one until another is picked: it stays automatic
        // (following the content colour) unless the picker now holds a colour it did not show.
        const shownHalo = canvas.linemap.haloColorShown;
        const color = String(form.elements.color?.value ?? "");
        if (/^#[0-9a-f]{6}$/i.test(color)) canvas.linemap.color = color.toLowerCase();
        if (form.elements.halo) canvas.linemap.halo = !!form.elements.halo.checked;
        const haloColor = String(form.elements.haloColor?.value ?? "").toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(haloColor) && haloColor !== shownHalo) canvas.linemap.haloColor = haloColor;
        // parseFloat gives NaN, never null, so `?? 1.0` could not fall back: check and clamp instead.
        const scale = Number(form.elements.symbolScale.value);
        canvas.linemap.symbolScale = Number.isFinite(scale) ? Math.min(Math.max(scale, 1), 2) : 1.0;
        const font = form.elements.labelFont?.value;
        if (CONFIG.linemap.labelFonts.includes(font)) canvas.linemap.labelFont = font;
        canvas.linemap.redraw();
        await canvas.linemap.dataChanged();

        this.render();
    }

    static instance: ScenePropertiesApp;

    /**
     * Show the viewed Scene's settings again: after a canvas draw (another Scene, maybe) or another
     * user's save of them. Each change saves every field, so a window left showing a Scene's old
     * values wrote them into the Scene now viewed, or over another Gamemaster's change.
     */
    static refresh() {
        if (this.instance?.rendered) this.instance.render();
    }

    static activate() {
        this.instance = this.instance ?? new ScenePropertiesApp();
        this.instance.render(true);
    }
}
