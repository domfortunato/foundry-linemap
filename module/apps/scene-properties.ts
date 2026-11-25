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

        return { color, symbolScale, labelFont, labelFonts };
    }

    static async handleSubmit(event, form, formData) {
        // An unfinished entry in the picker's text box is not a colour: keep the one there was.
        const color = String(form.elements.color?.value ?? "");
        if (/^#[0-9a-f]{6}$/i.test(color)) canvas.linemap.color = color.toLowerCase();
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

    static activate() {
        this.instance = this.instance ?? new ScenePropertiesApp();
        this.instance.render(true);
    }
}
