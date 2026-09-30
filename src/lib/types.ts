export interface CrowdAnalysis {
  peopleDetected: number;
  activeZones: number;
  riskLevel: "Low" | "Elevated" | "High" | "Critical";
  activeIncidents: number;
  occupancy: number;
  crowdLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  riskScore: number;
  confidence: number;
}

/** Response returned by the FastAPI image-analysis endpoint. */
export interface CrowdAnalysisResult {
  peopleCount: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  riskScore: number;
  occupancyPercent: number;
  confidence: number;
  processingMs: number;
  coordinatesNormalized: boolean;
  detections: PersonDetection[];
}

export interface PersonDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

export interface RecommendationResult {
  recommendation: string;
  model: string;
  localInference: boolean;
  fallback: boolean;
}

export interface AutomationStatus {
  status: "dispatched" | "offline" | "not_triggered" | "standby";
  dispatchedAt: string | null;
  detail: string | null;
}

export interface Zone {
  id: string;
  name: string;
  checkpoint: string;
  occupancy: number;
  status: "NORMAL" | "WATCH" | "CRITICAL";
}

export interface Incident {
  id: string;
  title: string;
  detail: string;
  time: string;
  kind: "alert" | "action" | "notice";
}

export interface AIRecommendation {
  message: string;
  source: string;
  createdAt: string;
}
