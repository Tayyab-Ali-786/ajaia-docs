import sanitizeHtml from "sanitize-html";
import mammoth from "mammoth";
import { marked } from "marked";
import TurndownService from "turndown";
import path from "node:path";

// Mirrors what the TipTap editor can produce; anything else is stripped.
const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s",
    "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], p: ["style"], h1: ["style"], h2: ["style"], h3: ["style"] },
  // Only text alignment survives; any other inline style is dropped.
  allowedStyles: { "*": { "text-align": [/^(left|center|right|justify)$/] } },
  allowedSchemes: ["http", "https", "mailto"],
};

export function sanitize(html: string): string {
  return sanitizeHtml(html, ALLOWED);
}

export const IMPORT_TYPES = [".txt", ".md", ".docx"] as const;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export class ImportError extends Error {}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert an uploaded file into { title, html } for a new document. */
export async function importFile(
  originalName: string,
  buf: Buffer,
): Promise<{ title: string; html: string }> {
  const ext = path.extname(originalName).toLowerCase();
  const title = path.basename(originalName, ext).trim().slice(0, 200) || "Imported document";

  let html: string;
  if (ext === ".txt") {
    html = buf
      .toString("utf8")
      .split(/\r?\n\s*\r?\n/) // blank line = paragraph break
      .map((para) => `<p>${escapeHtml(para).replace(/\r?\n/g, "<br>")}</p>`)
      .join("");
  } else if (ext === ".md") {
    html = await marked.parse(buf.toString("utf8"));
  } else if (ext === ".docx") {
    try {
      html = (await mammoth.convertToHtml({ buffer: buf })).value;
    } catch {
      throw new ImportError("Could not read .docx file — is it a valid Word document?");
    }
  } else {
    throw new ImportError(`Unsupported file type "${ext || "none"}". Supported: ${IMPORT_TYPES.join(", ")}`);
  }
  return { title, html: sanitize(html) };
}

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
turndown.addRule("underline", { filter: ["u"], replacement: (c) => `<u>${c}</u>` });

export function toMarkdown(html: string): string {
  return turndown.turndown(html);
}
