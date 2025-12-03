import { setInvoker } from '../code-api/client';

// En Copilot Studio u otro agente, vincula aquí la llamada MCP.
// Ejemplo genérico:
// setInvoker(async (toolName, input) => {
//   return await mcp.callTool(toolName, input);
// });

// Localmente, este archivo es un placeholder; el agente real debe proveer el invoker.
export function bindInvoker(fn: (tool: string, input: any) => Promise<any>) {
  setInvoker(fn);
}
