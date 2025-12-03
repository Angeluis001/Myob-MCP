import { bindInvoker } from './init-invoker';
import { execList, execSingle } from '../code-api/runtime';
import * as myob from '../code-api/servers/myob';

// Vincula el invoker del host (define mcp.callTool en tu entorno real)
declare const mcp: any;
bindInvoker(async (tool, input) => {
  if (!mcp?.callTool) throw new Error('Falta MCP client: define mcp.callTool(tool, input)');
  return await mcp.callTool(tool, input);
});

// Ejemplo 1: genérico para cualquier listado (Contact)
export async function listContactsByName(name: string) {
  const filter = `substringof('${name.replace(/'/g, "''")}',DisplayName) eq true`;
  return await execList(myob.Contact_GetList, { $filter: filter }, {
    select: ['ContactID', 'DisplayName', 'Email'],
    top: 50,
    maxPages: 3,
    sampleSize: 5,
    project: (r: any) => ({
      id: r?.ContactID?.value,
      displayName: r?.DisplayName?.value,
      email: r?.Email?.value,
    }),
  });
}

// Ejemplo 2: ejecución por nombre de tool (cualquier wrapper) con las mismas garantías
export async function listByToolName(toolName: string, args: any) {
  return await execList(toolName, args, {
    top: 50,
    maxPages: 2,
    sampleSize: 5,
  });
}
