export type Role = "owner" | "editor" | "viewer";
export interface User { id: number; email: string; name: string }
export interface Share extends User { role: "viewer" | "editor" }
export interface Doc {
  id: string; title: string; content: string; version: number;
  createdAt: string; updatedAt: string; owner: User; role: Role; shares: Share[];
}
export interface DocSummary { id: string; title: string; updatedAt: string; role?: Role; ownerName?: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, init);
  } catch {
    throw new ApiError(0, "Network error — check your connection");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  users: () => req<User[]>("GET", "/users"),
  me: () => req<User>("GET", "/auth/me"),
  login: (userId: number) => req<User>("POST", "/auth/login", { userId }),
  logout: () => req("POST", "/auth/logout"),

  listDocs: () => req<{ owned: DocSummary[]; shared: DocSummary[] }>("GET", "/documents"),
  createDoc: () => req<Doc>("POST", "/documents", {}),
  getDoc: (id: string) => req<Doc>("GET", `/documents/${id}`),
  updateDoc: (id: string, patch: { title?: string; content?: string; version: number }) =>
    req<Doc>("PATCH", `/documents/${id}`, patch),
  deleteDoc: (id: string) => req("DELETE", `/documents/${id}`),
  importDoc: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Doc>("POST", "/documents/import", fd);
  },

  share: (id: string, email: string, role: "viewer" | "editor") =>
    req<Share[]>("POST", `/documents/${id}/shares`, { email, role }),
  unshare: (id: string, userId: number) => req<Share[]>("DELETE", `/documents/${id}/shares/${userId}`),
};
