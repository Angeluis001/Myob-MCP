import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { CookieJar } from 'tough-cookie';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface CookieAxios extends AxiosInstance {
  __cookieJar?: any;
  __cookieHeader?: string;
}

function toAbsoluteUrl(config: { url?: string; baseURL?: string; axiosInstance?: AxiosInstance }) {
  const base = config.baseURL || (config?.axiosInstance && (config.axiosInstance.defaults as any)?.baseURL) || '';
  const rel = typeof config.url === 'string' ? config.url : '';
  return new URL(rel, base).toString();
}

export function createHttpClient(baseURL: string): CookieAxios {
  const jar = new CookieJar();
  const client = axios.create({ baseURL, headers: { Accept: 'application/json' }, withCredentials: true }) as CookieAxios;
  client.__cookieJar = jar;
  client.interceptors.request.use(async (config) => {
    try {
      const url = toAbsoluteUrl({ url: config.url, baseURL: (config.baseURL as string) || (client.defaults as any).baseURL });
      let cookieStr = await new Promise<string>((resolve) => {
        try { jar.getCookieString(url, (err: any, cookies: any) => resolve(err ? '' : cookies || '')); } catch { resolve(''); }
      });
      if (!cookieStr) {
        try {
          const list = await new Promise<any[]>((resolve) => {
            try { jar.getCookies(url, { allPaths: true }, (err: any, cookies: any) => resolve(err ? [] : (cookies || []))); } catch { resolve([]); }
          });
          if (list?.length) cookieStr = list.map((c: any) => `${(c as any).key || c.name}=${c.value}`).join('; ');
        } catch {}
      }
      if (cookieStr) {
        (config.headers as any) = config.headers || {};
        if (!(config.headers as any)['Cookie'] && !(config.headers as any)['cookie']) (config.headers as any)['Cookie'] = cookieStr;
      }
    } catch {}
    (config as any).withCredentials = true;
    return config;
  });
  client.interceptors.response.use(async (resp) => {
    try {
      const setCookie = (resp as any)?.headers?.['set-cookie'] as string[] | undefined;
      if (setCookie && setCookie.length) {
        const url = toAbsoluteUrl({ url: (resp as any)?.config?.url, baseURL: ((resp as any)?.config?.baseURL as string) || (client.defaults as any).baseURL });
        await Promise.all(setCookie.map((sc) => new Promise<void>((resolve) => { try { jar.setCookie(sc, url, () => resolve()); } catch { resolve(); } })));
      }
    } catch {}
    return resp;
  });
  return client;
}

async function getCookiesForOrigin(http: CookieAxios, origin: string) {
  const jar = http.__cookieJar;
  if (!jar) return [] as Array<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean }>;
  let originUrl = origin;
  try { const o = new URL(origin); originUrl = new URL('/', o.origin).toString(); } catch { try { originUrl = new URL('/', origin).toString(); } catch {} }
  return await new Promise<Array<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean }>>((resolve) => {
    try {
      jar.getCookies(originUrl, { allPaths: true }, (err: any, cookies: any[]) => {
        if (err || !cookies) return resolve([]);
        resolve(cookies.map((c: any) => ({ name: (c as any).key || c.name, value: c.value, domain: c.domain, path: c.path, secure: !!(c as any).secure, httpOnly: !!(c as any).httpOnly })));
      });
    } catch { resolve([]); }
  });
}

export function registerAuthTools(mcp: McpServer, http: CookieAxios, loginUrl: string, logoutUrl: string) {
  const DEBUG_HTTP = ((process.env.MYOB_DEBUG_HTTP || '').toLowerCase() as string) in ({ '1': 1, true: 1, yes: 1 } as any);
  const redactHdr = (k: string) => /^(authorization|cookie|set-cookie)$/i.test(k);
  const redactObj = (o: Record<string, any>) => { const out: Record<string, any> = {}; if (!o) return out; for (const [k, v] of Object.entries(o)) out[k] = redactHdr(k) ? '[REDACTED]' : v; return out; };
  const LoginInput = { name: z.string().min(1).optional(), username: z.string().optional(), user: z.string().optional(), email: z.string().optional(), password: z.string().min(1).optional(), company: z.string().min(1).optional(), branch: z.string().min(1).optional() } as const;
  mcp.registerTool('login', { description: 'Login to MYOB (cookie session). Required before calling other tools.', inputSchema: LoginInput }, (async (args: unknown) => {
    let a: any = args; try { if (typeof a === 'string') { try { a = JSON.parse(a); } catch {} } if (a && typeof a === 'object') { if ((a as any).arguments && typeof (a as any).arguments === 'object') a = (a as any).arguments; if ((a as any).input && typeof (a as any).input === 'object') a = (a as any).input; if (Array.isArray((a as any).content)) { const jsonPart = (a as any).content.find((c: any) => c && c.type === 'json' && c.json); const textPart = (a as any).content.find((c: any) => c && c.type === 'text' && typeof c.text === 'string'); if (jsonPart) a = jsonPart.json; else if (textPart) { try { a = JSON.parse(textPart.text); } catch {} } } } } catch {}
    if (DEBUG_HTTP) { try { console.log('[MYOB TS MCP][LOGIN ARGS]', JSON.stringify(a).slice(0, 1500)); } catch {} }
    const envJson = process.env.MYOB_AUTOLOGIN_JSON as string | undefined; let envCreds: any = {}; try { envCreds = envJson ? JSON.parse(envJson) : {}; } catch {}
    const payload = { name: a?.name ?? a?.username ?? a?.user ?? a?.email ?? envCreds?.name ?? envCreds?.username ?? envCreds?.user ?? envCreds?.email ?? process.env.MYOB_LOGIN_NAME, password: a?.password ?? envCreds?.password ?? process.env.MYOB_LOGIN_PASSWORD, company: a?.company ?? envCreds?.company ?? process.env.MYOB_LOGIN_COMPANY, branch: a?.branch ?? envCreds?.branch ?? process.env.MYOB_LOGIN_BRANCH };
    if (!payload.name || !payload.password || !payload.company || !payload.branch) {
      const missing = [!payload.name ? 'name' : null, !payload.password ? 'password' : null, !payload.company ? 'company' : null, !payload.branch ? 'branch' : null].filter(Boolean);
      const msg = `Missing credentials: ${missing.join(', ')}. Provide args or set MYOB_AUTOLOGIN_JSON or MYOB_LOGIN_* env vars.`;
      if (DEBUG_HTTP) console.warn('[MYOB TS MCP][LOGIN ARG ERROR]', msg);
      return { content: [{ type: 'text' as const, text: msg }], structuredContent: { status_code: 400, ok: false, data: msg } };
    }
    try {
      try { const preUrl = new URL('/', new URL(loginUrl).origin).toString(); if (DEBUG_HTTP) console.log('[MYOB TS MCP][LOGIN OUT]', 'GET', preUrl); const pre = await http.get(preUrl, { withCredentials: true }); if (DEBUG_HTTP) console.log('[MYOB TS MCP][LOGIN IN]', (pre as any)?.status, preUrl); } catch {}
      const outHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const redactedPayload = { ...payload, password: payload.password ? '***' : undefined };
      if (DEBUG_HTTP) console.log('[MYOB TS MCP][LOGIN OUT]', 'POST', loginUrl, { headers: outHeaders, payload: redactedPayload });
      const resp = await http.post(loginUrl, payload, { headers: outHeaders, withCredentials: true });
      if (DEBUG_HTTP) console.log('[MYOB TS MCP][LOGIN IN]', (resp as any)?.status, loginUrl, { headers: redactObj((resp as any)?.headers || {}) });
      try {
        const setCookie = (resp as any)?.headers?.['set-cookie'] as string[] | undefined;
        if (setCookie && setCookie.length) {
          const originAbs = new URL('/', new URL(loginUrl).origin).toString();
          const apiBase = (http?.defaults as any)?.baseURL || '';
          const apiOriginAbs = apiBase ? new URL('/', new URL(apiBase).origin).toString() : originAbs;
          const jar = http.__cookieJar as any;
          await Promise.all(setCookie.map((sc) => new Promise<void>((resolve) => { try { jar.setCookie(sc, originAbs, () => resolve()); } catch { resolve(); } })));
          await Promise.all(setCookie.map((sc) => new Promise<void>((resolve) => { try { jar.setCookie(sc, apiOriginAbs, () => resolve()); } catch { resolve(); } })));
          try {
            const list = await new Promise<any[]>((resolve) => { try { jar.getCookies(apiOriginAbs, { allPaths: true }, (err: any, cookies: any) => resolve(err ? [] : (cookies || []))); } catch { resolve([]); } });
            const hdr = list?.length ? list.map((c: any) => `${(c as any).key || c.name}=${c.value}`).join('; ') : '';
            if (hdr) {
              http.__cookieHeader = hdr;
              try {
                (http.defaults as any) = http.defaults || ({} as any);
                (http.defaults as any).headers = (http.defaults as any).headers || {};
                const common = (((http.defaults as any).headers.common = (http.defaults as any).headers.common || {}) as Record<string, string>);
                if (!common['Cookie']) common['Cookie'] = hdr;
              } catch {}
              if (DEBUG_HTTP) console.log('[MYOB TS MCP][LOGIN COOKIE HEADER]', hdr ? '[SET]' : '[EMPTY]');
            }
            if (DEBUG_HTTP) {
              const loginOrigin = new URL(loginUrl).origin;
              const apiOrigin = apiOriginAbs;
              const loginCookies = await getCookiesForOrigin(http, loginOrigin);
              const apiCookies = await getCookiesForOrigin(http, apiOrigin);
              console.log('[MYOB TS MCP][LOGIN COOKIES]', { loginOrigin, loginCookies, apiOrigin, apiCookies, defaultsCookie: (http as any).defaults?.headers?.common?.['Cookie'] ? '[SET]' : '[EMPTY]' });
            }
          } catch {}
        }
      } catch {}
      let data: any; try { data = (resp as any).data; } catch { data = undefined; }
      const origin = new URL(loginUrl).origin;
      const cookies = await getCookiesForOrigin(http, origin);
      return { content: [{ type: 'text' as const, text: 'login ok' }], structuredContent: { status_code: (resp as any).status, ok: (resp as any).status >= 200 && (resp as any).status < 300, data, origin, cookies } };
    } catch (err: any) {
      if (DEBUG_HTTP) console.warn('[MYOB TS MCP][LOGIN ERR]', err?.response?.status ?? '-', err?.message);
      const status = err?.response?.status ?? 500; const data = err?.response?.data ?? err?.message ?? 'Login failed';
      return { content: [{ type: 'text' as const, text: 'login failed' }], structuredContent: { status_code: status, ok: false, data } };
    }
  }) as any);
  mcp.registerTool('login_raw', { description: 'Login using a raw JSON string or object. Fields: name,password,company,branch.' }, (async (raw: any) => {
    try {
      let payload: any = raw;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch {} }
      if (payload && typeof payload === 'object') {
        if (payload.arguments) payload = payload.arguments;
        if (payload.input) payload = payload.input;
        if (Array.isArray(payload.content)) {
          const j = payload.content.find((c: any) => c?.type === 'json' && c.json)?.json;
          const t = payload.content.find((c: any) => c?.type === 'text' && typeof c.text === 'string')?.text;
          if (j) payload = j; else if (t) { try { payload = JSON.parse(t); } catch {} }
        }
      }
      const a = payload || {};
      const body = { name: a.name ?? a.username ?? a.user ?? a.email, password: a.password, company: a.company, branch: a.branch };
      if (!body.name || !body.password || !body.company || !body.branch) { return { content: [{ type: 'text' as const, text: 'Missing fields. Provide JSON with name,password,company,branch.' }] }; }
      const resp = await http.post(loginUrl, body, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, withCredentials: true });
      return { content: [{ type: 'text' as const, text: 'login ok' }], structuredContent: { status_code: (resp as any).status, ok: (resp as any).status >= 200 && (resp as any).status < 300 } };
    } catch (e: any) { return { content: [{ type: 'text' as const, text: `Login failed: ${e?.message || 'error'}` }] }; }
  }) as any);
  mcp.registerTool('logout', { description: 'Logout current MYOB session and clear cookies.' }, (async () => {
    try {
      const resp = await http.post(logoutUrl, undefined, { withCredentials: true });
      try { const jar = http.__cookieJar as any; if ((jar as any)?.removeAllCookies) await new Promise<void>((resolve, reject) => (jar as any).removeAllCookies((e: any) => (e ? reject(e) : resolve()))); } catch {}
      return { content: [{ type: 'text' as const, text: 'logout ok' }], structuredContent: { status_code: (resp as any).status, ok: (resp as any).status >= 200 && (resp as any).status < 300 } };
    } catch (err: any) { const status = err?.response?.status ?? 500; const data = err?.response?.data ?? err?.message ?? 'Logout failed'; return { content: [{ type: 'text' as const, text: 'logout failed' }], structuredContent: { status_code: status, ok: false, data } }; }
  }) as any);
}

export async function tryAutoLogin(http: CookieAxios, loginUrl: string) {
  try {
    const name = process.env.MYOB_LOGIN_NAME;
    const password = process.env.MYOB_LOGIN_PASSWORD;
    const company = process.env.MYOB_LOGIN_COMPANY;
    const branch = process.env.MYOB_LOGIN_BRANCH;
    const json = process.env.MYOB_AUTOLOGIN_JSON as string | undefined;
    const creds = json ? JSON.parse(json) : { name, password, company, branch };
    if (!creds?.name || !creds?.password || !creds?.company || !creds?.branch) return;
    const resp = await http.post(loginUrl, creds, { headers: { 'Content-Type': 'application/json' }, withCredentials: true });
    try {
      const setCookie = (resp as any)?.headers?.['set-cookie'] as string[] | undefined;
      if (setCookie && setCookie.length) {
        const originAbs = new URL('/', new URL(loginUrl).origin).toString();
        const jar = http.__cookieJar as any;
        await Promise.all(setCookie.map((sc) => new Promise<void>((resolve) => { try { jar.setCookie(sc, originAbs, () => resolve()); } catch { resolve(); } })));
      }
    } catch {}
    console.log('[MYOB TS MCP] Auto-login completed with status', (resp as any)?.status);
  } catch (e: any) {
    console.warn('[MYOB TS MCP] Auto-login failed:', (e as any)?.response?.status, (e as any)?.message);
  }
}
