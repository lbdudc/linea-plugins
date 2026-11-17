// LINEA's own API as the person asking: the plugin has no git host and no token of its own, it forwards the request's authorization.

export const createCore = ({ baseUrl, fetchImpl = globalThis.fetch }) => {
  const call = async (auth, method, path, body) => {
    const response = await fetchImpl(`${baseUrl()}/api${path}`, {
      method,
      headers: { Authorization: auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw Object.assign(new Error(data?.error ?? data?.message ?? `LINEA answered ${response.status}`), { status: response.status, body: data });
    return data;
  };
  return { get: (auth, path) => call(auth, 'GET', path), post: (auth, path, body) => call(auth, 'POST', path, body) };
};

export const queryOf = (params) => `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString()}`;
