import * as vscode from 'vscode';
import { DisassembledInstructionAdapter } from './debugExpressionHelper';
import { ASMLine } from './parser';

export class DisassembledMemoryDataProvider implements vscode.TreeDataProvider<ViewLineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ViewLineItem | undefined> = new vscode.EventEmitter<ViewLineItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ViewLineItem | undefined> = this._onDidChangeTreeData.event;
    private currentValues?: Array<ViewLineItem>;

    constructor() {
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ViewLineItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ViewLineItem): Thenable<ViewLineItem[]> {
        return new Promise((resolve, _reject) => {
            if (!element && this.currentValues) {
                resolve(this.currentValues);
            } else {
                resolve([]);
            }
        });
    }
    setDisassembledMemory(memory: DisassembledInstructionAdapter[]) {
        this.currentValues = new Array<ViewLineItem>();
        for (let dl of memory) {
            let address = dl.address;
            let asmLine = new ASMLine(` ${dl.instruction}`);
            let label = `${asmLine.instruction}  ${asmLine.data}`;
            let item = new ViewLineItem(`${address}: ${label}`);
            if (dl.instructionBytes) {
                item.description = dl.instructionBytes;
            }
            this.currentValues.push(item);
        }
        this.refresh();
    }
}

export class ViewLineItem extends vscode.TreeItem {
    public description: string = "";

    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    getdescription(): string {
        return this.description;
    }
}
