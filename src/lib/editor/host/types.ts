export type Theme = "light" | "dark";

export type ThemeMode = "auto" | Theme;

export type FileDialogFilter = {
  name: string;
  extensions: string[];
};

export type PickFileOptions = {
  title?: string;
  filters?: FileDialogFilter[];
};

export type SaveFileOptions = {
  title?: string;
  defaultPath?: string;
  filters?: FileDialogFilter[];
  /**
   * When set (e.g. current document path from Open), write bytes here without showing a dialog.
   * Desktop/Tauri only; ignored where the host cannot write by path.
   */
  writeToPath?: string;
};

export type PickedFile = {
  path: string;
  bytes: Uint8Array;
};

export type ClipboardImage = {
  mimeType: string;
  bytes: Uint8Array;
};

export interface HostStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LibraryStorage {
  load(): Promise<unknown | null>;
  save(data: unknown): Promise<void>;
}

export interface HostFiles {
  openFile(options: PickFileOptions): Promise<PickedFile | null>;
  saveFile(options: SaveFileOptions, bytes: Uint8Array): Promise<string | null>;
}

export interface HostClipboard {
  readImage(): Promise<ClipboardImage | null>;
}

export interface HostTheme {
  getSystemTheme(): Theme;
  getNativeTheme(): Promise<Theme | null>;
  setNativeTheme(theme: Theme | null): Promise<void>;
  subscribeNativeThemeChanged?(cb: (theme: Theme) => void): Promise<() => void>;
  subscribeSystemThemeChanged?(cb: (theme: Theme) => void): () => void;
}

export interface HostExternal {
  openUrl(url: string): Promise<void>;
}

export interface HostDeepLinks {
  subscribeLibraryInstallUrl(cb: (url: string) => void): Promise<() => void>;
  subscribeDeepLinks?(cb: (url: string) => void): Promise<() => void>;
}

export interface HostLibrariesWindow {
  open(url: string): Promise<void>;
}

export type HostAdapter = {
  storage: HostStorage;
  files: HostFiles;
  clipboard: HostClipboard;
  libraryStorage: LibraryStorage;
  theme: HostTheme;
  external: HostExternal;
  deepLinks: HostDeepLinks;
  librariesWindow: HostLibrariesWindow;
};
