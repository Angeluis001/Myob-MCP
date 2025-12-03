# Code Execution API for MYOB (MCP)

This folder provides a lightweight code API to call your MYOB MCP server efficiently from a code-execution environment.

- Bind your MCP client via `setInvoker((tool, input) => mcp.call(tool, input))`.
- Import only the wrappers you need to minimize context usage.

## Quick start

```ts
import { setInvoker } from './client';
import * as myob from './servers/myob';

// 1) Bind your MCP client invoker
setInvoker(async (tool, input) => mcp.call(tool, input));

// 2) Use wrappers
await myob.auth.login({ name: 'user', password: '***', company: 'ACME', branch: 'MAIN' });
const list = await myob.getSalesOrders({ $top: 10 });
```

## Generate wrappers

Wrappers are generated from the OpenAPI used by the server.

- Env: `MYOB_OPENAPI_PATH` (optional). If not set, generator tries common locations.
- Run: `npm run generate:code-api`
- Output: `code-api/servers/myob/*.ts` and `index.ts`

Input shape matches server tools: `pathParams`, `query|params|queryParams`, `headers`, `body`, plus OData keys like `$filter`, `$top`, etc.

## Runtime helpers (genéricos para todas las tools)

Usa `code-api/runtime.ts` para limitar tamaño de salida de manera uniforme:

- `execList(tool | toolName, args, { select, top, maxPages, sampleSize, project })` → `{ count, sample }`
- `execSingle(tool | toolName, args, { project })` → objeto proyectado

Ejemplo:

```ts
import { execList } from './runtime';
import * as myob from './servers/myob';

const res = await execList(myob.Contact_GetList, { $filter: "substringof('Angel',DisplayName) eq true" }, {
	select: ['ContactID','DisplayName','Email'],
	top: 50,
	maxPages: 3,
	sampleSize: 5,
	project: (r: any) => ({ id: r?.ContactID?.value, name: r?.DisplayName?.value, email: r?.Email?.value })
});
// res.count y res.sample son pequeños y seguros para Copilot Studio.
```
