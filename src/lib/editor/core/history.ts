import type { Scene } from "./types";

export type HistoryEntry = {
  scene: Scene;
};

export type HistoryState = {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
};

export function createHistory(initial: Scene): HistoryState {
  return { past: [], present: { scene: initial }, future: [] };
}

export function pushHistory(history: HistoryState, next: Scene, max = 100): HistoryState {
  const past = [...history.past, history.present];
  const trimmed = past.length > max ? past.slice(past.length - max) : past;
  return { past: trimmed, present: { scene: next }, future: [] };
}

export function undo(history: HistoryState): HistoryState {
  if (!history.past.length) return history;
  const prev = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [history.present, ...history.future];
  return { past, present: prev, future };
}

export function redo(history: HistoryState): HistoryState {
  if (!history.future.length) return history;
  const next = history.future[0];
  const future = history.future.slice(1);
  const past = [...history.past, history.present];
  return { past, present: next, future };
}
