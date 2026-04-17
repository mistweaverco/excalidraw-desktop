import type { ExcalidrawElement } from "../core/types";

export type LibraryItem = {
  id: string;
  name: string;
  group: string | null;
  tags: string[];
  // Stored as Excalidraw-like elements to preserve compatibility.
  elements: ExcalidrawElement[];
  created: number;
  updated: number;
};

export type LibraryStateV2 = {
  schema: "excalidraw-desktop-library";
  version: 2;
  items: LibraryItem[];
};

export function createEmptyLibrary(): LibraryStateV2 {
  return { schema: "excalidraw-desktop-library", version: 2, items: [] };
}
