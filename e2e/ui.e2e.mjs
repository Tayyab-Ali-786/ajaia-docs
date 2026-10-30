// Headless-Chrome end-to-end check of the real UI (two users). Usage: npm run e2e -- [baseUrl] [screenshotDir]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3001";
const OUT = process.argv[3] ?? "docs/screenshots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const errors = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };

async function newUser(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE, { waitUntil: "networkidle0" });
  return page;
}
const clickText = async (page, sel, text) => {
  const h = await page.waitForFunction(
    (s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t)), {}, sel, text);
  await h.asElement().click();
};
const waitSaved = (page) => page.waitForFunction(() => document.querySelector(".save-status")?.textContent === "All changes saved", { timeout: 10000 });

// ---- Alice: create + format + rename + persist
const alice = await newUser("alice");
await page_shot(alice, "01-login");
await clickText(alice, ".user-pick", "Alice");
await alice.waitForSelector(".doc-section");
await clickText(alice, "button", "New document");
await alice.waitForSelector(".tiptap");

await alice.click(".title-input");
await alice.keyboard.down("Control"); await alice.keyboard.press("a"); await alice.keyboard.up("Control");
await alice.keyboard.type("Q4 Launch Plan");
await alice.keyboard.press("Enter");

await alice.click(".tiptap");
await alice.keyboard.type("# Launch goals\n");                 // markdown input rule -> H1
await alice.keyboard.type("Ship the editor with ");
await alice.keyboard.down("Control"); await alice.keyboard.press("b"); await alice.keyboard.up("Control");
await alice.keyboard.type("bold");
await alice.keyboard.down("Control"); await alice.keyboard.press("b"); await alice.keyboard.up("Control");
await alice.keyboard.type(", ");
await clickText(alice, ".tb", "U");
await alice.keyboard.type("underlined");
await clickText(alice, ".tb", "U");
await alice.keyboard.type(" and ");
await clickText(alice, ".tb", "I");
await alice.keyboard.type("italic");
await clickText(alice, ".tb", "I");
await alice.keyboard.type(" text.\n");
await clickText(alice, ".tb", "• List");
await alice.keyboard.type("Sharing\nFile import\nAutosave\n\n");
await clickText(alice, ".tb", "1. List");
await alice.keyboard.type("Deploy\nRecord demo");
await waitSaved(alice);
await page_shot(alice, "02-editor-formatting");

await alice.reload({ waitUntil: "networkidle0" });
await alice.waitForSelector(".tiptap h1");
const html = await alice.$eval(".tiptap", (e) => e.innerHTML);
check((await alice.$eval(".title-input", (e) => e.value)) === "Q4 Launch Plan", "rename persisted after reload");
check(html.includes("<h1>Launch goals</h1>"), "heading persisted");
check(html.includes("<strong>bold</strong>") && html.includes("<u>underlined</u>") && html.includes("<em>italic</em>"), "bold/underline/italic persisted");
check(/<ul>.*Sharing.*<\/ul>/s.test(html) && /<ol>.*Deploy.*<\/ol>/s.test(html), "bullet + numbered lists persisted");

// ---- share with Bob as viewer
await clickText(alice, "button", "Share");
await alice.waitForSelector(".modal input");
await alice.type(".modal input", "bob@ajaia.test");
await alice.select(".share-form select", "viewer");
await clickText(alice, ".share-form button", "Share");
await alice.waitForFunction(() => document.querySelector(".share-list")?.textContent.includes("Bob Okafor"));
await page_shot(alice, "03-share-dialog");
await clickText(alice, ".modal-footer button", "Done");

// ---- import a markdown file
await alice.goto(BASE, { waitUntil: "networkidle0" });
const mdPath = path.join(os.tmpdir(), "meeting-notes.md");
fs.writeFileSync(mdPath, "# Meeting notes\n\nDiscussed **roadmap** and _hiring_.\n\n1. Ship v1\n2. Gather feedback\n");
const input = await alice.$("input[type=file]");
await input.uploadFile(mdPath);
await alice.waitForFunction(() => document.querySelector(".tiptap h1")?.textContent === "Meeting notes", { timeout: 10000 });
check((await alice.$eval(".title-input", (e) => e.value)) === "meeting-notes", "import created doc titled from filename");
await page_shot(alice, "04-imported-md");

// unsupported file shows error
await alice.goto(BASE, { waitUntil: "networkidle0" });
fs.writeFileSync(path.join(os.tmpdir(), "bad.pdf"), "%PDF-1.4");
await (await alice.$("input[type=file]")).uploadFile(path.join(os.tmpdir(), "bad.pdf"));
await alice.waitForSelector(".alert.error");
check((await alice.$eval(".alert.error", (e) => e.textContent)).includes("Unsupported file type"), "unsupported upload shows error");
await page_shot(alice, "05-list-owner");

// ---- Bob: sees shared doc, read-only
const bob = await newUser("bob");
await clickText(bob, ".user-pick", "Bob");
await bob.waitForSelector(".doc-section");
const bobList = await bob.$eval(".list-page", (e) => e.textContent);
check(bobList.includes("Q4 Launch Plan") && bobList.includes("from Alice Chen"), "Bob sees doc under Shared with me");
check(!bobList.includes("meeting-notes"), "Bob does not see Alice's unshared doc");
await page_shot(bob, "06-list-shared");
await clickText(bob, ".doc-card", "Q4 Launch Plan");
await bob.waitForSelector(".tiptap");
check((await bob.$eval(".tiptap", (e) => e.getAttribute("contenteditable"))) === "false", "viewer editor is read-only");
check(!(await bob.$(".toolbar")), "viewer has no toolbar");
await page_shot(bob, "07-viewer-readonly");

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "PASS no console errors");
await browser.close();

async function page_shot(p, name) { await p.screenshot({ path: `${OUT}/${name}.png` }); }
