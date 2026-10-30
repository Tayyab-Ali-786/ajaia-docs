import path from "node:path";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3001);
const dbFile = process.env.DB_PATH ?? path.resolve("data/app.db");
const sessionSecret = process.env.SESSION_SECRET ?? "dev-only-secret";
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET not set — using an insecure default");
}

const db = openDb(dbFile);
const app = createApp(db, { sessionSecret, clientDir: path.resolve("dist/client") });
app.listen(port, () => console.log(`Server on http://localhost:${port} (db: ${dbFile})`));
