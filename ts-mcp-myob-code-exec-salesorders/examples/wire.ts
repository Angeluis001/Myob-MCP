import { bindInvoker } from './init-invoker';
import { findContactsByName } from './find-contacts';

// Vincula el invoker usando el cliente MCP del host (reemplaza según tu entorno)
// Espera un objeto global/scope `mcp` con método `callTool(name, input)`.
// En Copilot Studio, conecta aquí la invocación de la acción del conector.
declare const mcp: any;

bindInvoker(async (toolName, input) => {
  if (!mcp?.callTool) throw new Error('Falta MCP client: define mcp.callTool(toolName, input)');
  return await mcp.callTool(toolName, input);
});

// Ejemplo de uso (opcional):
export async function demoFind() {
  return await findContactsByName('Angel Garcia');
}
