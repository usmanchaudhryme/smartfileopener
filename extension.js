const vscode = require('vscode');
const simpleGit = require('simple-git');
const path = require('path');

class SmartFileOpenerViewProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.autoUpdate = vscode.workspace.getConfiguration('smartFileOpener').get('autoUpdate');
        this.recommendations = [];
        this.updateRecommendations();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (!element) {
            return this.recommendations.map(file => {
                const fileUri = this.getFileUri(file);
                const treeItem = new vscode.TreeItem(fileUri, vscode.TreeItemCollapsibleState.None);
                treeItem.command = {
                    command: 'smartFileOpener.openFile',
                    title: 'Open File',
                    arguments: [fileUri]
                };
                return treeItem;
            });
        }
        return [];
    }

    async updateRecommendations() {
        if (!this.autoUpdate) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentFile = vscode.workspace.asRelativePath(editor.document.fileName);
        const commitLimit = vscode.workspace.getConfiguration('smartFileOpener').get('commitLimit') || 100;
        this.recommendations = await getRecommendedFiles(currentFile, commitLimit);
        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this.updateRecommendations();
    }

    getFileUri(file) {
        const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        if (!workspaceFolder) {
            return vscode.Uri.file(file);
        }
        return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, file));
    }
}

async function getRecommendedFiles(currentFile, commitLimit) {
    const git = simpleGit(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath || '');
    const log = await git.log({ n: commitLimit });
    const fileCommitCounts = {};
    const fileCoOccurrenceCounts = {};

    const commitPromises = log.all.map(async commit => {
        const diff = await git.show([commit.hash, '--name-only', '--pretty=format:']);
        const files = diff.split('\n').filter(file => file);

        if (files.includes(currentFile)) {
            files.forEach(file => {
                if (file !== currentFile) {
                    if (!fileCoOccurrenceCounts[file]) fileCoOccurrenceCounts[file] = 0;
                    fileCoOccurrenceCounts[file]++;
                }
            });
        }

        files.forEach(file => {
            if (!fileCommitCounts[file]) fileCommitCounts[file] = 0;
            fileCommitCounts[file]++;
        });
    });

    await Promise.all(commitPromises);

    return Object.keys(fileCoOccurrenceCounts)
        .sort((a, b) => {
            if (fileCoOccurrenceCounts[b] !== fileCoOccurrenceCounts[a]) {
                return fileCoOccurrenceCounts[b] - fileCoOccurrenceCounts[a];
            }
            return fileCommitCounts[b] - fileCommitCounts[a];
        });
}

function activate(context) {
    const viewProvider = new SmartFileOpenerViewProvider(context);
    vscode.window.registerTreeDataProvider('smartFileOpenerView', viewProvider);
    vscode.commands.registerCommand('smartFileOpener.refresh', () => viewProvider.refresh());
    vscode.commands.registerCommand('smartFileOpener.openFile', async (fileUri) => {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    });

    context.subscriptions.push(vscode.commands.registerCommand('smartFileOpener.openAllRecommended', openRecommendedFiles));
    context.subscriptions.push(vscode.commands.registerCommand('smartFileOpener.showRecommended', showRecommendedFiles));

    vscode.window.onDidChangeActiveTextEditor(() => {
        if (vscode.workspace.getConfiguration('smartFileOpener').get('autoUpdate')) {
            viewProvider.updateRecommendations();
        }
    });
}

async function openRecommendedFiles() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor found');
        return;
    }
    const currentFile = vscode.workspace.asRelativePath(editor.document.fileName);
    const commitLimit = vscode.workspace.getConfiguration('smartFileOpener').get('commitLimit') || 100;
    const recommendedFiles = await getRecommendedFiles(currentFile, commitLimit);

    const maxFilesToOpen = vscode.workspace.getConfiguration('smartFileOpener').get('maxFilesToOpen') || 5;
    const filesToOpen = recommendedFiles.slice(0, maxFilesToOpen);

    for (const file of filesToOpen) {
        const fileUri = getFileUri(file);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }
}

async function showRecommendedFiles() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor found');
        return;
    }
    const currentFile = vscode.workspace.asRelativePath(editor.document.fileName);
    const commitLimit = vscode.workspace.getConfiguration('smartFileOpener').get('commitLimit') || 100;
    const recommendedFiles = await getRecommendedFiles(currentFile, commitLimit);

    if (recommendedFiles.length > 0) {
        const selectedFile = await vscode.window.showQuickPick(recommendedFiles, {
            placeHolder: 'Recommended files to open based on commit history'
        });
        if (selectedFile) {
            const fileUri = getFileUri(selectedFile);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
        }
    } else {
        vscode.window.showInformationMessage('No recommendations available');
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
