import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/munich3dcodex/" : "/",
  // Babylon relies on shared module-level shader and loader registries. Serving
  // its native ESM modules in development avoids duplicate registry instances
  // when Vite discovers lazy Babylon subpaths after the first page load.
  optimizeDeps: {
    exclude: ["@babylonjs/core", "@babylonjs/loaders"],
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2_000,
  },
}));
