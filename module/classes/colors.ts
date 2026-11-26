import { ColorOption } from "../apps/context-menu.js";
import { ObjectType } from "./object.js";

/**
 * Per-object colours (the right-click menu's row of colours). An object with no colour of its own
 * (null) is drawn in the scene's content colour and follows it when it changes.
 */
export function colorOption(layer: any, selection: ObjectType[]): ColorOption | undefined {
    const colorable = selection.filter(o => o.colorable);
    if (!colorable.length) return undefined;
    const current = new Set(colorable.map(o => o.color));
    const one = current.size === 1 ? [...current][0] : undefined;
    const palette: string[] = CONFIG.linemap.colors ?? [];
    return {
        label: "linemap.menu.color.label",
        options: [
            { key: "default", color: layer.color, label: "linemap.menu.color.default", icon: "fa-rotate-left", active: one === null },
            ...palette.map(c => ({ key: c, color: c, label: c, icon: "", active: one === c })),
            { key: "custom", color: "", label: "linemap.menu.color.custom", icon: "fa-palette", active: !!one && !palette.includes(one) }
        ],
        pick: (key: string) => {
            if (key === "custom") promptColor(layer, colorable, one ?? null);
            else setColor(layer, colorable, key === "default" ? null : key);
        }
    };
}

/** Give objects a colour (null: the scene's), as one edit. */
export function setColor(layer: any, objects: ObjectType[], color: string | null) {
    const c = color === null ? null : ObjectType.colorOf(color);
    if (color !== null && !c) return;
    const changed = objects.filter(o => o.colorable && o.color !== c);
    if (!changed.length) return;
    for (const o of changed) o.color = c;
    layer.registerHistory();
    layer.redraw();
}

/** Ask for any colour (a dialog: the browser's own picker would close the menu), and give it. */
async function promptColor(layer: any, objects: ObjectType[], current: string | null) {
    const ids = new Set(objects.map(o => o.id));
    const result = await foundry.applications.api.DialogV2.input({
        window: { title: "linemap.menu.color.custom" },
        content: `<input type="color" name="color" value="${current ?? layer.color}" autofocus>`,
        rejectClose: false
    });
    const color = ObjectType.colorOf(result?.color);
    if (!color) return;
    // The map may have been redrawn from another user's save while the dialog was open.
    setColor(layer, layer.objects.filter((o: ObjectType) => ids.has(o.id)), color);
}
