import { Point, Vec2 } from "../dto.js";
import { LineMapLayer } from "../linemap-layer.js";

export enum ToolHotkey {
    reveal,
    hide,
    reverse,
    bold,
    italic
}

export class Tool {
    /**
     * Set by the layer when it activates this tool, cleared when it deactivates it. Work a tool
     * awaits in activate() checks it is still the same activation before it puts anything on screen.
     */
    activation: object | null = null;

    constructor(public layer: LineMapLayer) {}

    activate() {}
    deactivate() {}

    stateInvalidated() {}

    onMouseMove(event, point: Point) {}
    onMouseOut(event) {}
    onDragLeftStart(event) {}
    onClickLeft(event) {}
    onClickRight(event) {}
    async onDoubleClick(event) {}
    onDragLeftMove(event) {}
    async onDragLeftDrop(event) {}
    async onDeleteKey(event) {}

    hotkeyPressed(key: ToolHotkey) {}
}
