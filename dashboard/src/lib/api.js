export const API_BASE_URL = import.meta.env.DEV
  ? '/api'
  : `${window.location.protocol}//${window.location.hostname}:8020`;

const SESSION_KEY = 'memorygate_admin_key';

export function getStoredKey() {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export function storeKey(key) {
  sessionStorage.setItem(SESSION_KEY, key);
}

export function clearKey() {
  sessionStorage.removeItem(SESSION_KEY);
}

export class UnauthorizedError extends Error {}

async function request(method, path, { body, params, agentId } = {}) {
  const key = getStoredKey();
  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-MemoryGate-Key': key } : {}),
      ...(agentId ? { 'X-Agent-Id': agentId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401) {
    clearKey();
    window.dispatchEvent(new Event('memorygate:unauthorized'));
    throw new UnauthorizedError('unauthorized');
  }

  const text = await resp.text();
  const data = text ? JSON.parse(text) : null;

  if (!resp.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data);
    const err = new Error(message || `Request failed (${resp.status})`);
    err.status = resp.status;
    err.payload = data;
    throw err;
  }

  return data;
}

export const api = {
  get: (path, params, agentId) => request('GET', path, { params, agentId }),
  post: (path, body, params, agentId) => request('POST', path, { body, params, agentId }),
  put: (path, body, params, agentId) => request('PUT', path, { body, params, agentId }),
  patch: (path, body, params, agentId) => request('PATCH', path, { body, params, agentId }),
  del: (path, params, agentId) => request('DELETE', path, { params, agentId }),
};
