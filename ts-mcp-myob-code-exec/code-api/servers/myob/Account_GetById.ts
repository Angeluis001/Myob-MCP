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

/** Retrieves a record by the value of the session entity ID from the system. | Tool: Account_GetById */
export async function Account_GetById(input = {}) {
  return callMCPTool('Account_GetById', input);
}
