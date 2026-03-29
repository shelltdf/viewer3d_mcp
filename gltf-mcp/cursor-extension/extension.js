'use strict'

const vscode = require('vscode')

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerCommand('gltfMcp.openViewer', () => {
    const port =
      vscode.workspace.getConfiguration('gltfMcp').get('devServerPort') ?? 5173
    const url = `http://127.0.0.1:${port}/`

    const panel = vscode.window.createWebviewPanel(
      'gltfMcpViewer',
      'gltf-mcp',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    )

    panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *; script-src * 'unsafe-inline'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src * ws: wss: http: https:;">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0f1115;}iframe{border:0;width:100%;height:100vh;}</style>
</head><body>
<iframe src="${url}" title="gltf-mcp"></iframe>
</body></html>`
  })

  context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = { activate, deactivate }
