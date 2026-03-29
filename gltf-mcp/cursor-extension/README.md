# gltf-mcp-viewer（本地扩展）

在 Cursor / VS Code 中通过 **Webview + iframe** 打开 `http://127.0.0.1:5173` 上的 gltf-mcp 页面（需先在仓库 `gltf-mcp/` 执行 `npm run dev`）。

安装：在仓库根 `gltf-mcp/` 运行 `python dev_plugin.py`（或手动 `npx @vscode/vsce package` 后 `cursor --install-extension *.vsix`）。
