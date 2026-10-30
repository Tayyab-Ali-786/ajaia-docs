import { useEffect, useState } from "react";
import { api, type User } from "./api.ts";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.users().then(setUsers, (e) => setError(e.message));
  }, []);

  const pick = (id: number) => api.login(id).then(onLogin, (e) => setError(e.message));

  return (
    <div className="center">
      <div className="card login">
        <h1><span className="logo" /> Ajaia Docs</h1>
        <p className="muted">
          Demo sign-in — pick a seeded user. Open a second browser (or incognito window) as another user to try sharing.
        </p>
        {error && <div className="alert error">{error}</div>}
        <div className="user-list">
          {users.map((u) => (
            <button key={u.id} className="user-pick" onClick={() => pick(u.id)}>
              <span className="avatar">{u.name[0]}</span>
              <span>
                <strong>{u.name}</strong>
                <br />
                <span className="muted">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
