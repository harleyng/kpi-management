import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// `manualChunks` is deliberately NOT configured. On a sibling project, a hand-rolled vendor
// split (charts into their own chunk, React into "react-vendor") caused a production-only
// crash — `Cannot read properties of undefined (reading 'forwardRef')` — because the charts
// chunk evaluated before React was ready. Rollup's default async splitting already keeps
// heavy libraries (recharts, exceljs) inside the lazy route chunks and respects load order.

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins: PluginOption[] = [react()];

  // Bundle size analyser — `npm run analyze`. Best-effort: if the dev-only package is
  // missing, analyze mode simply skips it instead of breaking the build.
  if (mode === "analyze") {
    try {
      const { visualizer } = await import("rollup-plugin-visualizer");
      plugins.push(
        visualizer({ filename: "dist/bundle-analysis.html", gzipSize: true, brotliSize: true }) as PluginOption,
      );
    } catch {
      console.warn("[analyze] rollup-plugin-visualizer is not installed; skipping. Run: npm i -D rollup-plugin-visualizer");
    }
  }

  return {
    server: {
      // 8082 rather than 8080/8081 so this can run alongside the other local projects.
      host: "::",
      port: 8082,
      hmr: { overlay: false },
    },
    plugins: plugins.filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
  };
});
