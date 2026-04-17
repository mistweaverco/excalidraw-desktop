import type { HostAdapter } from "../host/types";
import type { ExcalidrawElement } from "../core/types";
import { createEmptyLibrary, type LibraryItem, type LibraryStateV2 } from "./libraryTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
    if (u.hostname === "libraries.excalidraw.com") return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeLoadedLibrary(raw: unknown): LibraryStateV2 {
  // New schema
  if (
    isRecord(raw) &&
    raw.schema === "excalidraw-desktop-library" &&
    raw.version === 2 &&
    Array.isArray(raw.items)
  ) {
    return raw as unknown as LibraryStateV2;
  }

  // Old schema (existing app): { libraryItems: unknown }
  if (isRecord(raw) && "libraryItems" in raw && Array.isArray((raw as any).libraryItems)) {
    const items = ((raw as any).libraryItems as any[]).map((it) => {
      const id = typeof it?.id === "string" ? it.id : `lib_${Math.random().toString(16).slice(2)}`;
      const name = typeof it?.name === "string" && it.name.trim() ? it.name.trim() : "Untitled";
      const elements = Array.isArray(it?.elements) ? (it.elements as ExcalidrawElement[]) : [];
      const ts = typeof it?.created === "number" ? it.created : Date.now();
      const upd = typeof it?.updated === "number" ? it.updated : ts;
      const tags = Array.isArray(it?.tags) ? it.tags.filter((t: any) => typeof t === "string") : [];
      const group = typeof it?.group === "string" ? it.group : null;
      return { id, name, elements, tags, group, created: ts, updated: upd } satisfies LibraryItem;
    });
    return { schema: "excalidraw-desktop-library", version: 2, items };
  }

  return createEmptyLibrary();
}

export function parseLibraryJson(json: string): LibraryStateV2 {
  try {
    const raw = JSON.parse(json) as unknown;
    return normalizeLoadedLibrary(raw);
  } catch {
    return createEmptyLibrary();
  }
}

export function serializeLibraryForExport(lib: LibraryStateV2): string {
  // Export in a broadly-compatible shape (Excalidraw uses `libraryItems`),
  // while preserving our richer metadata (name/group/tags/timestamps).
  return JSON.stringify(
    {
      schema: lib.schema,
      version: lib.version,
      items: lib.items.map((i) => ({ ...i })),
      libraryItems: lib.items.map((i) => ({ ...i })),
    },
    null,
    2,
  );
}

export async function loadLibrary(host: HostAdapter): Promise<LibraryStateV2> {
  const raw = await host.libraryStorage.load();
  return normalizeLoadedLibrary(raw);
}

export async function saveLibrary(host: HostAdapter, lib: LibraryStateV2): Promise<void> {
  // Persist in the *old* shape too, so users can downgrade without losing data.
  const legacy = { libraryItems: lib.items.map((i) => ({ ...i })) };
  await host.libraryStorage.save(legacy);
}

export async function importLibraryFromUrl(
  host: HostAdapter,
  url: string,
): Promise<LibraryItem[] | null> {
  if (!isAllowedLibraryUrl(url)) return null;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  if (!isRecord(json)) return null;

  // Excalidraw library payload usually includes `libraryItems`.
  const libraryItems = (json as any).libraryItems;
  if (!Array.isArray(libraryItems)) return null;

  const items: LibraryItem[] = libraryItems.map((it: any) => {
    const id = typeof it?.id === "string" ? it.id : `lib_${Math.random().toString(16).slice(2)}`;
    const name = typeof it?.name === "string" && it.name.trim() ? it.name.trim() : "Library item";
    const elements = Array.isArray(it?.elements) ? (it.elements as ExcalidrawElement[]) : [];
    const created = Date.now();
    return { id, name, group: null, tags: [], elements, created, updated: created };
  });
  return items;
}

export function mergeLibraryItems(
  existing: LibraryStateV2,
  incoming: LibraryItem[],
): LibraryStateV2 {
  // Preserve existing order; update matching items in-place by id; append new ids at the end.
  if (!existing.items.length) {
    return { ...existing, items: incoming.map((i) => ({ ...i })) };
  }

  const byId = new Map(existing.items.map((i) => [i.id, i] as const));
  const nextItems = existing.items.map((prev) => {
    const it = incoming.find((n) => n.id === prev.id);
    if (!it) return prev;
    return { ...prev, ...it, updated: Date.now() };
  });

  const existingIds = new Set(existing.items.map((i) => i.id));
  for (const it of incoming) {
    if (existingIds.has(it.id)) continue;
    byId.set(it.id, it);
    nextItems.push(it);
  }

  return { ...existing, items: nextItems };
}
