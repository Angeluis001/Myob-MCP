export type MCPInvoker = (toolName: string, input: any) => Promise<any>;

let invoker: MCPInvoker | null = null;

export function setInvoker(fn: MCPInvoker) {
  invoker = fn;
}

export async function callMCPTool<T = any>(toolName: string, input: any): Promise<T> {
  if (!invoker) throw new Error('No MCP invoker set. Call setInvoker(fn) to bind your client.');
  return invoker(toolName, input);
}
