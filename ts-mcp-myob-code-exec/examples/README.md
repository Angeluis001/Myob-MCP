# Code-Exec Examples

- `init-invoker.ts`: vincula el invoker del agente (`setInvoker`) para que los wrappers llamen tools MCP.
- `find-contacts.ts`: patrón de búsqueda con `$filter`, `$select`, paginación y salida pequeña (`count` + 5 filas).

Uso (en tu agente):

```ts
import { bindInvoker } from './examples/init-invoker';
import { findContactsByName } from './examples/find-contacts';

bindInvoker(async (tool, input) => {
  // Reemplaza con tu llamada real al MCP (Copilot Studio / SDK)
  return await mcp.callTool(tool, input);
});

const res = await findContactsByName('Angel Garcia');
// res: { count, sample }
```

Consejos:
- Siempre usa `$select` y `$top`.
- Evita devolver `data` completo; loguea conteos y una muestra.
- Para nombres, usa `substringof('texto', Campo) eq true`.