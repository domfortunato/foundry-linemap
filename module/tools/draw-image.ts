import { Tool } from "../classes/tool.js";
import { Vec2 } from "../dto.js";
import { MapImage } from "../objects/image.js";

/**
 * Place a picture: a click opens Foundry's file picker, and the picked image is placed centred on
 * the click at its own size (smaller, if it is bigger than the Scene).
 */
export class DrawImageTool extends Tool {
    /** The last picked file, where the next picker opens. */
    lastPath = "";

    activate() {
        this.layer.setSelection();
    }

    onClickLeft(event: any) {
        const pt: Vec2 = [event.interactionData.destination.x, event.interactionData.destination.y];
        const scene = canvas.scene;
        const FilePicker = foundry.applications.apps.FilePicker.implementation;
        new FilePicker({
            type: "image",
            current: this.lastPath,
            callback: (path: string) => this.place(path, pt, scene)
        }).render(true);
    }

    async place(path: string, pt: Vec2, scene: any) {
        if (!path) return;
        this.lastPath = path;
        const texture = await foundry.canvas.loadTexture(path);
        if (!texture) {
            ui.notifications.error(game.i18n.format("linemap.ui.imageNotLoaded", { path }));
            return;
        }
        // The Scene changed while the picker was open: the click was on another map.
        if (scene !== canvas.scene) return;
        this.layer.imageTextures.set(path, texture);
        const area = canvas.dimensions.sceneRect;
        const k = Math.min(1, area.width / texture.width, area.height / texture.height);
        const w = texture.width * k;
        const h = texture.height * k;
        const image = new MapImage();
        image.construct(path, [pt[0] - w / 2, pt[1] - h / 2, w, h]);
        // addObject saves, records the edit and redraws.
        this.layer.addObject(image);
    }
}
