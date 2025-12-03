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

/** Deletes the record by its session identifier. | Tool: Lead_DeleteById */
export async function Lead_DeleteById(input = {}) {
  return callMCPTool('Lead_DeleteById', input);
}
