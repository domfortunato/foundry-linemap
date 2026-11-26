const { api } = foundry.applications;

/** A row of looks under the menu (a line's styles, a symbol's kinds...): pick(key) gives the selection one. */
export interface LookOption {
    label: string,
    options: { key: string, label: string, image?: string, lineWidth: number, area: boolean, active: boolean }[],
    pick: (key: string) => void
}

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
			selectOption: ContextMenu.selectOption,
			selectLook: ContextMenu.selectLook
		}
	};

	static PARTS = {
		main: {
			template: "modules/linemap/templates/context-menu.hbs"
		}
	};

    menuOptions: Record<string, MenuOption>;

    sizeOption?: SizeOption;

    lookOption?: LookOption;

    constructor(menuOptions: Record<string, MenuOption>, sizeOption?: SizeOption, lookOption?: LookOption, options = {}) {
        super(options);

        this.menuOptions = menuOptions;
        this.sizeOption = sizeOption;
        this.lookOption = lookOption;
    }

    _prepareContext(options) {
        // Left and right are the two big buttons; any others go in a row of small ones above them.
        const extras = Object.entries(this.menuOptions)
            .filter(([key]) => key !== 'left' && key !== 'right')
            .map(([key, option]) => ({ key, ...option }));
        const look = this.lookOption;
        return { menuOptions: this.menuOptions, extras, size: this.sizeOption, look, below: !!(this.sizeOption || look) };
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

    static selectLook(event, target) {
        this.close({ animate: false });
        this.lookOption?.pick(target.dataset.look);
    }

}
