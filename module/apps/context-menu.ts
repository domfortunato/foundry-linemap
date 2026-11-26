const { api } = foundry.applications;

/** A row of looks under the menu (a line's styles, a symbol's kinds...): pick(key) gives the selection one. */
export interface LookOption {
    label: string,
    options: { key: string, label: string, image?: string, lineWidth: number, area: boolean, wide: boolean, active: boolean }[],
    pick: (key: string) => void
}

export interface MenuOption {
    icon: string,
    label: string,
    handler: () => void
}

/**
 * A slider under the menu's two buttons (size, rotation): input() on each step, commit() once, when
 * let go or closed. A double-click puts it back to `reset`.
 */
export interface SliderOption {
    name: string,
    label: string,
    icon: string,
    min: number,
    max: number,
    step: number,
    value: number,
    reset: number,
    input: (value: number) => void,
    commit: () => void
}

export type SizeOption = SliderOption;

/** A row of colours under the menu: pick(key) gives the selection one ("default": the scene's; "custom": ask). */
export interface ColorOption {
    label: string,
    options: { key: string, color: string, label: string, icon: string, active: boolean }[],
    pick: (key: string) => void
}

export class ContextMenu extends api.HandlebarsApplicationMixin(
	api.ApplicationV2
) {
	static DEFAULT_OPTIONS = {
		id: "linemap-context-menu",
        classes: ['linemap-menu'],
        window: {
            frame: false
        },
		actions: {
			selectOption: ContextMenu.selectOption,
			selectLook: ContextMenu.selectLook,
			selectColor: ContextMenu.selectColor
		}
	};

	static PARTS = {
		main: {
			template: "modules/linemap/templates/context-menu.hbs"
		}
	};

    menuOptions: Record<string, MenuOption>;

    sliders: SliderOption[];

    lookOption?: LookOption;

    colorOption?: ColorOption;

    constructor(menuOptions: Record<string, MenuOption>, sliders: SliderOption[] = [], lookOption?: LookOption, colorOption?: ColorOption, options = {}) {
        super(options);

        this.menuOptions = menuOptions;
        this.sliders = sliders;
        this.lookOption = lookOption;
        this.colorOption = colorOption;
    }

    _prepareContext(options) {
        // Left and right are the two big buttons; any others go in a row of small ones above them.
        const extras = Object.entries(this.menuOptions)
            .filter(([key]) => key !== 'left' && key !== 'right')
            .map(([key, option]) => ({ key, ...option }));
        const look = this.lookOption;
        const colors = this.colorOption;
        return { menuOptions: this.menuOptions, extras, sliders: this.sliders, look, colors, below: !!(this.sliders.length || look || colors) };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        for (const option of this.sliders) {
            const slider = this.element.querySelector(`input[name="${option.name}"]`);
            if (!slider) continue;
            slider.addEventListener("input", () => option.input(Number(slider.value)));
            slider.addEventListener("change", () => option.commit());
            slider.addEventListener("dblclick", () => {
                slider.value = String(option.reset);
                option.input(option.reset);
                option.commit();
            });
        }
    }

    /** A slide the pointer carried off the menu closes it before any change event: record it now. */
    _onClose(options) {
        super._onClose?.(options);
        for (const option of this.sliders) option.commit();
    }

    _attachFrameListeners() {
        super._attachFrameListeners();
        this.element.addEventListener("mouseleave", () => {
            this.close({ animate: false });
        });
    }

    static selectOption(event, target) {
        this.close({ animate: false });
        this.menuOptions[target.dataset.option]?.handler();
    }

    static selectLook(event, target) {
        this.close({ animate: false });
        this.lookOption?.pick(target.dataset.look);
    }

    static selectColor(event, target) {
        this.close({ animate: false });
        this.colorOption?.pick(target.dataset.color);
    }

}
