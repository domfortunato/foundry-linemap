const { api } = foundry.applications;

export interface MenuOption {
    icon: string,
    label: string,
    handler: () => void
}

/** A slider under the menu's two buttons: input() on each step, commit() once, when let go or closed. */
export interface SizeOption {
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    input: (size: number) => void,
    commit: () => void
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
			selectOption: ContextMenu.selectOption
		}
	};

	static PARTS = {
		main: {
			template: "modules/linemap/templates/context-menu.hbs"
		}
	};

    menuOptions: Record<string, MenuOption>;

    sizeOption?: SizeOption;

    constructor(menuOptions: Record<string, MenuOption>, sizeOption?: SizeOption, options = {}) {
        super(options);

        this.menuOptions = menuOptions;
        this.sizeOption = sizeOption;
    }

    _prepareContext(options) {
        return { menuOptions: this.menuOptions, size: this.sizeOption };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const slider = this.element.querySelector('input[name="size"]');
        if (!slider || !this.sizeOption) return;
        slider.addEventListener("input", () => this.sizeOption?.input(Number(slider.value)));
        slider.addEventListener("change", () => this.sizeOption?.commit());
    }

    /** A slide the pointer carried off the menu closes it before any change event: record it now. */
    _onClose(options) {
        super._onClose?.(options);
        this.sizeOption?.commit();
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

}
