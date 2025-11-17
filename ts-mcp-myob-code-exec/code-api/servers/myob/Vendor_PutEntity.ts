import { callMCPTool } from '../../client';

export interface OpenApiArgs {
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, any>;
  params?: Record<string, any>;
  queryParams?: Record<string, any>;
  headers?: Record<string, string>;
  body?: any;
  $select?: string; $filter?: string; $expand?: string; $custom?: string; $skip?: number | string; $top?: number | string;
  select?: string; filter?: string; expand?: string; custom?: string; skip?: number | string; top?: number | string;
  rawQuery?: string; queryString?: string;
}

/** Creates a record or updates an existing record. | Tool: Vendor_PutEntity */
export async function Vendor_PutEntity(input = {}) {
  return callMCPTool('Vendor_PutEntity', input);
}
