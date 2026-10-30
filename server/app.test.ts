import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

// Seeded ids: 1 = Alice, 2 = Bob, 3 = Carol
async function agentFor(app: ReturnType<typeof createApp>, userId: number) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ userId }).expect(200);
  return agent;
}

describe("documents, sharing & access control", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    app = createApp(await openDb("memory://"), { sessionSecret: "test" });
  });

  it("rejects unauthenticated requests", async () => {
    await request(app).get("/api/documents").expect(401);
  });

  it("owner can create, rename, edit and reopen a document with formatting preserved", async () => {
    const alice = await agentFor(app, 1);
    const created = await alice.post("/api/documents").send({}).expect(201);
    expect(created.body.title).toBe("Untitled document");

    const html = "<h1>Plan</h1><p><strong>bold</strong> <em>it</em> <u>u</u></p><ul><li>one</li></ul>";
    await alice
      .patch(`/api/documents/${created.body.id}`)
      .send({ title: "Q3 Plan", content: html, version: created.body.version })
      .expect(200);

    const reopened = await alice.get(`/api/documents/${created.body.id}`).expect(200);
    expect(reopened.body.title).toBe("Q3 Plan");
    expect(reopened.body.content).toBe(html);
  });

  it("enforces sharing: no access → viewer (read-only) → editor", async () => {
    const alice = await agentFor(app, 1);
    const bob = await agentFor(app, 2);
    const { body: doc } = await alice.post("/api/documents").send({ title: "Secret" }).expect(201);

    // Not shared yet: Bob can't see it, and it doesn't leak existence.
    await bob.get(`/api/documents/${doc.id}`).expect(404);
    expect((await bob.get("/api/documents")).body.shared).toHaveLength(0);

    // Share as viewer: can read, cannot write, cannot reshare.
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: "bob@ajaia.test", role: "viewer" }).expect(201);
    const asViewer = await bob.get(`/api/documents/${doc.id}`).expect(200);
    expect(asViewer.body.role).toBe("viewer");
    await bob.patch(`/api/documents/${doc.id}`).send({ content: "<p>hijack</p>" }).expect(403);
    await bob.post(`/api/documents/${doc.id}/shares`).send({ email: "carol@ajaia.test" }).expect(403);

    // Lists distinguish owned vs shared.
    expect((await alice.get("/api/documents")).body.owned.map((d: any) => d.id)).toContain(doc.id);
    const bobList = (await bob.get("/api/documents")).body;
    expect(bobList.owned).toHaveLength(0);
    expect(bobList.shared[0]).toMatchObject({ id: doc.id, role: "viewer", ownerName: "Alice Chen" });

    // Upgrade to editor: can write. Revoke: access gone.
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: "bob@ajaia.test", role: "editor" }).expect(201);
    await bob.patch(`/api/documents/${doc.id}`).send({ content: "<p>edit</p>" }).expect(200);
    await alice.delete(`/api/documents/${doc.id}/shares/2`).expect(200);
    await bob.get(`/api/documents/${doc.id}`).expect(404);
  });

  it("rejects stale writes with 409 instead of clobbering", async () => {
    const alice = await agentFor(app, 1);
    const { body: doc } = await alice.post("/api/documents").send({}).expect(201);
    await alice.patch(`/api/documents/${doc.id}`).send({ content: "<p>a</p>", version: doc.version }).expect(200);
    await alice.patch(`/api/documents/${doc.id}`).send({ content: "<p>b</p>", version: doc.version }).expect(409);
  });

  it("keeps version history: coalesces autosaves, lets viewers browse, only editors restore", async () => {
    const alice = await agentFor(app, 1);
    const bob = await agentFor(app, 2);
    const carol = await agentFor(app, 3);
    let { body: doc } = await alice.post("/api/documents").send({ title: "Spec", content: "<p>v1</p>" }).expect(201);

    // Two quick saves by the same user fold into one 'edit' entry (on top of 'created').
    for (const c of ["<p>draft</p>", "<p>v2</p>"])
      doc = (await alice.patch(`/api/documents/${doc.id}`).send({ content: c, version: doc.version }).expect(200)).body;
    let history = (await alice.get(`/api/documents/${doc.id}/versions`).expect(200)).body;
    expect(history.map((v: any) => v.kind)).toEqual(["edit", "created"]);
    expect((await alice.get(`/api/documents/${doc.id}/versions/${history[0].id}`)).body.content).toBe("<p>v2</p>");

    // Share as viewer: can browse history but not restore.
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: "bob@ajaia.test", role: "viewer" }).expect(201);
    const created = history[1];
    await bob.get(`/api/documents/${doc.id}/versions`).expect(200); // viewers can browse
    await bob.post(`/api/documents/${doc.id}/versions/${created.id}/restore`).send({}).expect(403);
    await carol.get(`/api/documents/${doc.id}/versions`).expect(404); // outsiders can't

    // Restore brings back v1 content as a NEW version (so it's undoable).
    const restored = (await alice.post(`/api/documents/${doc.id}/versions/${created.id}/restore`).send({ version: doc.version }).expect(200)).body;
    expect(restored.content).toBe("<p>v1</p>");
    expect(restored.version).toBe(doc.version + 1);
    history = (await alice.get(`/api/documents/${doc.id}/versions`)).body;
    expect(history.map((v: any) => v.kind)).toEqual(["restore", "edit", "created"]);
    await alice.post(`/api/documents/${doc.id}/versions/${created.id}/restore`).send({ version: doc.version }).expect(409); // stale
  });

  it("sanitizes stored HTML (no script injection via content)", async () => {
    const alice = await agentFor(app, 1);
    const { body } = await alice
      .post("/api/documents")
      .send({ content: '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>' })
      .expect(201);
    expect(body.content).toBe("<p>hi</p>");
  });

  it("validates input", async () => {
    const alice = await agentFor(app, 1);
    await alice.post("/api/documents").send({ title: "   " }).expect(400);
    await alice.post("/api/documents").send({ title: "x".repeat(201) }).expect(400);
    await alice.post("/api/documents/whatever/shares").send({ email: "a@b.c" }).expect(404);
  });

  it("imports .md and .txt into new documents and rejects unsupported types", async () => {
    const alice = await agentFor(app, 1);
    const md = await alice
      .post("/api/documents/import")
      .attach("file", Buffer.from("# Hello\n\n- **one**\n- two\n"), "notes.md")
      .expect(201);
    expect(md.body.title).toBe("notes");
    expect(md.body.content).toContain("<h1>Hello</h1>");
    expect(md.body.content).toContain("<li><strong>one</strong></li>");

    const txt = await alice
      .post("/api/documents/import")
      .attach("file", Buffer.from("line <1>\n\npara 2"), "plain.txt")
      .expect(201);
    expect(txt.body.content).toBe("<p>line &lt;1&gt;</p><p>para 2</p>");

    const bad = await alice.post("/api/documents/import").attach("file", Buffer.from("x"), "evil.exe").expect(400);
    expect(bad.body.error).toMatch(/Unsupported file type/);
  });
});
