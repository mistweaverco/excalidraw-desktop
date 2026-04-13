import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const staticAssetsDir = path.join(root, "static");
const outdir = path.join(staticAssetsDir, "excalidraw");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "excalidraw", "main.tsx")],
  outfile: path.join(outdir, "excalidraw.js"),
  bundle: true,
  format: "iife",
  target: ["es2020"],
  sourcemap: false,
  minify: true,
  conditions: ["production", "browser", "default"],
  loader: {
    ".css": "text",
    ".png": "dataurl",
    ".svg": "text",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Copy Excalidraw font assets so bundled CSS URLs resolve offline.
// Excalidraw's CSS uses relative URLs like ./fonts/Assistant/Assistant-Regular.woff2
// so we mirror that structure under static/excalidraw/fonts/.
const excalidrawFontsDir = path.join(
  root,
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "prod",
  "fonts",
);
const outFontsDir = path.join(staticAssetsDir, "fonts");

try {
  await rm(outFontsDir, { recursive: true, force: true });
  await cp(excalidrawFontsDir, outFontsDir, { recursive: true });
} catch {
  // If fonts aren't present in this package build, ignore.
}
