// The signed-in user (cookie session on the server) and the calls to the API. The page is public: nothing here is needed to
// show signs; being signed in unlocks the editor.
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** JSON call to the API; throws ApiError with the server's message (Estonian) when it answers an error. */
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Serveriga ei saa ühendust.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Viga ${res.status}`, json);
  return json;
}

let user = null;
try {
  user = (await api('GET', '/api/auth/me')).user;
} catch {} // no server (or not an API answer): the page runs as a visitor

/** The signed-in user ({ id, username, role }), or null. */
export const currentUser = () => user;

export async function login(username, password) {
  user = (await api('POST', '/api/auth/login', { username, password })).user;
  return user;
}

export async function logout() {
  await api('POST', '/api/auth/logout', {}).catch(() => {});
  user = null;
}
