import { ConstrainedPoint } from "../classes/constrained-point.js";
import { ObjectType } from "../classes/object.js";
import { SnapType } from "../dto.js";
import { Symbol } from "../objects/symbol.js";
import { BaseIconTool } from "./base-icon.js";

export class DrawSymbolTool extends BaseIconTool {
    get symbolCollection(): any { 
        return this.layer.themed(CONFIG.linemap.symbols, "symbols");
    }

    get snapTypes(): SnapType[] {
        return [SnapType.lineEnd];
    }

    _createObject(point: ConstrainedPoint): ObjectType {
        const symbol = new Symbol();
        symbol.construct(point, this.activeSymbol);
        return symbol;
    }
}
