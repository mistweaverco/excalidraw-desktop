<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { browser } from "$app/environment";
  import { base } from "$app/paths";

  let { children }: { children: Snippet } = $props();

  const KEY = "excalidraw:window:size:v1";
  const APP_HOME_KEY = "excalidraw:appHome";

  type StoredSize = { width: number; height: number };

  function readStoredSize(): StoredSize | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredSize>;
      if (typeof parsed.width !== "number" || typeof parsed.height !== "number") return null;
      if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
      if (parsed.width < 200 || parsed.height < 200) return null;
      return { width: parsed.width, height: parsed.height };
    } catch {
      return null;
    }
  }

  function writeStoredSize(size: StoredSize) {
    try {
      localStorage.setItem(KEY, JSON.stringify(size));
    } catch {
      // ignore (quota/permissions)
    }
  }

  function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, waitMs: number) {
    let t: ReturnType<typeof setTimeout> | null = null;
    return (...args: TArgs) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
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

  onMount(() => {
    if (browser) {
      ensureAppHomeStored();
      const isTauri = Boolean((globalThis as any).__TAURI_INTERNALS__);
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

  onMount(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      let isTauriFn: (() => boolean) | null = null;
      try {
        const core = await import("@tauri-apps/api/core");
        isTauriFn = core.isTauri;
      } catch {
        // ignore
      }

      if (!(isTauriFn?.() || (globalThis as any).__TAURI_INTERNALS__)) return;

      let api: typeof import("@tauri-apps/api/window");
      try {
        api = await import("@tauri-apps/api/window");
      } catch {
        return;
      }

      const win = api.getCurrentWindow();
      const LogicalSize = api.LogicalSize;

      const stored = readStoredSize();
      if (stored) {
        try {
          await win.setSize(new LogicalSize(stored.width, stored.height));
        } catch (ex) {
          console.error(ex);
        }
      }

      const saveSize = debounce(async () => {
        try {
          const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
          const width = Math.round(size.width / scale);
          const height = Math.round(size.height / scale);
          writeStoredSize({ width, height });
        } catch (ex) {
          console.error(ex);
        }
      }, 1000);

      unlisten = await win.onResized(() => {
        saveSize();
      });
    })();

    return () => {
      unlisten?.();
    };
  });
</script>

{#if showBrowserAppHandoff}
  <div
    style="position:fixed;z-index:99999;top:0;left:0;right:0;padding:10px 14px;font:14px system-ui,sans-serif;background:#1e1e2e;color:#eee;border-bottom:1px solid #444;display:flex;align-items:center;gap:12px;flex-wrap:wrap;"
  >
    <span>Open this library install in the desktop app (http links cannot switch to the app automatically).</span>
    <a href={excalidrawHandoffHref()} style="color:#89b4fa;font-weight:600;">Open in Excalidraw Deskop</a>
  </div>
{/if}

{@render children()}
