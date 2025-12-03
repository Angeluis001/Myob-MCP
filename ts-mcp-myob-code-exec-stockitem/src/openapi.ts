import fs from 'node:fs';
import path from 'node:path';
import type { CookieAxios } from './auth.js';

export function loadOpenAPISpec(specPath: string): any {
  const abs = path.resolve(specPath);
  const raw = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(raw);
}

function sanitizeName(name: string) {
  return name
    .replace(/[^A-Za-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function fillPath(template: string, params: Record<string, string | number | boolean> = {}) {
  return template.replace(/\{(.*?)\}/g, (_, key) => {
    const v = (params as any)[key];
    if (v === undefined || v === null) throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(String(v));
  });
}

export function buildToolsFromOpenAPI(spec: any, http: CookieAxios, baseUrl?: string) {
  const tools: Array<{ name: string; description: string; handler: (args: any) => Promise<any> }> = [];
  const resolvedBase: string = baseUrl || spec.servers?.[0]?.url || '';
  const paths: Record<string, any> = spec.paths || {};
  const DEBUG_HTTP = ((process.env.MYOB_DEBUG_HTTP || '').toLowerCase() as string) in ({ '1': 1, true: 1, yes: 1 } as any);
  const EXCLUDE = /(salesperson|salespersons)/i;
  const APPLY_DEFAULTS = ((process.env.MYOB_APPLY_DEFAULTS || '').toLowerCase() as string) in ({ '1': 1, true: 1, yes: 1 } as any);
  const DEFAULT_TOP = Number(process.env.DEFAULT_TOP || '50');
  const DEFAULT_SELECT = (process.env.DEFAULT_SELECT || '').trim();
  const RESPONSE_MODE = (process.env.MYOB_RESPONSE_MODE || 'summary').toLowerCase(); // 'summary' | 'full'
  const SAMPLE_SIZE = Math.max(1, Number(process.env.MYOB_SAMPLE_SIZE || '5'));
  const PREVIEW_MAX = Math.max(512, Number(process.env.MYOB_PREVIEW_MAX_BYTES || '12000'));

  for (const [p, item] of Object.entries(paths)) {
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const m of methods) {
      if (!(item as any)[m]) continue;
      const op = (item as any)[m];
      const opId = op.operationId || `${m.toUpperCase()} ${p}`;
      const name = sanitizeName(opId);
      const description = op.summary || op.description || `${m.toUpperCase()} ${p}`;
      const haystack = `${opId} ${p} ${description}`;
      if (EXCLUDE.test(haystack)) continue;

      const handler = async (args: any) => {
        let a: any = args;
        try {
          if (typeof a === 'string') { try { a = JSON.parse(a); } catch {} }
          if (a && typeof a === 'object') {
            if (a.arguments && typeof a.arguments === 'object') a = a.arguments;
            if (a.input && typeof a.input === 'object') a = a.input;
            if (Array.isArray(a.content)) {
              const jsonPart = a.content.find((c: any) => c && c.type === 'json' && c.json);
              const textPart = a.content.find((c: any) => c && c.type === 'text' && typeof c.text === 'string');
              if (jsonPart) a = jsonPart.json; else if (textPart) { try { a = JSON.parse(textPart.text); } catch {} }
            }
          }
        } catch {}

        const pathParams = a?.pathParams || {};
        const query: Record<string, any> = { ...(a?.query || {}), ...(a?.params || {}), ...(a?.queryParams || {}) };
        const TOP_LEVEL_QUERY_KEYS = ['$select', '$filter', '$expand', '$custom', '$skip', '$top'];
        const ALIASES: Record<string, string> = { select: '$select', filter: '$filter', expand: '$expand', custom: '$custom', skip: '$skip', top: '$top' };
        for (const k of TOP_LEVEL_QUERY_KEYS) { if (a && Object.prototype.hasOwnProperty.call(a, k) && query[k] === undefined) query[k] = a[k]; }
        for (const [alias, dollar] of Object.entries(ALIASES)) { if (a && Object.prototype.hasOwnProperty.call(a, alias) && query[dollar] === undefined) query[dollar] = (a as any)[alias]; }
        for (const [alias, dollar] of Object.entries(ALIASES)) { if ((query as any)[alias] !== undefined && (query as any)[dollar] === undefined) { (query as any)[dollar] = (query as any)[alias]; delete (query as any)[alias]; } }

        if (DEBUG_HTTP) { try { console.log('[MYOB TS MCP][ARGS]', JSON.stringify(a).slice(0, 1500)); } catch {} }
        if (APPLY_DEFAULTS && m === 'get') {
          if (query['$top'] === undefined) query['$top'] = DEFAULT_TOP;
          if (query['$select'] === undefined && DEFAULT_SELECT.length > 0) query['$select'] = DEFAULT_SELECT;
        }

        const headers: Record<string, string> = a?.headers || {};
        if (!headers['Accept'] && !headers['accept']) headers['Accept'] = '*/*';
        if (!headers['Accept-Encoding'] && !headers['accept-encoding']) headers['Accept-Encoding'] = 'gzip, deflate, br';
        if (!headers['Connection'] && !headers['connection']) headers['Connection'] = 'keep-alive';

        const body = a?.body;
        const rel = fillPath(p, pathParams);
        const url = new URL(rel.replace(/^\//, ''), resolvedBase.endsWith('/') ? resolvedBase : resolvedBase + '/').toString();

        let finalUrl = url;
        const rawQuery = (a && (typeof a.rawQuery === 'string' ? a.rawQuery : a.queryString && typeof a.queryString === 'string' ? a.queryString : undefined)) || undefined;
        const useParams = !rawQuery;
        if (rawQuery && rawQuery.trim()) { const q = rawQuery.trim().replace(/^\?/, ''); finalUrl = url + (url.includes('?') ? '&' : '?') + q; }

        try {
          const jar: any = (http as any).__cookieJar || (http.defaults as any)?.jar;
          if (jar && !headers['Cookie'] && !headers['cookie']) {
            let cookieStr = await new Promise<string>((resolve) => { try { jar.getCookieString(url, (err: any, cookies: any) => resolve(err ? '' : cookies || '')); } catch { resolve(''); } });
            if (!cookieStr) {
              try {
                const list = await new Promise<any[]>((resolve) => { try { jar.getCookies(url, { allPaths: true }, (err: any, cookies: any) => resolve(err ? [] : (cookies || []))); } catch { resolve([]); } });
                if (list?.length) cookieStr = list.map((c: any) => `${(c as any).key || c.name}=${c.value}`).join('; ');
              } catch {}
            }
            if (!cookieStr) { try { cookieStr = (http as any).__cookieHeader || ''; } catch {} }
            if (!cookieStr) { try { cookieStr = (http.defaults as any)?.headers?.common?.['Cookie'] || ''; } catch {} }
            if (cookieStr) headers['Cookie'] = cookieStr;
          }
        } catch {}

        const redactedHeaders = { ...(headers || {}) } as Record<string, any>;
        const redact = (k: string) => k.toLowerCase() === 'authorization' || k.toLowerCase() === 'cookie' || k.toLowerCase() === 'set-cookie';
        Object.keys(redactedHeaders || {}).forEach((k) => { if (redact(k)) redactedHeaders[k] = '[REDACTED]'; });
        const bodyPreview = (() => { try { const txt = typeof body === 'string' ? body : JSON.stringify(body); if (!txt) return undefined; return txt.length > PREVIEW_MAX ? txt.slice(0, PREVIEW_MAX) + `\n...[truncated ${txt.length - PREVIEW_MAX} bytes]` : txt; } catch { return undefined; } })();

        try {
          if (DEBUG_HTTP) { console.log('[MYOB TS MCP][HTTP OUT]', m.toUpperCase(), finalUrl, { query, rawQuery: rawQuery || undefined, useParams, headers: redactedHeaders, body: bodyPreview }); }
          const serializeParams = (params: Record<string, any>) => { const parts: string[] = []; for (const [k, v] of Object.entries(params || {})) { if (v === undefined || v === null) continue; parts.push(`${k}=${encodeURIComponent(String(v))}`); } return parts.join('&'); };
          const resp = await http.request({ method: m.toUpperCase(), url: finalUrl, params: useParams ? query : undefined, paramsSerializer: useParams ? { serialize: serializeParams as any } : undefined, headers, data: body, withCredentials: true } as any);
          let data = (resp as any).data;
          const makeTextPreview = () => {
            try {
              const isArray = Array.isArray(data);
              const count = isArray ? (data as any[]).length : data && typeof data === 'object' ? 1 : 0;
              const snippet = (() => { const txt = typeof data === 'string' ? data : JSON.stringify(data, null, 2); if (!txt) return ''; return txt.length > PREVIEW_MAX ? txt.slice(0, PREVIEW_MAX) + `\n...[truncated ${txt.length - PREVIEW_MAX} bytes]` : txt; })();
              return `status: ${(resp as any).status}\nitems: ${count}\nurl: ${finalUrl}\npreview:\n${snippet}`;
            } catch { return `status: ${(resp as any).status}\nurl: ${finalUrl}`; }
          };
          if (DEBUG_HTTP) { console.log('[MYOB TS MCP][HTTP IN]', (resp as any).status, finalUrl); }
          const headersOut = Object.fromEntries(Object.entries((resp as any).headers || {}).map(([k, v]) => [k, redact(k) ? '[REDACTED]' : v]));
          const baseStructured: any = { status: (resp as any).status, headers: headersOut, request: { method: m.toUpperCase(), url: finalUrl, query, rawQuery: rawQuery || undefined, useParams, headers: redactedHeaders, body: bodyPreview } };
          if (RESPONSE_MODE === 'summary' && Array.isArray(data)) {
            const count = (data as any[]).length;
            const sample = (data as any[]).slice(0, SAMPLE_SIZE);
            return { content: [{ type: 'text' as const, text: makeTextPreview() }], structuredContent: { ...baseStructured, count, sample } };
          }
          return { content: [{ type: 'text' as const, text: makeTextPreview() }], structuredContent: { ...baseStructured, data } };
        } catch (err: any) {
          const status = err?.response?.status ?? 500;
          const data = err?.response?.data ?? err?.message ?? 'Request failed';
          const respHeaders = err?.response?.headers || {};
          if (DEBUG_HTTP) { console.warn('[MYOB TS MCP][HTTP ERR]', status, finalUrl, err?.message); }
          const errPreview = typeof data === 'string' ? data : (() => { try { return JSON.stringify(data, null, 2); } catch { return String(data); } })();
          return { content: [{ type: 'text' as const, text: `status: ${status}\nurl: ${finalUrl}\nerror: ${errPreview?.slice?.(0, Math.min(1000, PREVIEW_MAX))}` }], structuredContent: { status, error: true, data, headers: Object.fromEntries(Object.entries(respHeaders).map(([k, v]) => [k, k.toLowerCase() === 'authorization' || k.toLowerCase() === 'cookie' || k.toLowerCase() === 'set-cookie' ? '[REDACTED]' : v])), request: { method: m.toUpperCase(), url: finalUrl, query, rawQuery: rawQuery || undefined, useParams, headers: redactedHeaders, body: bodyPreview } } };
        }
      };

      tools.push({ name, description, handler });
    }
  }

  return tools;
}
