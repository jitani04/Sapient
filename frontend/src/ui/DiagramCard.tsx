import { lazy, Suspense, useMemo } from "react";
import type { DiagramData } from "../types";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw }))
);

interface Props {
  diagram: DiagramData;
}

export function DiagramCard({ diagram }: Props) {
  const initialData = useMemo(() => ({
    elements: diagram.elements,
    appState: {
      viewBackgroundColor: "transparent",
      theme: "light" as const,
    },
    scrollToContent: true,
  }), [diagram]);

  return (
    <div className="diagram-card">
      {diagram.title && <div className="diagram-card-title">{diagram.title}</div>}
      <div className="diagram-canvas">
        <Suspense fallback={<div className="diagram-loading">Rendering diagram…</div>}>
          <Excalidraw
            initialData={initialData}
            viewModeEnabled
            zenModeEnabled={false}
            gridModeEnabled={false}
          />
        </Suspense>
      </div>
    </div>
  );
}
