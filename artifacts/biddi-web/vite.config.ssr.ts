import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// SSR build: compiles `src/entry-server.tsx` into a single CJS-friendly ESM
// bundle that `serve.mjs` imports at runtime to render React to a string.
// We intentionally skip Tailwind / cartographer / dev plugins here — they
// aren't needed (and some are dev-only) for the server bundle.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    ssr: true,
    outDir: path.resolve(import.meta.dirname, "dist/server"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "src/entry-server.tsx"),
      output: { format: "esm", entryFileNames: "entry-server.js" },
    },
  },
  ssr: {
    // Bundle most deps so `serve.mjs` only needs the single output, but
    // keep `isomorphic-dompurify` and its `jsdom` runtime external — jsdom
    // ships data files (e.g. `data/patch.json`) that bundlers can't inline.
    noExternal: true,
    external: ["isomorphic-dompurify", "jsdom"],
  },
});
