import type {
  ClipboardImage,
  HostAdapter,
  HostClipboard,
  HostDeepLinks,
  HostExternal,
  HostFiles,
  HostLibrariesWindow,
  HostStorage,
  HostTheme,
  LibraryStorage,
  PickedFile,
  Theme,
} from "./types";

function isTauri(): boolean {
  return Boolean((globalThis as any).__TAURI_INTERNALS__);
}

const storage: HostStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

const files: HostFiles = {
  async openFile(options): Promise<PickedFile | null> {
    if (!isTauri()) return null;
    const dialog = await import("@tauri-apps/plugin-dialog");
    const fs = await import("@tauri-apps/plugin-fs");
    const path = await dialog.open({
      title: options.title,
      filters: options.filters?.map((f) => ({ name: f.name, extensions: f.extensions })),
      multiple: false,
    });
    if (!path || typeof path !== "string") return null;
    const bytes = await fs.readFile(path);
    return { path, bytes };
  },
  async saveFile(options, bytes): Promise<string | null> {
    if (!isTauri()) return null;
    const fs = await import("@tauri-apps/plugin-fs");
    const direct = options.writeToPath;
    if (typeof direct === "string" && direct.length > 0) {
      await fs.writeFile(direct, bytes);
      return direct;
    }
    const dialog = await import("@tauri-apps/plugin-dialog");
    const path = await dialog.save({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters?.map((f) => ({ name: f.name, extensions: f.extensions })),
    });
    if (!path || typeof path !== "string") return null;
    await fs.writeFile(path, bytes);
    return path;
  },
};

const clipboard: HostClipboard = {
  async readImage(): Promise<ClipboardImage | null> {
    // For now, use browser Clipboard API where available; Tauri may not grant image read by default.
    try {
      const items = await (navigator.clipboard as any).read?.();
      if (!items?.length) return null;
      for (const item of items as any[]) {
        for (const type of item.types as string[]) {
          if (!type.startsWith("image/")) continue;
          const blob = await item.getType(type);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          return { mimeType: type, bytes };
        }
      }
    } catch {
      // ignore
    }
    return null;
  },
};

const theme: HostTheme = {
  getSystemTheme(): Theme {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  },
  async getNativeTheme(): Promise<Theme | null> {
    try {
      const api = await import("@tauri-apps/api/window");
      const w: any = api.getCurrentWindow?.() ?? (api as any).appWindow;
      const t = await w?.theme?.();
      return t === "dark" ? "dark" : t === "light" ? "light" : null;
    } catch {
      return null;
    }
  },
  async setNativeTheme(theme: Theme | null): Promise<void> {
    try {
      const core = await import("@tauri-apps/api/core");
      await core.invoke("set_theme", { theme });
    } catch {
      // ignore
    }
  },
  async subscribeNativeThemeChanged(cb): Promise<() => void> {
    try {
      const api = await import("@tauri-apps/api/window");
      const w: any = api.getCurrentWindow?.() ?? (api as any).appWindow;
      const onThemeChanged = w?.onThemeChanged ?? w?.onThemeChange;
      if (typeof onThemeChanged !== "function") return () => {};
      const unlisten = await onThemeChanged.call(w, ({ payload }: any) => {
        if (payload === "dark" || payload === "light") cb(payload);
      });
      return () => unlisten?.();
    } catch {
      return () => {};
    }
  },
  subscribeSystemThemeChanged(cb) {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return () => {};
    const onChange = () => cb(mql.matches ? "dark" : "light");
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  },
};

const external: HostExternal = {
  async openUrl(url: string) {
    if (isTauri()) {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

const deepLinks: HostDeepLinks = {
  async subscribeLibraryInstallUrl(cb) {
    if (!isTauri()) return () => {};
    const ev = await import("@tauri-apps/api/event");
    const unlisten = await ev.listen<string>("excalidraw-library-install", (event) => {
      if (typeof event.payload === "string") cb(event.payload);
    });
    return () => unlisten();
  },
};

const librariesWindow: HostLibrariesWindow = {
  async open(url: string) {
    if (!isTauri()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const core = await import("@tauri-apps/api/core");
    await core.invoke("open_libraries_window", { url });
  },
};

// IndexedDB-backed library storage with a compatible schema to the existing app.
// Reuses the current key so existing installs are preserved.
const libraryStorage: LibraryStorage = {
  async load() {
    const { loadLibraryFromIndexedDb } = await import("./libraryIndexedDb");
    return await loadLibraryFromIndexedDb();
  },
  async save(data: unknown) {
    const { saveLibraryToIndexedDb } = await import("./libraryIndexedDb");
    await saveLibraryToIndexedDb(data as any);
  },
};

export function createTauriHost(): HostAdapter {
  return { storage, files, clipboard, libraryStorage, theme, external, deepLinks, librariesWindow };
}
