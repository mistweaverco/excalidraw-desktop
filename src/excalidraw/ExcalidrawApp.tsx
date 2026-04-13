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

function getSystemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
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

function persistPrefs(appState: any) {
  const prefs = {
    theme: appState?.theme,
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

  const initialTheme = (
    saved?.theme === "dark" || saved?.theme === "light" ? (saved.theme as Theme) : getSystemTheme()
  ) satisfies Theme;

  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [excalidrawAPI, setExcalidrawAPI] = React.useState(null);

  useHandleLibrary({
    excalidrawAPI,
    validateLibraryUrl: isAllowedLibraryUrl,
    adapter: libraryIndexedDbAdapter,
  });

  React.useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;

    const onChange = () => {
      const persisted = loadSavedAppState();
      if (persisted?.theme === "dark" || persisted?.theme === "light") return;
      setTheme(getSystemTheme());
    };

    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
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
          if (appState?.theme === "dark" || appState?.theme === "light") {
            setTheme(appState.theme as Theme);
          }
          persistPrefs(appState);
        }}
      />
    </div>
  );
}
