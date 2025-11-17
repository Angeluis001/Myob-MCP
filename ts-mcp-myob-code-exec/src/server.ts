/*
  MYOB Advanced MCP server (TypeScript)
  - Streamable HTTP transport compatible with VS Code MCP over HTTP
  - Tools generated from OpenAPI + explicit auth tools (login/logout)
*/
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHttpClient, registerAuthTools } from './auth.js';
import { loadOpenAPISpec, buildToolsFromOpenAPI } from './openapi.js';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8000);
const PATH = process.env.MYOB_HTTP_PATH || '/mcp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveSpecPath() {
  const fromEnv = process.env.MYOB_OPENAPI_PATH;
  if (fromEnv) return fromEnv;
  const candidates = [
    path.resolve(__dirname, '..', '..', 'REDBACK_TEST_API_short.json'),
    // repo root fallback (one level above project root)
    path.resolve(__dirname, '..', '..', '..', 'REDBACK_TEST_API_short.json'),
    // sibling original package copy
    path.resolve(__dirname, '..', '..', '..', 'ts-mcp-myob', 'REDBACK_TEST_API_short.json')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  // final fallback: keep default path (may error at runtime until MYOB_MODE=auth or env provided)
  return candidates[0];
}

const SPEC_PATH = resolveSpecPath();

const BASE_URL = process.env.MYOB_BASE_URL || 'https://redback.myobadvanced.com/entity/Default/24.200.001';
const LOGIN_URL = process.env.MYOB_LOGIN_URL || 'https://redback.myobadvanced.com/entity/auth/login';
const LOGOUT_URL = process.env.MYOB_LOGOUT_URL || 'https://redback.myobadvanced.com/entity/auth/logout';

async function main() {
  const name = process.env.MYOB_SERVER_NAME || 'MYOB Advanced (TS MCP)';
  const mode = (process.env.MYOB_MODE || 'full').toLowerCase();
  const mcp = new McpServer({ name, version: '1.0.0' });

  const httpClient = createHttpClient(BASE_URL);
  registerAuthTools(mcp, httpClient, LOGIN_URL, LOGOUT_URL);

  mcp.registerTool(
    'ping',
    { description: 'Connectivity check for MYOB server and MCP transport.' },
    async () => ({ content: [{ type: 'text', text: `Base URL: ${BASE_URL}` }] }) as any
  );
  mcp.registerTool(
    'echo',
    { description: 'Echo back the provided text (diagnostics tool).', inputSchema: { text: (await import('zod')).z.string() } },
    async (args: any) => ({ content: [{ type: 'text', text: String(args?.text ?? '') }] }) as any
  );

  let toolCount = 0;
  if (mode !== 'auth') {
    try {
      const spec = loadOpenAPISpec(SPEC_PATH);
      const tools = buildToolsFromOpenAPI(spec, httpClient, BASE_URL);
      const z = (await import('zod')).z;
      const openApiArgsSchemaShape = {
        pathParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        query: z.record(z.any()).optional(),
        params: z.record(z.any()).optional(),
        queryParams: z.record(z.any()).optional(),
        headers: z.record(z.string()).optional(),
        body: z.any().optional(),
        $select: z.string().optional(),
        $filter: z.string().optional(),
        $expand: z.string().optional(),
        $custom: z.string().optional(),
        $skip: z.union([z.number(), z.string()]).optional(),
        $top: z.union([z.number(), z.string()]).optional(),
        select: z.string().optional(),
        filter: z.string().optional(),
        expand: z.string().optional(),
        custom: z.string().optional(),
        skip: z.union([z.number(), z.string()]).optional(),
        top: z.union([z.number(), z.string()]).optional(),
        rawQuery: z.string().optional(),
        queryString: z.string().optional(),
      } as const;
      for (const t of tools) {
        mcp.registerTool(
          t.name,
          { description: t.description, inputSchema: openApiArgsSchemaShape as any },
          (args: any) => t.handler(args) as any
        );
      }
      toolCount = tools.length;
      console.log(`[MYOB TS MCP] Registered ${toolCount} OpenAPI tools`);
    } catch (e: any) {
      console.warn('[MYOB TS MCP] Failed to register OpenAPI tools:', e);
    }
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(transport);

  const srv = http.createServer((req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        return res.end('Bad Request');
      }
      const url = new URL(req.url, `http://${req.headers.host}`);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, accept');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Cache-Control', 'no-cache');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }
      if (url.pathname !== PATH) {
        res.statusCode = 404;
        return res.end('Not Found');
      }

      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? (c as Buffer) : Buffer.from(c)));
      req.on('end', () => {
        const bodyText = chunks.length ? Buffer.concat(chunks).toString('utf-8') : '';
        let parsed: any = undefined;
        try {
          parsed = bodyText ? JSON.parse(bodyText) : undefined;
        } catch {}
        try {
          transport.handleRequest(req as any, res as any, parsed);
        } catch (e: any) {
          console.warn('[MYOB TS MCP] transport error:', e?.message || e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'transport_failed', message: e?.message || String(e) }));
        }
      });
    } catch (e: any) {
      console.warn('[MYOB TS MCP] server error:', e?.message || e);
      try {
        res.statusCode = 500;
        res.end('Internal Error');
      } catch {}
    }
  });

  srv.listen(PORT, HOST, () =>
    console.log(`[MYOB TS MCP] HTTP server on http://${HOST}:${PORT}${PATH} (tools=${toolCount})`)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
