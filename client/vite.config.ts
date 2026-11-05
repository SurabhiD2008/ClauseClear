import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const apiPort = process.env.PORT ?? "3000";

/**
 * The Latin font files the first screen uses (styles/fonts.ts). Fetched only
 * once their CSS applies, they arrive after the first paint and the swap moves
 * the text (prompt 18, audit item 2: CLS 0.11 on the landing page). Preloading
 * them starts the downloads with the page. Devanagari fonts are not listed: they
 * load only after the first toggle to Hindi (SPEC section 9). Kalam's latin-ext
 * faces are listed too: the landing page uses a glyph from them, so they were
 * fetched late from the CSS and swapped in at about 1.5 s (prompt 18, CLS 0.116).
 */
export const PRELOADED_FONTS =
  /^assets\/(archivo-latin-(800|900)|source-serif-4-latin-(400|400-italic|600)|ibm-plex-mono-latin-(500|600|700)|kalam-latin(-ext)?-(400|700))-(normal-)?[\w-]+\.woff2$/;

function preloadFonts(): Plugin {
  return {
    name: "clauseclear-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (_html, ctx) =>
        Object.keys(ctx.bundle ?? {})
          .filter((file) => PRELOADED_FONTS.test(file))
          .sort()
          .map((file) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              href: `/${file}`,
              // Fonts are always fetched in CORS mode, so the preload must be too.
              crossorigin: "",
            },
            injectTo: "head" as const,
          })),
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadFonts()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
  build: {
    outDir: "dist",
  },
});
