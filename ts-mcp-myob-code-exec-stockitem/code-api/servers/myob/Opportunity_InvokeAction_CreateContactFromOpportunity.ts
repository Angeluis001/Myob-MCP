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

/** Performs an action in the system. | Tool: Opportunity_InvokeAction_CreateContactFromOpportunity */
export async function Opportunity_InvokeAction_CreateContactFromOpportunity(input = {}) {
  return callMCPTool('Opportunity_InvokeAction_CreateContactFromOpportunity', input);
}
