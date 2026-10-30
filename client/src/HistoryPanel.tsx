import { useEffect, useState } from "react";
import { api, type Doc, type VersionSummary } from "./api.ts";

interface Props {
  docId: string;
  canRestore: boolean;
  /** Called right before restoring so the editor can drop unsaved edits; returns the version to send. */
  beforeRestore: () => number;
  onRestored: (doc: Doc) => void;
  onClose: () => void;
}

const KIND_LABEL = { created: "Created", edit: "Edited", restore: "Restored" } as const;

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function HistoryPanel({ docId, canRestore, beforeRestore, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<VersionSummary | null>(null);
  // Server-sanitized HTML (same allow-list as the editor), safe to render.
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.versions(docId).then((v) => {
      setVersions(v);
      if (v[0]) setSelected(v[0]);
    }, (e) => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [docId, onClose]);

  useEffect(() => {
    if (!selected) return;
    setPreview(null);
    api.version(docId, selected.id).then(setPreview, (e) => setError(e.message));
  }, [docId, selected]);

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      onRestored(await api.restoreVersion(docId, selected.id, beforeRestore()));
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const isCurrent = selected && versions?.[0]?.id === selected.id;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal history" role="dialog" aria-label="Version history" onMouseDown={(e) => e.stopPropagation()}>
        <div className="history-head">
          <h2>Version history</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="history-body">
          <ul className="history-list">
            {!versions && <li className="muted">Loading…</li>}
            {versions?.length === 0 && <li className="muted">No history yet.</li>}
            {versions?.map((v, i) => (
              <li key={v.id}>
                <button className={`history-item ${selected?.id === v.id ? "on" : ""}`} onClick={() => setSelected(v)}>
                  <strong>{fmt(v.savedAt)}</strong>
                  <span className="muted small">
                    {KIND_LABEL[v.kind]} by {v.authorName}
                    {i === 0 && " · current"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="history-preview">
            {preview ? (
              <>
                <h3 className="preview-title">{preview.title}</h3>
                <div className="tiptap" dangerouslySetInnerHTML={{ __html: preview.content || "<p class='muted'>(empty)</p>" }} />
              </>
            ) : (
              selected && <p className="muted">Loading preview…</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          {canRestore ? (
            <button className="btn primary" disabled={!selected || !!isCurrent || busy} onClick={restore}>
              {isCurrent ? "This is the current version" : "Restore this version"}
            </button>
          ) : (
            <span className="muted small">View-only access: you can browse history but not restore.</span>
          )}
        </div>
      </div>
    </div>
  );
}
