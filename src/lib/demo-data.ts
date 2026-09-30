import type { CrowdAnalysisResult } from "./types";

/** Bundled local scenario; loading it never calls the vision endpoint. */
export const demoCrowdAnalysis: CrowdAnalysisResult = {
  peopleCount: 42,
  riskLevel: "CRITICAL",
  riskScore: 100,
  occupancyPercent: 86,
  confidence: 0.94,
  processingMs: 584,
  coordinatesNormalized: true,
  detections: Array.from({ length: 18 }, (_, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const x1 = 0.08 + column * 0.145 + (row % 2) * 0.025;
    const y1 = 0.25 + row * 0.2 + (column % 2) * 0.025;
    return {
      x1,
      y1,
      x2: Math.min(0.98, x1 + 0.075),
      y2: Math.min(0.93, y1 + 0.19),
      confidence: 0.91 + (index % 8) / 100,
    };
  }),
};
