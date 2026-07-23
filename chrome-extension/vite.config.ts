import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      "@ext": resolve(__dirname, "src"),
      // The bridge wire vocabulary is shared with the web app; it is
      // dependency-free so importing it adds nothing to the bundle graph.
      "@shared": resolve(__dirname, "..", "lib", "shared"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
      },
    },
  },
});
