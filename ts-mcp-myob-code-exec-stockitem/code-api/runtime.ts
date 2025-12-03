import { callMCPTool } from './client';

export type ToolFn = (input?: any) => Promise<any>;

export interface ExecOptions<T = any> {
  select?: string | string[]; // columnas para $select
  top?: number; // tamaño de página
  maxPages?: number; // # máximo de páginas a recorrer
  sampleSize?: number; // tamaño de muestra devuelta
  project?: (row: any) => T; // proyección por fila
}

function toSelect(select?: string | string[]) {
  if (!select) return undefined as string | undefined;
  return Array.isArray(select) ? select.join(',') : select;
}

function flattenValues(o: any) {
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && 'value' in (v as any)) out[k] = (v as any).value;
    else out[k] = v;
  }
  return out;
}

function readRows(resp: any): any[] {
  if (!resp) return [];
  const data = resp?.structuredContent?.data ?? resp?.data;
  return Array.isArray(data) ? data : [];
}

export async function execList<R = any>(
  tool: ToolFn | string,
  args: any,
  opts: ExecOptions<R> = {}
): Promise<{ count: number; sample: R[]; status?: number; request?: any }> {
  const select = toSelect(opts.select);
  const top = Math.max(1, opts.top ?? 50);
  const maxPages = Math.max(1, opts.maxPages ?? 2);
  const sampleSize = Math.max(1, opts.sampleSize ?? 5);
  const project = opts.project ?? ((row: any) => flattenValues(row)) as (row: any) => R;

  let total = 0;
  const sample: R[] = [];
  let skip = 0;

  for (let page = 0; page < maxPages; page++) {
    const input = {
      ...(args || {}),
      ...(select ? { $select: select } : {}),
      $top: top,
      $skip: skip,
    };
    const resp = typeof tool === 'string' ? await callMCPTool(tool, input) : await tool(input);
    const rows = readRows(resp);
    const batch = rows.map(project);
    total += batch.length;
    for (const b of batch) {
      if (sample.length < sampleSize) sample.push(b);
    }
    if (batch.length < top) break;
    skip += top;
  }
  return { count: total, sample };
}

export async function execSingle<R = any>(
  tool: ToolFn | string,
  args: any,
  opts: { project?: (row: any) => R } = {}
): Promise<R | null> {
  const project = opts.project ?? ((row: any) => flattenValues(row)) as (row: any) => R;
  const resp = typeof tool === 'string' ? await callMCPTool(tool, args) : await tool(args);
  const data = resp?.structuredContent?.data ?? resp?.data;
  if (!data) return null;
  return project(data);
}
