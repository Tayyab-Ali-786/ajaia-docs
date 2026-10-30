import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { api, ApiError, type Doc } from "./api.ts";
import { ShareDialog } from "./ShareDialog.tsx";

type Status = "saved" | "dirty" | "saving" | "error" | "conflict";
const AUTOSAVE_MS = 800;

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
  return <LoadedEditor initial={doc} onBack={onBack} />;
}

function LoadedEditor({ initial, onBack }: { initial: Doc; onBack: () => void }) {
  const canEdit = initial.role !== "viewer";
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<Status>("saved");
  const [saveError, setSaveError] = useState("");
  const [shares, setShares] = useState(initial.shares);
  const [shareOpen, setShareOpen] = useState(false);

  // Autosave queue: coalesce edits, keep one request in flight, send the version we last saw.
  const version = useRef(initial.version);
  const pending = useRef<{ title?: string; content?: string }>({});
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedTitle = useRef(initial.title);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current || Object.keys(pending.current).length === 0) return;
    const patch = pending.current;
    pending.current = {};
    inFlight.current = true;
    setStatus("saving");
    try {
      const saved = await api.updateDoc(initial.id, { ...patch, version: version.current });
      version.current = saved.version;
      lastSavedTitle.current = saved.title;
      setStatus(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        setStatus("conflict");
        setSaveError(e.message);
        inFlight.current = false;
        return; // stop autosaving; user must reload
      }
      pending.current = { ...patch, ...pending.current }; // retry these changes next time
      setStatus("error");
      setSaveError(e.message);
      if (e instanceof ApiError && e.status === 400 && patch.title !== undefined) {
        delete pending.current.title;
        setTitle(lastSavedTitle.current);
      }
    }
    inFlight.current = false;
    if (Object.keys(pending.current).length) timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [initial.id]);

  const schedule = useCallback(
    (patch: { title?: string; content?: string }) => {
      pending.current = { ...pending.current, ...patch };
      setStatus((s) => (s === "conflict" ? s : "dirty"));
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } })],
    content: initial.content,
    editable: canEdit,
    onUpdate: ({ editor }) => schedule({ content: editor.getHTML() }),
  });

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
        <a className="btn ghost" href={`/api/documents/${initial.id}/export?format=md`} download>Export .md</a>
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
      {status === "error" && <div className="alert error">Couldn't save: {saveError}. Retrying on your next edit.</div>}
      {!canEdit && <div className="alert info">You have view-only access to this document.</div>}

      {canEdit && editor && <Toolbar editor={editor} />}
      <div className="paper">
        <EditorContent editor={editor} />
      </div>

      {shareOpen && (
        <ShareDialog docId={initial.id} ownerId={initial.owner.id} shares={shares} onChange={setShares} onClose={() => setShareOpen(false)} />
      )}
    </main>
  );
}

function SaveStatus({ status, canEdit }: { status: Status; canEdit: boolean }) {
  if (!canEdit) return <span className="save-status muted">Read-only</span>;
  const label = { saved: "All changes saved", dirty: "Unsaved changes…", saving: "Saving…", error: "Save failed", conflict: "Conflict" }[status];
  return <span className={`save-status ${status}`}>{label}</span>;
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const B = (p: { on?: boolean; label: React.ReactNode; title: string; run: () => void; disabled?: boolean }) => (
    <button type="button" className={`tb ${p.on ? "on" : ""}`} title={p.title} aria-pressed={p.on} disabled={p.disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={p.run}>{p.label}</button>
  );
  return (
    <div className="toolbar" role="toolbar">
      <B title="Undo (Ctrl+Z)" label="↶" run={() => c().undo().run()} disabled={!s.canUndo} />
      <B title="Redo (Ctrl+Shift+Z)" label="↷" run={() => c().redo().run()} disabled={!s.canRedo} />
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
      <B title="Bold (Ctrl+B)" on={s.bold} label={<b>B</b>} run={() => c().toggleBold().run()} />
      <B title="Italic (Ctrl+I)" on={s.italic} label={<i>I</i>} run={() => c().toggleItalic().run()} />
      <B title="Underline (Ctrl+U)" on={s.underline} label={<u>U</u>} run={() => c().toggleUnderline().run()} />
      <B title="Strikethrough" on={s.strike} label={<s>S</s>} run={() => c().toggleStrike().run()} />
      <span className="sep" />
      <B title="Bulleted list" on={s.bullet} label="• List" run={() => c().toggleBulletList().run()} />
      <B title="Numbered list" on={s.ordered} label="1. List" run={() => c().toggleOrderedList().run()} />
      <B title="Quote" on={s.quote} label="❝" run={() => c().toggleBlockquote().run()} />
    </div>
  );
}
