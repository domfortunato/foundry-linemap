const { api } = foundry.applications;

/**
 * The Layers window: a row per group of objects (images, areas, lines, symbols and waypoints, labels),
 * each with an eye that hides the group and a lock that makes it unclickable, for this user only: the
 * map, and what players see, stay as they are. Kept in a client setting, so it survives a reload.
 */
export class LayersApp extends api.HandlebarsApplicationMixin(api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'linemap-layers',
        classes: ['linemap-layers'],
        window: {
            title: 'linemap.layers.title',
            icon: 'fas fa-layer-group'
        },
        position: { width: 280 },
        actions: {
            toggleHidden: LayersApp.toggleHidden,
            toggleLocked: LayersApp.toggleLocked
        }
    };

    static PARTS = {
        main: {
            template: "modules/linemap/templates/layers.hbs"
        }
    };

    static instance: LayersApp;

    async _prepareContext(options: any) {
        const { hidden, locked } = canvas.linemap.groups;
        return {
            groups: (canvas.linemap.constructor as any).Groups.map((group: string) => ({
                group,
                label: `linemap.layers.${group}`,
                hidden: hidden.includes(group),
                locked: locked.includes(group)
            }))
        };
    }

    static async toggleHidden(event: any, target: any) {
        const group = target.closest("[data-group]")?.dataset.group;
        if (group) await canvas.linemap.setGroup(group, "hidden", !canvas.linemap.groups.hidden.includes(group));
    }

    static async toggleLocked(event: any, target: any) {
        const group = target.closest("[data-group]")?.dataset.group;
        if (group) await canvas.linemap.setGroup(group, "locked", !canvas.linemap.groups.locked.includes(group));
    }

    static refresh() {
        if (this.instance?.rendered) this.instance.render();
    }

    static activate() {
        this.instance = this.instance ?? new LayersApp();
        this.instance.render(true);
    }
}
