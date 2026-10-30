import { useEffect, useRef, useState } from "react";
import { api, type DocSummary } from "./api.ts";

const ACCEPT = ".txt,.md,.docx";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function DocList({ onOpen }: { onOpen: (id: string) => void }) {
  const [docs, setDocs] = useState<{ owned: DocSummary[]; shared: DocSummary[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listDocs().then(setDocs, (e) => setError(e.message));
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      onOpen((await api.createDoc()).id);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onOpen((await api.importDoc(file)).id);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="list-page">
      <div className="actions">
        <button className="btn primary" onClick={create} disabled={busy}>+ New document</button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>Import file…</button>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} />
        <span className="muted small">Import supports .txt, .md, .docx (max 2 MB) — creates a new editable document.</span>
      </div>
      {error && <div className="alert error">{error}</div>}

      {!docs ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <Section title="My documents" empty="No documents yet — create one or import a file." docs={docs.owned} onOpen={onOpen} />
          <Section title="Shared with me" empty="Nothing shared with you yet." docs={docs.shared} onOpen={onOpen} shared />
        </>
      )}
    </main>
  );
}

function Section(props: { title: string; empty: string; docs: DocSummary[]; onOpen: (id: string) => void; shared?: boolean }) {
  return (
    <section className="doc-section">
      <h2>{props.title} <span className="count">{props.docs.length}</span></h2>
      {props.docs.length === 0 ? (
        <p className="muted">{props.empty}</p>
      ) : (
        <ul className="doc-grid">
          {props.docs.map((d) => (
            <li key={d.id}>
              <button className="doc-card" onClick={() => props.onOpen(d.id)}>
                <span className="doc-thumb" aria-hidden />
                <span className="doc-title">{d.title}</span>
                <span className="muted small">
                  {props.shared ? (
                    <>
                      <span className={`badge ${d.role}`}>{d.role}</span> from {d.ownerName}
                    </>
                  ) : (
                    <span className="badge owner">owner</span>
                  )}
                </span>
                <span className="muted small">Edited {fmtDate(d.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
