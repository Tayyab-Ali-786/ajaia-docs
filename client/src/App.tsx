import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { api, type User } from "./api.ts";
import { Login } from "./Login.tsx";
import { DocList } from "./DocList.tsx";
import { DocEditor } from "./DocEditor.tsx";

// Tiny path router: "/" = list, "/d/:id" = editor. Avoids a router dependency for two screens.
function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((p: string) => {
    history.pushState(null, "", p);
    setPath(p);
  }, []);
  return [path, navigate];
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, navigate] = usePath();

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const signOut = async () => {
    // Unmount the editor synchronously first: its unmount flush sends any pending save
    // while the session cookie is still valid, before the logout request goes out.
    flushSync(() => navigate("/"));
    await api.logout().catch(() => {});
    setUser(null);
  };

  const docMatch = path.match(/^\/d\/([\w-]+)$/);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          <span className="logo" /> Ajaia Docs
        </a>
        <div className="topbar-user">
          <span className="avatar" title={user.email}>{user.name[0]}</span>
          <span className="muted">{user.name}</span>
          <button className="btn ghost" onClick={signOut}>Switch user</button>
        </div>
      </header>
      {docMatch ? (
        <DocEditor key={docMatch[1]} id={docMatch[1]} onBack={() => navigate("/")} />
      ) : (
        <DocList onOpen={(id) => navigate(`/d/${id}`)} />
      )}
    </div>
  );
}
