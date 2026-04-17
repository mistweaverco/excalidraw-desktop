import type { Theme } from "../host/types";

export type ExcalidrawElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "freedraw"
  | "draw"
  | "text"
  | "image"
  | "frame"
  | "mermaid";

export type ExcalidrawBaseElement = {
  id: string;
  type: ExcalidrawElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "hachure" | "solid" | "cross-hatch" | "zigzag";
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: number;
  opacity?: number; // 0..100
  /** Corner radius in px when a number (Excalidraw may use other shapes). */
  roundness?: unknown;
  seed?: number;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  locked?: boolean;
  groupIds?: string[];
  frameId?: string | null;
  link?: string | null;
  customData?: Record<string, unknown>;
};

export type ExcalidrawTextElement = ExcalidrawBaseElement & {
  type: "text";
  text: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  containerId?: string | null;
};

export type ExcalidrawImageElement = ExcalidrawBaseElement & {
  type: "image";
  fileId: string;
  status?: "pending" | "saved" | "error";
  scale?: [number, number];
};

export type ExcalidrawMermaidElement = ExcalidrawBaseElement & {
  type: "mermaid";
  source: string;
};

export type ExcalidrawElement =
  | ExcalidrawBaseElement
  | ExcalidrawTextElement
  | ExcalidrawImageElement
  | ExcalidrawMermaidElement;

export type BinaryFileData = {
  id: string;
  mimeType: string;
  dataURL: string; // data:<mime>;base64,...
  created: number;
  lastRetrieved?: number;
};

export type AppState = {
  theme: Theme;
  name?: string;
  viewBackgroundColor?: string;
  zoom: number; // 1.0 = 100%
  scrollX: number;
  scrollY: number;
  selectedElementIds: Record<string, true>;
  activeTool:
    | "selection"
    | "hand"
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "line"
    | "arrow"
    | "freedraw"
    | "text"
    | "image"
    | "frame"
    | "mermaid";
  /** Excalidraw-style: 1=handwritten, 2=normal, 3=code, 4=serif */
  currentItemFontFamily?: number;
  currentItemFontSize?: number;
  /** Defaults for new text / container labels */
  currentItemTextAlign?: "left" | "center" | "right";
  currentItemVerticalAlign?: "top" | "middle" | "bottom";
  /** 0 architect, 1 artist, 2 cartoonist */
  currentItemRoughness?: number;
  currentItemStrokeColor?: string;
  currentItemBackgroundColor?: string;
  /** 1 thin, 2 medium, 4 thick (Excalidraw-like) */
  currentItemStrokeWidth?: number;
  currentItemStrokeStyle?: "solid" | "dashed" | "dotted";
  currentItemOpacity?: number;
  currentItemFillStyle?: "hachure" | "solid" | "cross-hatch" | "zigzag";
  /** 0 sharp, >0 rounded corners for new shapes */
  currentItemRoundness?: number;
  /**
   * When true, keep the active drawing tool after placing a shape (Excalidraw “lock”).
   * When false (default), switch to the selection tool after each shape — matching Excalidraw.
   */
  keepToolAfterDraw?: boolean;
  /** Excalidraw file export fields (see upstream `cleanAppStateForExport`). */
  gridSize?: number;
  gridStep?: number;
  gridModeEnabled?: boolean;
  lockedMultiSelections?: Record<string, unknown>;
};

export type Scene = {
  elements: ExcalidrawElement[];
  files: Record<string, BinaryFileData>;
  appState: AppState;
};
