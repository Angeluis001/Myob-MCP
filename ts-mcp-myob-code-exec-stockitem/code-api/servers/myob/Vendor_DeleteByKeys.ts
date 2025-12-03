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

/** Deletes the record by the values of its key fields. | Tool: Vendor_DeleteByKeys */
export async function Vendor_DeleteByKeys(input = {}) {
  return callMCPTool('Vendor_DeleteByKeys', input);
}
