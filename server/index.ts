import path from "node:path";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3001);
const dbUrl = process.env.DATABASE_URL ?? "file:data/app.db";
const sessionSecret = process.env.SESSION_SECRET ?? "dev-only-secret";
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET not set — using an insecure default");
}

const db = await openDb(dbUrl, process.env.DATABASE_AUTH_TOKEN);
const app = createApp(db, { sessionSecret, clientDir: path.resolve("dist/client") });
app.listen(port, () => console.log(`Server on http://localhost:${port} (db: ${dbUrl.replace(/\/\/.*@/, "//")})`));
