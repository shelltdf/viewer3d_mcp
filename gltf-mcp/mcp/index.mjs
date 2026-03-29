#!/usr/bin/env node
/**
 * gltf-mcp：stdio MCP 服务，经 HTTP 桥接驱动浏览器内 Vue 查看器（模式同 mindmap MCP）。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const BRIDGE_URL = (
  process.env.GLTF_MCP_BRIDGE_URL || 'http://127.0.0.1:5173'
).replace(/\/$/, '')
const BRIDGE_TOKEN = process.env.GLTF_MCP_BRIDGE_TOKEN || ''

async function bridgeCall(method, args) {
  let res
  try {
    res = await fetch(`${BRIDGE_URL}/gltf-mcp-bridge/v1/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: BRIDGE_TOKEN, method, arguments: args }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `无法连接 gltf-mcp 桥接 (${BRIDGE_URL})：${msg}。请先在本目录执行 npm run dev 或 node bridge/server.mjs，并核对 GLTF_MCP_BRIDGE_URL。`,
    )
  }
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`bridge non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!json.ok) {
    throw new Error(json.error || 'bridge error')
  }
  return json.result
}

const tools = [
  {
    name: 'get_viewer_state',
    description:
      '获取当前 gltf-mcp 浏览器查看器是否在线、最近加载的模型 URL；可选返回工具 schema（与 mindmap 的 get_editor_state 习惯一致）。',
    inputSchema: {
      type: 'object',
      properties: {
        include_schema: {
          type: 'boolean',
          description:
            '是否在结果中包含桥接命令/tools 的简要 schema（首次对接建议 true）。',
        },
      },
      required: ['include_schema'],
    },
  },
  {
    name: 'load_gltf_url',
    description:
      '在已打开的 gltf-mcp 页面中加载远程 glTF/GLB（需 CORS 可访问）。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'http(s) 模型地址，以 .gltf 或 .glb 为宜',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'reset_camera',
    description: '重置观察相机到当前模型包围盒（与页面「重置相机」一致）。',
    inputSchema: { type: 'object', properties: {} },
  },
]

const server = new Server(
  { name: 'gltf-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = request.params.arguments || {}

  if (!BRIDGE_TOKEN.trim()) {
    throw new Error(
      'GLTF_MCP_BRIDGE_TOKEN 为空。请在启动 dev/server 时设置与 .cursor/mcp.json 中一致的 token（可与 mindmap 一样用环境变量注入）。',
    )
  }

  if (name === 'get_viewer_state') {
    const result = await bridgeCall('get_viewer_state', {
      include_schema: !!args.include_schema,
    })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
  if (name === 'load_gltf_url') {
    const result = await bridgeCall('load_gltf_url', { url: args.url })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
  if (name === 'reset_camera') {
    const result = await bridgeCall('reset_camera', {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }

  throw new Error(`unknown tool: ${name}`)
})

const transport = new StdioServerTransport()
await server.connect(transport)
