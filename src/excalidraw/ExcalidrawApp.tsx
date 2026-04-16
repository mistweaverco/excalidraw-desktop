// @ts-nocheck
import React from "react";
import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
// @ts-expect-error resolved by esbuild export conditions during bundling
import excalidrawCss from "@excalidraw/excalidraw/index.css";
import { loadLibraryFromIndexedDb, saveLibraryToIndexedDb } from "./libraryIndexedDb";

function injectCss(css: string) {
  const style = document.createElement("style");
  style.setAttribute("data-excalidraw", "excalidraw-css");
  style.textContent = css;
  document.head.appendChild(style);
}

type Theme = "light" | "dark";

const APP_STATE_KEY = "excalidraw:excalidraw:appState";
const THEME_MODE_KEY = "excalidraw-desktop:themeMode:v1";
type ThemeMode = "auto" | "light" | "dark";

function getSystemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

async function getTauriTheme(): Promise<Theme | null> {
  try {
    const api = await import("@tauri-apps/api/window");
    const w: any = api.getCurrentWindow?.() ?? (api as any).appWindow;
    const t = await w?.theme?.();
    return t === "dark" ? "dark" : t === "light" ? "light" : null;
  } catch {
    return null;
  }
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function loadSavedAppState(): Record<string, unknown> | null {
  return safeParseJson<Record<string, unknown>>(localStorage.getItem(APP_STATE_KEY));
}

function loadThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_MODE_KEY);
  return raw === "light" || raw === "dark" || raw === "auto" ? (raw as ThemeMode) : "auto";
}

function persistThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

function persistPrefs(appState: any) {
  const prefs = {
    viewBackgroundColor: appState?.viewBackgroundColor,
    currentItemStrokeColor: appState?.currentItemStrokeColor,
    currentItemBackgroundColor: appState?.currentItemBackgroundColor,
    currentItemFillStyle: appState?.currentItemFillStyle,
    currentItemStrokeWidth: appState?.currentItemStrokeWidth,
    currentItemStrokeStyle: appState?.currentItemStrokeStyle,
    currentItemRoughness: appState?.currentItemRoughness,
    currentItemOpacity: appState?.currentItemOpacity,
    currentItemFontFamily: appState?.currentItemFontFamily,
    currentItemFontSize: appState?.currentItemFontSize,
    gridSize: appState?.gridSize,
    zenModeEnabled: appState?.zenModeEnabled,
    viewModeEnabled: appState?.viewModeEnabled,
  };

  localStorage.setItem(APP_STATE_KEY, JSON.stringify(prefs));
}

async function setTauriAppTheme(theme: Theme | null) {
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("set_theme", { theme });
  } catch {
    // ignore (browser/dev server or older Tauri injection)
  }
}

/**
 * Default Excalidraw allowlist only permits the root path on excalidraw.com.
 * Published libraries live at https://libraries.excalidraw.com/libraries/...
 * and would fail validation without this.
 */
function isAllowedLibraryUrl(libraryUrl: string): boolean {
  try {
    const u = new URL(libraryUrl);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "excalidraw.com" || u.hostname.endsWith(".excalidraw.com")) return true;
    if (
      u.hostname === "raw.githubusercontent.com" &&
      u.pathname.includes("/excalidraw/excalidraw-libraries")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** IndexedDB — avoids localStorage quota limits for large libraries. */
const libraryIndexedDbAdapter = {
  async load() {
    try {
      return await loadLibraryFromIndexedDb();
    } catch (e) {
      console.warn("Failed to load Excalidraw library from IndexedDB:", e);
      return null;
    }
  },
  async save(libraryData: { libraryItems: unknown }) {
    try {
      await saveLibraryToIndexedDb(libraryData);
    } catch (e) {
      console.warn("Failed to persist Excalidraw library:", e);
    }
  },
};

export default function ExcalidrawApp() {
  React.useEffect(() => {
    injectCss(excalidrawCss);
  }, []);

  const saved = React.useMemo(() => loadSavedAppState(), []);
  const initialMode = React.useMemo(() => loadThemeMode(), []);

  const initialTheme = (
    initialMode === "dark" || initialMode === "light" ? initialMode : getSystemTheme()
  ) satisfies Theme;

  const [themeMode, setThemeMode] = React.useState<ThemeMode>(initialMode);
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [excalidrawAPI, setExcalidrawAPI] = React.useState(null);

  useHandleLibrary({
    excalidrawAPI,
    validateLibraryUrl: isAllowedLibraryUrl,
    adapter: libraryIndexedDbAdapter,
  });

  React.useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const apply = async (mode: ThemeMode) => {
        if (mode === "dark" || mode === "light") {
          setTheme(mode);
          void setTauriAppTheme(mode);
          return;
        }

        // Auto: best-effort theme detection for the current platform.
        const tauriTheme = await getTauriTheme();
        if (cancelled) return;
        const resolved = tauriTheme ?? getSystemTheme();
        setTheme(resolved);
        void setTauriAppTheme(tauriTheme);
      };

      await apply(themeMode);
      if (cancelled) return;

      try {
        const api = await import("@tauri-apps/api/window");
        const w: any = api.getCurrentWindow?.() ?? (api as any).appWindow;
        const onThemeChanged =
          w?.onThemeChanged ??
          // Older API shape exposed this via global window listener
          w?.onThemeChange;
        if (typeof onThemeChanged === "function") {
          unlisten = await onThemeChanged.call(w, ({ payload }: any) => {
            if (themeMode !== "auto") return;
            if (payload === "dark" || payload === "light") setTheme(payload);
            if (payload === "dark" || payload === "light") {
              void setTauriAppTheme(payload);
            }
          });
        }
      } catch {
        // ignore; we'll fall back to matchMedia below
      }
    })();

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;

    const onChange = () => {
      if (themeMode !== "auto") return;
      setTheme(getSystemTheme());
    };

    mql.addEventListener?.("change", onChange);
    return () => {
      cancelled = true;
      unlisten?.();
      mql.removeEventListener?.("change", onChange);
    };
  }, [themeMode]);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div
        style={{
          position: "fixed",
          left: "240px",
          bottom: 14,
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 10,
          background: theme === "dark" ? "rgba(20, 20, 22, 0.7)" : "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(10px)",
          border:
            theme === "dark" ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,0,0,0.12)",
          color: theme === "dark" ? "#eee" : "#111",
          font: "10px system-ui, sans-serif",
          userSelect: "none",
        }}
      >
        <span style={{ opacity: 0.85 }}>Theme</span>
        <select
          value={themeMode}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value as ThemeMode;
            const mode: ThemeMode = v === "light" || v === "dark" || v === "auto" ? v : "auto";
            setThemeMode(mode);
            persistThemeMode(mode);
          }}
          style={{
            font: "12px system-ui, sans-serif",
            padding: "4px 6px",
            borderRadius: 8,
            border:
              theme === "dark" ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(0,0,0,0.18)",
            background: theme === "dark" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.8)",
            color: theme === "dark" ? "#eee" : "#111",
            outline: "none",
          }}
        >
          <option value="auto">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <Excalidraw
        theme={theme}
        excalidrawAPI={setExcalidrawAPI}
        initialData={{
          appState: {
            ...(saved ?? {}),
            theme,
          },
        }}
        onChange={(_elements: any, appState: any) => {
          persistPrefs(appState);
        }}
      />
    </div>
  );
}
