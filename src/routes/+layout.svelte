<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { browser } from "$app/environment";
  import { base } from "$app/paths";
  import Titlebar from "$lib/ui/Titlebar.svelte";
  import ResizeHandles from "$lib/ui/ResizeHandles.svelte";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  /**
   * We persist **outer** size + `frame` (outer−inner at save time). `setSize` only accepts **inner**
   * size, so on restore: inner = outer − frame. When inner===outer (common on Linux), frame is 0.
   */
  const KEY = "excalidraw:window:size";
  /** Set `localStorage` to `"1"` to log window-size decisions (same tag in dev without setting). */
  const WINDOW_SIZE_DEBUG_KEY = "excalidraw:window:size:debug";
  const APP_HOME_KEY = "excalidraw:appHome";

  function windowSizeDebugEnabled(): boolean {
    if (!browser || typeof localStorage === "undefined") return false;
    try {
      return import.meta.env.DEV || localStorage.getItem(WINDOW_SIZE_DEBUG_KEY) === "1";
    } catch {
      return import.meta.env.DEV;
    }
  }

  function logWindowSize(...args: unknown[]): void {
    if (!windowSizeDebugEnabled()) return;
    console.info("[window-size]", ...args);
  }

  type StoredWindowSizeOuter = {
    width: number;
    height: number;
    physical: true;
    extent: "outer";
    frame: { w: number; h: number };
  };

  function writeStoredOuter(outer: { width: number; height: number }, frame: { w: number; h: number }) {
    try {
      const payload: StoredWindowSizeOuter = {
        width: outer.width,
        height: outer.height,
        physical: true,
        extent: "outer",
        frame: { w: frame.w, h: frame.h },
      };
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
      // ignore (quota/permissions)
    }
  }

  function isExcalidrawSiteHostname(hostname: string): boolean {
    return hostname === "excalidraw.com" || hostname.endsWith(".excalidraw.com");
  }

  /** Remember our real app URL so install links work after navigating to libraries / excalidraw.com in the same tab. */
  function ensureAppHomeStored() {
    if (!browser || typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(APP_HOME_KEY)) return;
    if (isExcalidrawSiteHostname(window.location.hostname)) return;
    const b = base || "";
    const home =
      b === "" ? `${window.location.origin}/` : `${window.location.origin}${b.endsWith("/") ? b : b + "/"}`;
    sessionStorage.setItem(APP_HOME_KEY, home);
  }

  /** Where the embedded Excalidraw app lives (for library install navigation). */
  function resolveAppHomeUrl(): string {
    const b = base || "";
    const computed =
      b === "" ? `${window.location.origin}/` : `${window.location.origin}${b.endsWith("/") ? b : b + "/"}`;
    if (typeof sessionStorage !== "undefined") {
      const stored = sessionStorage.getItem(APP_HOME_KEY);
      if (stored) return stored;
    }
    if (isExcalidrawSiteHostname(window.location.hostname)) {
      if (import.meta.env.DEV) return "http://localhost:1420/";
      return computed;
    }
    return computed;
  }

  function normalizeHttpHref(href: string): string {
    const t = href.trim();
    if (t.startsWith("//")) return `https:${t}`;
    return t;
  }

  /**
   * Install handoff URLs: `excalidraw.com/?addLibrary=…`, `*.excalidraw.com` with the same,
   * or `tauri://localhost/#addLibrary=<encoded .excalidrawlib URL>&token=…` from the libraries site.
   */
  function isExcalidrawComAddLibraryInstallUrl(href: string): boolean {
    try {
      const u = new URL(normalizeHttpHref(href), window.location.href);
      const host = u.hostname.replace(/^www\./, "");
      const hasAddLibrary =
        u.searchParams.has("addLibrary") ||
        (u.hash.length > 1 && new URLSearchParams(u.hash.slice(1)).has("addLibrary"));
      if (!hasAddLibrary) return false;
      if (u.protocol === "tauri:") return true;
      return (
        host === "excalidraw.com" ||
        host.endsWith(".excalidraw.com") ||
        host === "localhost" ||
        host === "127.0.0.1"
      );
    } catch {
      return false;
    }
  }

  function navigateAddLibraryInstallToThisApp(href: string) {
    try {
      const u = new URL(normalizeHttpHref(href), window.location.href);
      let addLibrary = u.searchParams.get("addLibrary");
      let token = u.searchParams.get("token");
      if (!addLibrary && u.hash.length > 1) {
        const hp = new URLSearchParams(u.hash.slice(1));
        addLibrary = hp.get("addLibrary");
        token = hp.get("token") ?? token;
      }
      if (!addLibrary) return;
      const p = new URLSearchParams();
      p.set("addLibrary", addLibrary);
      if (token) p.set("token", token);
      const dest = new URL(resolveAppHomeUrl());
      dest.search = "";
      dest.hash = "#" + p.toString();
      window.location.assign(dest.toString());
    } catch {
      // ignore
    }
  }

  /** Browse libraries — `libraries.excalidraw.com` (named window targets are flaky in Wry). */
  function isLibrariesExcalidrawUrl(href: string): boolean {
    try {
      return new URL(normalizeHttpHref(href), window.location.href).hostname === "libraries.excalidraw.com";
    } catch {
      return false;
    }
  }

  /**
   * Second window ≈ new tab; main stays on localhost so install redirects target the drawing app.
   * The window is created in Rust with `on_navigation` / `on_new_window` hooks so `excalidraw.com/?addLibrary=…`
   * works in the packaged app (the plain JS `WebviewWindow` API does not install those hooks).
   */
  async function openLibrariesInDedicatedWindow(href: string) {
    if (!browser) return;
    if (!(globalThis as any).__TAURI_INTERNALS__) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_libraries_window", { url: href });
    } catch (e) {
      console.error(e);
      window.location.assign(href);
    }
  }

  /** `excalidraw://…` from the OS — apply the same hash/query as http://localhost:1420/#addLibrary=… */
  function applyDeepLink(url: string) {
    try {
      const u = new URL(url);
      if (u.protocol !== "excalidraw:") return;
      if (u.hash.length > 1) {
        window.location.hash = u.hash;
        return;
      }
      const addLibrary = u.searchParams.get("addLibrary");
      const token = u.searchParams.get("token");
      if (addLibrary) {
        const p = new URLSearchParams();
        p.set("addLibrary", addLibrary);
        if (token) p.set("token", token);
        window.location.hash = `#${p.toString()}`;
      }
    } catch {
      // ignore
    }
  }

  function excalidrawHandoffHref(): string {
    const h = window.location.hash.slice(1);
    if (h) return `excalidraw://open/#${h}`;
    const q = window.location.search;
    if (q) return `excalidraw://open${q}`;
    return "excalidraw://open/";
  }

  let showBrowserAppHandoff = $state(false);
  let showTitlebar = $state(false);

  onMount(() => {
    if (browser) {
      ensureAppHomeStored();
      const isTauri = Boolean((globalThis as any).__TAURI_INTERNALS__);
      showTitlebar = isTauri;
      if (isTauri) {
        // Frontend-ready ping: now that the webview has mounted, ask Rust to restore window state.
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("restore_main_window_state"))
          .catch(() => {
            // ignore
          });
      }
      if (!isTauri) {
        const hasQ =
          window.location.search.includes("addLibrary=") ||
          new URLSearchParams(window.location.search).has("addLibrary");
        const hasH =
          window.location.hash.length > 1 &&
          new URLSearchParams(window.location.hash.slice(1)).has("addLibrary");
        showBrowserAppHandoff = hasQ || hasH;
      }
    }
  });

  onMount(() => {
    if (!(globalThis as any).__TAURI_INTERNALS__) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const u = await listen<string>("excalidraw-library-install", (event) => {
        if (typeof event.payload === "string") {
          navigateAddLibraryInstallToThisApp(event.payload);
        }
      });
      if (cancelled) u();
      else unlisten = u;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  });

  onMount(() => {
    if (!(globalThis as any).__TAURI_INTERNALS__) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      const start = await getCurrent();
      if (cancelled) return;
      if (start?.length) {
        for (const u of start) applyDeepLink(u);
      }
      unlisten = await onOpenUrl((urls) => {
        for (const u of urls) applyDeepLink(u);
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  });

  onMount(() => {
    const onLinkClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!el) return;
      const raw = el.getAttribute("href");
      if (!raw) return;
      const href = normalizeHttpHref(raw);
      if (!/^https?:\/\//i.test(href)) return;

      if (isExcalidrawComAddLibraryInstallUrl(href)) {
        e.preventDefault();
        e.stopPropagation();
        navigateAddLibraryInstallToThisApp(href);
        return;
      }

      try {
        const target = new URL(href, window.location.href);
        if (target.origin === window.location.origin) return;
      } catch {
        return;
      }

      if (isLibrariesExcalidrawUrl(href)) {
        e.preventDefault();
        e.stopPropagation();
        void openLibrariesInDedicatedWindow(href);
        return;
      }

      if (!(globalThis as any).__TAURI_INTERNALS__) return;

      e.preventDefault();
      e.stopPropagation();
      void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href));
    };
    document.addEventListener("click", onLinkClick, true);
    return () => document.removeEventListener("click", onLinkClick, true);
  });
</script>

{#if showBrowserAppHandoff}
  <div
    class="fixed top-0 left-0 right-0 z-[99999] px-4 py-2.5 text-sm bg-base-200 text-base-content border-b border-base-300 flex items-center gap-3 flex-wrap"
  >
    <span>Open this library install in the desktop app (http links cannot switch to the app automatically).</span>
    <a href={excalidrawHandoffHref()} class="link link-primary font-semibold">Open in Excalidraw Deskop</a>
  </div>
{/if}

{#if showTitlebar}
  <Titlebar />
  <ResizeHandles />
{/if}

<div
  style={showTitlebar
    ? "--app-titlebar-height:36px;height:100vh;overflow:hidden;"
    : "--app-titlebar-height:0px;height:100vh;overflow:hidden;"}
>
  {@render children()}
</div>
