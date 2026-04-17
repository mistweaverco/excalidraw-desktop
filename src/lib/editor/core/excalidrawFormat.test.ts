import { roundTripTest } from "./excalidrawFormat";

const minimal = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [
    {
      id: "a",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      strokeColor: "#000000",
      backgroundColor: "#ffffff",
    },
  ],
  appState: { theme: "light", name: "Doc", viewBackgroundColor: "#fff" },
  files: {},
});

export function runFormatTests(): void {
  const r = roundTripTest(minimal, "light");
  if (!r.ok) throw new Error(`roundTripTest failed: ${r.error ?? "unknown"}`);
}
