// ESM generator for code-exec wrappers from OpenAPI
// Usage: npm run generate:code-api
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths robustly on Windows using fileURLToPath (decodes %20 and handles drive letters)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function sanitizeName(name) {
  return name
    .replace(/[^A-Za-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function toFunctionName(name) {
  let n = sanitizeName(name).replace(/-/g, '_');
  if (!/^[A-Za-z_]/.test(n)) n = `op_${n}`;
  return n;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

function findSpecPath() {
  const env = process.env.MYOB_OPENAPI_PATH;
  if (env && fs.existsSync(env)) return path.resolve(env);
  const candidates = [
    path.resolve(PROJECT_ROOT, 'REDBACK_TEST_API_short.json'),
    path.resolve(PROJECT_ROOT, '..', 'REDBACK_TEST_API_short.json'),
    path.resolve(PROJECT_ROOT, '..', 'ts-mcp-myob', 'REDBACK_TEST_API_short.json'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('OpenAPI spec not found. Set MYOB_OPENAPI_PATH or place REDBACK_TEST_API_short.json.');
}

function renderHeader() {
  return `import { callMCPTool } from '../../client';\n\nexport interface OpenApiArgs {\n  pathParams?: Record<string, string | number | boolean>;\n  query?: Record<string, any>;\n  params?: Record<string, any>;\n  queryParams?: Record<string, any>;\n  headers?: Record<string, string>;\n  body?: any;\n  $select?: string; $filter?: string; $expand?: string; $custom?: string; $skip?: number | string; $top?: number | string;\n  select?: string; filter?: string; expand?: string; custom?: string; skip?: number | string; top?: number | string;\n  rawQuery?: string; queryString?: string;\n}\n`;
}

function renderWrapper(fnName, toolName, summary, method, pathStr) {
  const doc = [summary || `${method.toUpperCase()} ${pathStr}`, `Tool: ${toolName}`].filter(Boolean).join(' | ');
  return `\n/** ${doc} */\nexport async function ${fnName}(input = {}) {\n  return callMCPTool('${toolName}', input);\n}\n`;
}

function main() {
  const specPath = findSpecPath();
  const spec = readJson(specPath);
  const outDir = path.resolve(PROJECT_ROOT, 'code-api', 'servers', 'myob');
  ensureDir(outDir);

  const indexLines = [];
  const EXCLUDE = /(salesperson|salespersons|adhocschema)/i;
  const paths = spec.paths || {};
  const methods = ['get', 'post', 'put', 'patch', 'delete'];

  let files = 0;

  // Write shared header file content
  const header = renderHeader();

  for (const [p, item] of Object.entries(paths)) {
    for (const m of methods) {
      if (!item[m]) continue;
      const op = item[m];
      const opId = op.operationId || `${m.toUpperCase()} ${p}`;
      const name = sanitizeName(opId);
      const summary = op.summary || op.description || `${m.toUpperCase()} ${p}`;
      const haystack = `${opId} ${p} ${summary}`;
      if (EXCLUDE.test(haystack)) continue;

      const toolName = name;
      const fnName = toFunctionName(name);
      const fileName = `${name}.ts`;
      const filePath = path.join(outDir, fileName);
      let content = `${header}${renderWrapper(fnName, toolName, summary, m, p)}`;
      fs.writeFileSync(filePath, content, 'utf-8');
      indexLines.push(`export * from './${name}.js';`);
      files++;
    }
  }

  // Write index files
  const myobIndexPath = path.join(outDir, 'index.ts');
  fs.writeFileSync(myobIndexPath, indexLines.join('\n') + '\n', 'utf-8');

  const serversDir = path.resolve(PROJECT_ROOT, 'code-api', 'servers');
  ensureDir(serversDir);
  const serversIndex = `export * as myob from './myob/index.js';\n`;
  fs.writeFileSync(path.join(serversDir, 'index.ts'), serversIndex, 'utf-8');

  console.log(`[code-api] Generated ${files} wrappers from ${specPath}`);
}

main();
