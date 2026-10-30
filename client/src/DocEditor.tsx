import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { api, ApiError, type Doc } from "./api.ts";
import { ShareDialog } from "./ShareDialog.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";

type Status = "saved" | "dirty" | "saving" | "error" | "conflict" | "blocked";
const AUTOSAVE_MS = 800;
const MAX_RETRY_MS = 30_000;

export function DocEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getDoc(id).then(setDoc, (e: ApiError) =>
      setError(e.status === 404 ? "This document doesn't exist or you don't have access to it." : e.message),
    );
  }, [id]);

  if (error)
    return (
      <main className="center">
        <div className="card">
          <div className="alert error">{error}</div>
          <button className="btn" onClick={onBack}>← Back to documents</button>
        </div>
      </main>
    );
  if (!doc) return <main className="center muted">Loading document…</main>;
  // Keyed by version: a restore returns a new version, which remounts the editor with that content.
  return <LoadedEditor key={doc.version} initial={doc} onBack={onBack} onReplaced={setDoc} />;
}

function LoadedEditor({ initial, onBack, onReplaced }: { initial: Doc; onBack: () => void; onReplaced: (d: Doc) => void }) {
  const canEdit = initial.role !== "viewer";
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<Status>("saved");
  const [saveError, setSaveError] = useState("");
  const [shares, setShares] = useState(initial.shares);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Autosave queue: coalesce edits, keep one request in flight, send the version we last saw.
  const version = useRef(initial.version);
  const pending = useRef<{ title?: string; content?: string }>({});
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedTitle = useRef(initial.title);
  const retryDelay = useRef(AUTOSAVE_MS);
  const stopped = useRef(false); // set on conflict / deleted / access lost: no further saves
  const [notice, setNotice] = useState("");

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (stopped.current || inFlight.current || Object.keys(pending.current).length === 0) return;
    const patch = pending.current;
    pending.current = {};
    inFlight.current = true;
    setStatus("saving");
    try {
      const saved = await api.updateDoc(initial.id, { ...patch, version: version.current });
      version.current = saved.version;
      lastSavedTitle.current = saved.title;
      retryDelay.current = AUTOSAVE_MS;
      setStatus(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (e: any) {
      inFlight.current = false;
      const code = e instanceof ApiError ? e.status : 0;
      // Three kinds of failure, handled differently:
      if (code === 409 || code === 404 || code === 403) {
        // 1. Permanent: retrying can never succeed. Stop and lock the editor.
        pending.current = {};
        stopped.current = true;
        setStatus(code === 409 ? "conflict" : "blocked");
        setSaveError(
          code === 409 ? e.message
          : code === 404 ? "This document was deleted or your access was removed. Your latest edits were not saved; copy anything you need."
          : "Your access was changed to view-only. Your latest edits were not saved.",
        );
        return;
      }
      if (code === 400 || code === 413) {
        // 2. The content itself is rejected: keep the edits and retry when the user changes something.
        pending.current = { ...patch, ...pending.current };
        if (code === 400 && patch.title !== undefined) {
          delete pending.current.title;
          setTitle(lastSavedTitle.current);
        }
        setStatus("error");
        setSaveError(`Couldn't save: ${e.message}. It will retry after your next change.`);
        return;
      }
      // 3. Transient (network / 5xx): keep the edits and retry automatically with backoff.
      pending.current = { ...patch, ...pending.current };
      retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_MS);
      setStatus("error");
      setSaveError(`Couldn't reach the server. Your changes are kept in this tab; retrying in ${Math.round(retryDelay.current / 1000)} s.`);
      timer.current = setTimeout(flush, retryDelay.current);
      return;
    }
    inFlight.current = false;
    if (Object.keys(pending.current).length) timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [initial.id]);

  const schedule = useCallback(
    (patch: { title?: string; content?: string }) => {
      if (stopped.current) return;
      pending.current = { ...pending.current, ...patch };
      setStatus((s) => (s === "conflict" || s === "blocked" ? s : "dirty"));
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initial.content,
    editable: canEdit,
    onUpdate: ({ editor }) => schedule({ content: editor.getHTML() }),
    editorProps: {
      // Images aren't part of this editor's scope; say so instead of silently dropping them.
      handlePaste: (_view, event) => rejectImages(event.clipboardData),
      handleDrop: (_view, event) => rejectImages((event as DragEvent).dataTransfer),
    },
  });

  function rejectImages(data: DataTransfer | null) {
    const hasImage = [...(data?.files ?? [])].some((f) => f.type.startsWith("image/"));
    if (!hasImage) return false;
    setNotice("Images aren't supported in this editor yet. Paste text only.");
    setTimeout(() => setNotice(""), 4000);
    return true;
  }

  // Once saving is impossible, stop accepting edits so nothing else is silently lost.
  useEffect(() => {
    // emitUpdate=false: otherwise TipTap fires onUpdate, which would queue yet another save.
    if (status === "conflict" || status === "blocked") editor?.setEditable(false, false);
  }, [status, editor]);

  // Flush on unmount; warn before closing the tab with unsaved changes; Ctrl/Cmd+S saves now.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || inFlight.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); flush(); }
    };
    addEventListener("beforeunload", beforeUnload);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("beforeunload", beforeUnload);
      removeEventListener("keydown", onKey);
      flush();
    };
  }, [flush]);

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(lastSavedTitle.current);
    if (t !== lastSavedTitle.current) { schedule({ title: t }); flush(); }
  };

  return (
    <main className="editor-page">
      <div className="doc-header">
        <button className="btn ghost" onClick={onBack} title="Back to documents">←</button>
        <input
          className="title-input"
          value={title}
          maxLength={200}
          disabled={!canEdit}
          aria-label="Document title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <SaveStatus status={status} canEdit={canEdit} />
        <div className="spacer" />
        <button className="btn ghost" onClick={async () => { await flush(); setHistoryOpen(true); }}>History</button>
        <a className="btn ghost" href={`/api/documents/${initial.id}/export?format=md`} download>Export .md</a>
        {initial.role === "owner" && (
          <button
            className="btn ghost"
            onClick={async () => {
              if (!confirm(`Delete "${title}"? This can't be undone and removes access for everyone it's shared with.`)) return;
              clearTimeout(timer.current);
              pending.current = {};
              try {
                await api.deleteDoc(initial.id);
                onBack();
              } catch (e: any) {
                setStatus("error");
                setSaveError(e.message);
              }
            }}
          >
            Delete
          </button>
        )}
        {initial.role === "owner" ? (
          <button className="btn primary" onClick={() => setShareOpen(true)}>
            Share{shares.length ? ` · ${shares.length}` : ""}
          </button>
        ) : (
          <span className={`badge ${initial.role}`} title={`Owned by ${initial.owner.name}`}>
            {initial.role} · shared by {initial.owner.name}
          </span>
        )}
      </div>

      {status === "conflict" && (
        <div className="alert error">
          {saveError} <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {(status === "error" || status === "blocked") && <div className="alert error">{saveError}</div>}
      {notice && <div className="alert info">{notice}</div>}
      {!canEdit && <div className="alert info">You have view-only access to this document.</div>}

      {canEdit && editor && <Toolbar editor={editor} />}
      <div className="paper">
        <EditorContent editor={editor} />
      </div>

      {historyOpen && (
        <HistoryPanel
          docId={initial.id}
          canRestore={canEdit}
          beforeRestore={() => {
            // Restore supersedes any unsaved edits; drop them so the unmount flush doesn't 409.
            clearTimeout(timer.current);
            pending.current = {};
            return version.current;
          }}
          onRestored={onReplaced}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {shareOpen && (
        <ShareDialog docId={initial.id} ownerId={initial.owner.id} shares={shares} onChange={setShares} onClose={() => setShareOpen(false)} />
      )}
    </main>
  );
}

function SaveStatus({ status, canEdit }: { status: Status; canEdit: boolean }) {
  if (!canEdit) return <span className="save-status muted">Read-only</span>;
  const label = { saved: "All changes saved", dirty: "Unsaved changes…", saving: "Saving…", error: "Save failed", conflict: "Conflict", blocked: "Not saved" }[status];
  return <span className={`save-status ${status}`}>{label}</span>;
}

// Top-level (not defined inside Toolbar) so React keeps the same buttons mounted across re-renders.
function ToolButton(p: { on?: boolean; label: React.ReactNode; title: string; run: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`tb ${p.on ? "on" : ""}`} title={p.title} aria-pressed={p.on} disabled={p.disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={p.run}>{p.label}</button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar">
      <ToolButton title="Undo (Ctrl+Z)" label="↶" run={() => c().undo().run()} disabled={!s.canUndo} />
      <ToolButton title="Redo (Ctrl+Shift+Z)" label="↷" run={() => c().redo().run()} disabled={!s.canRedo} />
      <span className="sep" />
      <select
        className="tb-select"
        aria-label="Text style"
        value={s.h1 ? "1" : s.h2 ? "2" : s.h3 ? "3" : "p"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else c().setHeading({ level: Number(v) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">Normal text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <span className="sep" />
      <ToolButton title="Bold (Ctrl+B)" on={s.bold} label={<b>B</b>} run={() => c().toggleBold().run()} />
      <ToolButton title="Italic (Ctrl+I)" on={s.italic} label={<i>I</i>} run={() => c().toggleItalic().run()} />
      <ToolButton title="Underline (Ctrl+U)" on={s.underline} label={<u>U</u>} run={() => c().toggleUnderline().run()} />
      <ToolButton title="Strikethrough" on={s.strike} label={<s>S</s>} run={() => c().toggleStrike().run()} />
      <span className="sep" />
      {(["left", "center", "right", "justify"] as const).map((a) => (
        <ToolButton key={a} title={`Align ${a}`} on={s.align === a} label={<AlignIcon align={a} />} run={() => c().setTextAlign(a).run()} />
      ))}
      <span className="sep" />
      <ToolButton title="Bulleted list" on={s.bullet} label="• List" run={() => c().toggleBulletList().run()} />
      <ToolButton title="Numbered list" on={s.ordered} label="1. List" run={() => c().toggleOrderedList().run()} />
      <ToolButton title="Quote" on={s.quote} label="❝" run={() => c().toggleBlockquote().run()} />
    </div>
  );
}

/** Four-line alignment glyph; line widths/offsets show the alignment. */
function AlignIcon({ align }: { align: "left" | "center" | "right" | "justify" }) {
  const rows = [14, 9, 14, 9];
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {rows.map((w, i) => {
        const width = align === "justify" ? 14 : w;
        const x = align === "center" ? (16 - width) / 2 : align === "right" ? 15 - width : 1;
        return <rect key={i} x={x} y={1 + i * 3.4} width={width} height="1.6" rx="0.8" fill="currentColor" />;
      })}
    </svg>
  );
}
