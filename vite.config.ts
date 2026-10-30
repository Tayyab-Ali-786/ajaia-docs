/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  test: { root: ".", include: ["server/**/*.test.ts"] },
});
