import { useEffect, useState } from "react";
import { api, type Share, type User } from "./api.ts";

interface Props {
  docId: string; ownerId: number; shares: Share[];
  onChange: (s: Share[]) => void; onClose: () => void;
}

export function ShareDialog({ docId, ownerId, shares, onChange, onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.users().then(setUsers, () => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<Share[]>) => {
    setBusy(true);
    setError("");
    try {
      onChange(await fn());
      setEmail("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const candidates = users.filter((u) => u.id !== ownerId && !shares.some((s) => s.id === u.id));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Share document" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Share document</h2>
        <form
          className="share-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) run(() => api.share(docId, email.trim(), role));
          }}
        >
          <input
            list="share-users"
            type="email"
            placeholder="Email, e.g. bob@ajaia.test"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <datalist id="share-users">
            {candidates.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn primary" disabled={busy}>Share</button>
        </form>
        {error && <div className="alert error">{error}</div>}

        <h3>People with access</h3>
        <ul className="share-list">
          <li><span className="muted">You</span><span className="badge owner">owner</span></li>
          {shares.map((s) => (
            <li key={s.id}>
              <span>{s.name} <span className="muted small">{s.email}</span></span>
              <span className="share-actions">
                <select value={s.role} disabled={busy} onChange={(e) => run(() => api.share(docId, s.email, e.target.value as "viewer" | "editor"))}>
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button className="btn ghost" disabled={busy} onClick={() => run(() => api.unshare(docId, s.id))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
