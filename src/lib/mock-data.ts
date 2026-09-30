import type { AIRecommendation, CrowdAnalysis, Incident, Zone } from "./types";

export const analysis: CrowdAnalysis = {
  peopleDetected: 43,
  activeZones: 4,
  riskLevel: "Elevated",
  activeIncidents: 1,
  occupancy: 86,
  crowdLevel: "HIGH",
  riskScore: 82,
  confidence: 94,
};

export const zones: Zone[] = [
  { id: "A", name: "Zone A", checkpoint: "Gate A", occupancy: 86, status: "CRITICAL" },
  { id: "B", name: "Zone B", checkpoint: "Gate B", occupancy: 48, status: "NORMAL" },
  { id: "C", name: "Zone C", checkpoint: "Exit East", occupancy: 61, status: "WATCH" },
  { id: "D", name: "Zone D", checkpoint: "Food Court", occupancy: 34, status: "NORMAL" },
];

export const incidents: Incident[] = [
  { id: "01", title: "Density threshold exceeded", detail: "Zone A · occupancy reached 86%", time: "14:32:08", kind: "alert" },
  { id: "02", title: "Diversion recommended", detail: "Gate A → Gate B · AI recommendation", time: "14:32:14", kind: "action" },
  { id: "03", title: "Operations team notified", detail: "Control room · alert acknowledged", time: "14:33:02", kind: "notice" },
];

export const recommendation: AIRecommendation = {
  message: "Restrict new entry through Gate A and redirect incoming visitors toward Gate B until occupancy drops below 70%.",
  source: "Generated locally by Gemma",
  createdAt: "14:32:14",
};

export const crowdReadings = [
  { time: "14:21", people: 28 }, { time: "14:22", people: 31 },
  { time: "14:23", people: 29 }, { time: "14:24", people: 34 },
  { time: "14:25", people: 32 }, { time: "14:26", people: 36 },
  { time: "14:27", people: 35 }, { time: "14:28", people: 39 },
  { time: "14:29", people: 37 }, { time: "14:30", people: 41 },
  { time: "14:31", people: 40 }, { time: "14:32", people: 43 },
];
