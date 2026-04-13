// @ts-nocheck
import React from "react";
import { createRoot } from "react-dom/client";

async function installFileSystemAccessPolyfill() {
  // Excalidraw's built-in "save/export" uses browser-fs-access which prefers the
  // File System Access API (showSaveFilePicker). Tauri doesn't provide it, so we
  // polyfill it with Tauri's dialog + fs plugins.
  // In Tauri, `window.__TAURI_INTERNALS__` is always present, but `isTauri()`
  // can be false depending on global injection settings.
  const isTauriEnv = Boolean((globalThis as any).__TAURI_INTERNALS__);
  if (!isTauriEnv) return;

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile, readFile } = await import("@tauri-apps/plugin-fs");

  /**
   * Basename (no extension) of the last opened or saved `.excalidraw` file.
   * Excalidraw's export image flow builds suggestedName from `appState.name` (often "Untitled"),
   * not from the document filename — we use this to align export defaults with the real file.
   */
  let lastExcalidrawDocumentBasename: string | null = null;

  const EXPORT_IMAGE_EXTENSIONS = new Set(["png", "svg", "jpg", "jpeg", "webp"]);

  function fileBasename(path: string): string {
    const s = String(path).replace(/\\/g, "/");
    const base = s.split("/").pop();
    return base && base.length > 0 ? base : "file";
  }

  function recordExcalidrawDocumentPath(path: string): void {
    const base = fileBasename(path);
    if (/\.excalidraw$/i.test(base)) {
      const stem = base.replace(/\.excalidraw$/i, "");
      if (stem.length > 0) lastExcalidrawDocumentBasename = stem;
    }
  }

  /**
   * When exporting PNG/SVG/etc., replace Excalidraw's suggested name (e.g. Untitled.png)
   * with `<last-document-basename>.<ext>` if we know a .excalidraw path for this session.
   */
  function deriveImageExportSuggestedName(suggested: string | undefined): string | undefined {
    if (!suggested || !lastExcalidrawDocumentBasename) return suggested;
    const m = suggested.match(/\.([a-z0-9]+)$/i);
    if (!m) return suggested;
    const ext = m[1].toLowerCase();
    if (!EXPORT_IMAGE_EXTENSIONS.has(ext)) return suggested;
    return `${lastExcalidrawDocumentBasename}.${ext}`;
  }

  /**
   * Maps SaveFilePickerOptions.types (browser-fs-access / export) to Tauri save dialog filters
   * so the suggested filename and extension match PNG/SVG/etc. exports.
   */
  function savePickerTypesToTauriFilters(
    types: any,
  ): { name: string; extensions: string[] }[] | undefined {
    if (!types || !Array.isArray(types) || types.length === 0) return undefined;
    const filters: { name: string; extensions: string[] }[] = [];
    for (const t of types) {
      const desc = (t?.description && String(t.description).trim()) || "Files";
      const accept = t?.accept;
      if (!accept || typeof accept !== "object") continue;
      for (const exts of Object.values(accept)) {
        if (!Array.isArray(exts)) continue;
        const extensions = exts
          .map((e) => String(e).replace(/^\./, "").toLowerCase())
          .filter(Boolean);
        if (extensions.length) filters.push({ name: desc, extensions });
      }
    }
    return filters.length ? filters : undefined;
  }

  async function toBytes(data: any): Promise<Uint8Array> {
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data === "string") return new TextEncoder().encode(data);
    return new TextEncoder().encode(String(data ?? ""));
  }

  /**
   * Real FileSystemWritableFileStream extends WritableStream (so `pipeTo` works) and adds
   * `write()` / `close()` like the native API. browser-fs-access uses both patterns.
   */
  class TauriFileSystemWritableFileStream extends WritableStream {
    constructor(path: string) {
      const chunks: Uint8Array[] = [];
      super({
        async write(chunk: any) {
          chunks.push(await toBytes(chunk));
        },
        async close() {
          const total = chunks.reduce((sum, c) => sum + c.length, 0);
          const out = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          await writeFile(path, out);
        },
      });
    }

    async write(data: any) {
      const bytes = await toBytes(data);
      const writer = this.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    }

    async close() {
      await super.close();
    }
  }

  class TauriFileHandle {
    kind = "file" as const;
    name: string;
    #path: string;
    constructor(path: string, name: string) {
      this.#path = path;
      this.name = name;
    }
    async createWritable(): Promise<TauriFileSystemWritableFileStream> {
      return new TauriFileSystemWritableFileStream(this.#path);
    }

    async queryPermission() {
      return "granted";
    }
    async requestPermission() {
      return "granted";
    }

    async getFile(): Promise<File> {
      const bytes = await readFile(this.#path);
      return new File([bytes], this.name);
    }
  }

  (globalThis as any).FileSystemFileHandle = TauriFileHandle;
  (globalThis as any).FileSystemHandle = TauriFileHandle;

  (globalThis as any).showSaveFilePicker = async (options?: any) => {
    const rawSuggested =
      (typeof options?.suggestedName === "string" && options.suggestedName) ||
      (typeof options?.fileName === "string" && options.fileName) ||
      undefined;
    const suggestedName = deriveImageExportSuggestedName(rawSuggested) ?? rawSuggested;
    const filters = savePickerTypesToTauriFilters(options?.types);
    const path = await save({
      defaultPath: suggestedName,
      filters,
    });
    if (!path) throw new DOMException("The user aborted a request.", "AbortError");
    recordExcalidrawDocumentPath(path);
    // Use the real path from the dialog so `handle.name` matches the file on disk (not only suggestedName).
    return new TauriFileHandle(path, fileBasename(path));
  };

  (globalThis as any).showOpenFilePicker = async (options?: any) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selection = await open({
      multiple: Boolean(options?.multiple),
    });
    if (!selection) throw new DOMException("The user aborted a request.", "AbortError");
    const paths = Array.isArray(selection) ? selection : [selection];
    for (const p of paths) recordExcalidrawDocumentPath(p);
    return paths.map((p) => new TauriFileHandle(p, fileBasename(p)));
  };
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

(async () => {
  await installFileSystemAccessPolyfill();
  const { default: ExcalidrawApp } = await import("./ExcalidrawApp");
  createRoot(rootEl).render(
    <React.StrictMode>
      <ExcalidrawApp />
    </React.StrictMode>,
  );
})();
