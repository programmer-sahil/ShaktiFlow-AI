"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Camera,
  Check, CheckCircle2, ChevronDown, Clock3, Command, Gauge, LayoutDashboard, LifeBuoy,
  LockKeyhole, MapPin, MoreHorizontal, Radio, ScanLine, Shield, ShieldCheck,
  SlidersHorizontal, Upload, Users, Workflow,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyzeCrowd, dispatchCriticalAutomation, getAutomationStatus, recommendCrowd } from "@/lib/api";
import { analysis as mockSummary, crowdReadings, incidents, zones } from "@/lib/mock-data";
import { demoCrowdAnalysis } from "@/lib/demo-data";
import type { AutomationStatus, CrowdAnalysisResult, Incident, PersonDetection, RecommendationResult } from "@/lib/types";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Live Monitor", icon: Radio },
  { label: "Incidents", icon: AlertTriangle, badge: "01" },
  { label: "Analytics", icon: Activity },
  { label: "Automation", icon: SlidersHorizontal },
  { label: "System", icon: ShieldCheck },
];

function Sidebar() {
  const [selected, setSelected] = useState("Overview");
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><ScanLine size={19} strokeWidth={2.1} /></div><span>shakti<span className="brand-light">flow</span></span><span className="brand-tag">OPS</span></div>
    <div className="workspace-label">WORKSPACE</div>
    <button className="site-switcher"><span className="site-avatar">K</span><span className="site-copy"><strong>Kalighat Puja</strong><small>Event workspace</small></span><ChevronDown size={14} /></button>
    <div className="nav-label">COMMAND</div>
    <nav className="nav-list">{navigation.map(({ label, icon: Icon, badge }) => <button key={label} onClick={() => setSelected(label)} className={`nav-item ${selected === label ? "selected" : ""}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{badge && <span className="nav-badge">{badge}</span>}</button>)}</nav>
    <div className="sidebar-bottom">
      <div className="uptime-card"><div className="uptime-head"><span><span className="status-dot" /> SYSTEM ONLINE</span><MoreHorizontal size={15} /></div><div className="uptime-value">99.98% <span>uptime</span></div><div className="uptime-track"><i /></div><div className="uptime-meta"><span>All systems operational</span><span>v1.0.4</span></div></div>
      <button className="nav-item support"><LifeBuoy size={16} /><span>Help & support</span></button>
      <div className="user-row"><div className="user-avatar">AS</div><div className="user-copy"><strong>Arjun Sen</strong><small>Operations lead</small></div><MoreHorizontal size={16} /></div>
    </div>
  </aside>;
}

function Topbar({ onLoadDemo }: { onLoadDemo: () => void }) {
  const [now, setNow] = useState("14:32:08");
  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, []);
  return <header className="topbar"><div className="topbar-title"><div className="mobile-brand"><div className="brand-mark"><ScanLine size={17} /></div></div><div><h1>Command Center</h1><div className="location"><MapPin size={12} /> Kolkata <span>·</span> Operations <span className="crumb-divider">/</span> <b>Overview</b></div></div></div>
    <div className="topbar-actions"><div className="live-status"><i /> Operational</div><div className="clock"><Clock3 size={14} /><span>{now}</span><span className="clock-zone">IST</span></div><button className="icon-button notification" aria-label="Notifications"><Bell size={16} /><i /></button><button className="demo-button" onClick={onLoadDemo}>Load Demo Scenario</button><button className="new-analysis" onClick={() => document.getElementById("file-upload")?.click()}><span>+</span> New Analysis</button></div>
  </header>;
}

function Metric({ title, value, unit, icon: Icon, tone, note, trend }: { title: string; value: string; unit?: string; icon: typeof Users; tone?: string; note: string; trend?: string }) {
  return <article className="metric"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone ?? ""}`}><Icon size={15} /></span></div><div className="metric-value">{value}{unit && <small>{unit}</small>}</div><div className="metric-foot">{trend && <span className="trend"><ArrowUpRight size={12} /> {trend}</span>}<span>{note}</span></div></article>;
}

type AnalysisState = "idle" | "analyzing" | "complete" | "demo" | "error";

function VideoFeed({
  result,
  status,
  error,
  demoVersion,
  onAnalysisStart,
  onAnalysisResult,
  onAnalysisError,
}: {
  result: CrowdAnalysisResult | null;
  status: AnalysisState;
  error: string | null;
  demoVersion: number;
  onAnalysisStart: () => number;
  onAnalysisResult: (result: CrowdAnalysisResult, requestId: number) => void;
  onAnalysisError: (message: string, requestId: number) => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [feedSize, setFeedSize] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastDemoVersion = useRef(0);

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const observer = new ResizeObserver(([entry]) => {
      setFeedSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(feed);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (demoVersion === 0 || demoVersion === lastDemoVersion.current) return;
    lastDemoVersion.current = demoVersion;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(null);
    setFileName("");
    setSourceSize({ width: 0, height: 0 });
  }, [demoVersion, fileUrl]);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
      onAnalysisError("Choose a JPG or PNG image to run person detection.", onAnalysisStart());
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onAnalysisError("Image is over the 10 MB upload limit.", onAnalysisStart());
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileName(file.name);
    setFileUrl(URL.createObjectURL(file));
    setSourceSize({ width: 0, height: 0 });
    const requestId = onAnalysisStart();
    try {
      const analysisResult = await analyzeCrowd(file);
      onAnalysisResult(analysisResult, requestId);
    } catch (cause) {
      onAnalysisError(cause instanceof Error ? cause.message : "Image analysis failed.", requestId);
    }
  };

  const boxStyle = (detection: PersonDetection): CSSProperties | undefined => {
    const { width, height } = feedSize;
    if (!width || !height) return undefined;
    let displayWidth = width;
    let displayHeight = height;
    let offsetX = 0;
    let offsetY = 0;
    if (fileUrl && sourceSize.width && sourceSize.height) {
      const scale = Math.max(width / sourceSize.width, height / sourceSize.height);
      displayWidth = sourceSize.width * scale;
      displayHeight = sourceSize.height * scale;
      offsetX = (width - displayWidth) / 2;
      offsetY = (height - displayHeight) / 2;
    }
    const left = Math.max(0, offsetX + detection.x1 * displayWidth);
    const top = Math.max(0, offsetY + detection.y1 * displayHeight);
    const right = Math.min(width, offsetX + detection.x2 * displayWidth);
    const bottom = Math.min(height, offsetY + detection.y2 * displayHeight);
    if (right <= left || bottom <= top) return undefined;
    return {
      left: `${(left / width) * 100}%`,
      top: `${(top / height) * 100}%`,
      width: `${((right - left) / width) * 100}%`,
      height: `${((bottom - top) / height) * 100}%`,
    };
  };

  const showDemo = status === "demo";
  const showUpload = !fileUrl && !result && (status === "idle" || status === "error");
  return <section className="panel intelligence-panel">
    <div className="panel-heading"><div><div className="eyebrow">CAMERA NETWORK <span className="heading-separator">/</span> ZONE A</div><h2>Live Crowd Intelligence</h2></div><button className="subtle-button"><span className="green-led" /> {showDemo ? "LOCAL DEMO" : "4 cameras"} <ChevronDown size={13} /></button></div>
    <div ref={feedRef} className={`feed ${dragging ? "dragging" : ""} ${status === "analyzing" ? "analyzing" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void onFile(e.dataTransfer.files[0]); }} onClick={() => !fileUrl && status !== "analyzing" && inputRef.current?.click()}>
      <input ref={inputRef} id="file-upload" type="file" accept="image/jpeg,image/png" hidden onChange={e => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      {fileUrl ? <Image className="uploaded-media" src={fileUrl} alt="Uploaded crowd image" fill unoptimized sizes="(max-width: 800px) 100vw, 70vw" onLoad={event => setSourceSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <div className="feed-scene" aria-hidden="true"><div className="scene-ceiling" /><div className="scene-backwall" /><div className="scene-gate"><div className="gate-sign">GATE A <span>ENTRY</span></div><div className="gate-opening" /><div className="gate-post" /></div><div className="scene-lights"><i /><i /><i /><i /></div><div className="scene-crowd">{Array.from({ length: 35 }, (_, i) => <i key={i} className={`person p${i + 1}`}><b /></i>)}</div><div className="scene-floor" /><div className="scan-line" /><div className="tracking-box box-a"><i /><i /><i /><i /><span>PERSON · 98%</span></div><div className="tracking-box box-b"><i /><i /><i /><i /><span>PERSON · 94%</span></div><div className="tracking-box box-c"><i /><i /><i /><i /><span>PERSON · 91%</span></div><div className="scene-vignette" /></div>}
      {(result?.detections ?? []).map((detection, index) => {
        const style = boxStyle(detection);
        return style ? <div className="detection-box" style={style} key={`${index}-${detection.x1}`}><span>PERSON · {Math.round(detection.confidence * 100)}%</span></div> : null;
      })}
      <div className="feed-top-overlay"><span className="camera-tag"><Camera size={12} /> CAMERA 01</span><span className="live-tag"><i /> LIVE</span></div>
      <div className="feed-bottom-overlay"><div className="feed-caption"><span>GATE A · NORTH ENTRANCE</span><small>{showDemo ? "BUNDLED DEMO SCENARIO" : fileUrl ? fileName : "CAM-01 / 1080p / 24 FPS"}</small></div><div className="privacy-tag"><LockKeyhole size={11} /> PRIVACY-SAFE MONITORING</div></div>
      {status === "analyzing" && <div className="analysis-activity" role="status"><span className="activity-spinner" /><span>YOLO PERSON DETECTION</span><small>Analyzing image locally</small></div>}
      {showDemo && <div className="demo-scene-tag">LOCAL DEMO · MOCK METRICS</div>}
      {showUpload && <button className="feed-upload" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}><Upload size={14} /><span>Drop an image or <b>browse files</b></span><small>JPG, PNG · up to 10 MB</small></button>}
    </div>
    {status === "error" && error && <div className="analysis-error" role="alert">{error}<span>Try again or load the local demo scenario.</span></div>}
    <div className="feed-footer"><div className="feed-stat"><span className="feed-stat-icon"><Users size={14} /></span><div><b>{result ? `${result.peopleCount} people detected` : status === "analyzing" ? "Analyzing crowd image…" : "Awaiting image analysis"}</b><small>{result ? `YOLO · ${result.detections.length} person boxes returned` : status === "demo" ? "Bundled scenario · no network required" : "Upload a JPG or PNG to begin"}</small></div></div><div className="feed-footer-right"><span className="detect-state"><i /> {status === "analyzing" ? "Detection in progress" : result ? "Person detection complete" : "Person detection ready"}</span><button className="square-button" aria-label="Feed options"><MoreHorizontal size={16} /></button></div></div>
  </section>;
}

function ProgressLine({ label, value, display, color }: { label: string; value: number; display: string; color: string }) {
  return <div className="progress-row"><div className="progress-label"><span>{label}</span><b>{display}</b></div><div className="progress-track"><i style={{ width: `${value}%`, background: color }} /></div></div>;
}

function RiskAssessment({ result, demo }: { result: CrowdAnalysisResult | null; demo: boolean }) {
  const level = result?.riskLevel ?? mockSummary.crowdLevel;
  const isCritical = level === "CRITICAL";
  const riskColor = isCritical || level === "HIGH" ? "#db7a69" : level === "MODERATE" ? "#e5a64b" : "#74ca96";
  return <section className="panel risk-panel"><div className="panel-heading compact"><div><div className="eyebrow">REAL-TIME ANALYSIS</div><h2>Risk Assessment</h2></div><button className="square-button" aria-label="Risk details"><MoreHorizontal size={16} /></button></div>
    <div className={`risk-level ${level.toLowerCase()}`}><div><div className="risk-overline">CURRENT CROWD LEVEL</div><div className="risk-word">{level} <span>·</span> <small>Zone A</small></div></div><span className="risk-status">{isCritical ? "CRITICAL RISK" : level === "HIGH" ? "ELEVATED RISK" : `${level} RISK`}</span></div>
    {isCritical && <div className={`automation-triggered ${demo ? "demo-trigger" : ""}`}><AlertTriangle size={12} /> {demo ? "DEMO · NO WEBHOOK DISPATCHED" : "AUTOMATION TRIGGERED"}<small>{demo ? "Local scenario only" : "n8n event sent after recommendation"}</small></div>}
    <div className="risk-progress"><ProgressLine label="Occupancy" value={result?.occupancyPercent ?? mockSummary.occupancy} display={`${result?.occupancyPercent ?? mockSummary.occupancy}%`} color={riskColor} /><ProgressLine label="Risk score" value={result?.riskScore ?? mockSummary.riskScore} display={`${result?.riskScore ?? mockSummary.riskScore} / 100`} color={riskColor} /><ProgressLine label="Confidence" value={Math.round((result?.confidence ?? mockSummary.confidence / 100) * 100)} display={`${Math.round((result?.confidence ?? mockSummary.confidence / 100) * 100)}%`} color="#74ca96" /></div>
    <div className="risk-foot"><span><Shield size={13} /> Privacy-safe detection</span><span>{result ? `Processed in ${result.processingMs} ms` : "Awaiting analysis"}</span></div>
  </section>;
}

function Recommendation({ value, loading }: { value: RecommendationResult | null; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = value?.recommendation ?? "Upload an image to generate a local, metrics-based operational recommendation.";
  const isDemo = value?.model === "demo-scenario";
  return <section className="panel recommendation-panel"><div className="panel-heading compact"><div className="recommend-title"><span className="spark-icon"><Command size={14} /></span><div><div className="eyebrow">OPERATIONAL GUIDANCE</div><h2>AI Recommended Action</h2></div></div><span className={`generated-badge ${value?.fallback ? "fallback" : ""}`}>{isDemo ? "DEMO SCENARIO" : value?.fallback ? "RULE FALLBACK" : value ? "GEMMA 4 E2B" : "LOCAL AI"}</span></div>
    <div className="recommendation-body">{loading ? <div className="recommendation-skeleton" role="status" aria-label="Generating local recommendation"><span /><span /><span /></div> : <p className="recommendation-text">{text}</p>}</div>
    <div className="recommendation-footer"><span className="recommendation-source"><span className={`green-led ${value?.fallback ? "fallback-led" : ""}`} /> {isDemo ? "BUNDLED LOCAL DEMO" : "LOCAL AI • GEMMA 4"} {value?.fallback && <small>· deterministic fallback</small>}</span><button className="copy-action" disabled={!value || loading} onClick={() => { if (!value) return; void navigator.clipboard?.writeText(value.recommendation); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy action"}</button></div>
    <div className="privacy-note"><LockKeyhole size={11} /> No crowd imagery is sent to a commercial LLM API.</div>
  </section>;
}

function AutomationCard({ status, loading }: { status: AutomationStatus | null; loading: boolean }) {
  const dispatched = status?.status === "dispatched";
  const offline = status?.status === "offline";
  const label = dispatched ? "CONNECTED" : offline ? "OFFLINE" : status?.status === "not_triggered" || status?.status === "standby" ? "STANDBY" : "CHECKING";
  const dispatchedTime = status?.dispatchedAt
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(status.dispatchedAt))
    : null;
  return <section className={`panel automation-panel ${dispatched ? "dispatched" : ""} ${offline ? "offline" : ""}`} aria-live="polite">
    <div className="automation-head"><span className="automation-icon"><Workflow size={16} /></span><div><div className="eyebrow">WORKFLOW INTEGRATION</div><h2>n8n Workflow</h2></div><span className={`automation-status ${dispatched ? "connected" : offline ? "offline" : ""}`}><i />{loading ? "DISPATCHING" : label}</span></div>
    <div className="workflow-steps"><span className={dispatched ? "done" : "active"}><i>{dispatched ? <Check size={10} /> : "1"}</i>Risk detected</span><b aria-hidden="true" /><span className={dispatched ? "done" : ""}><i>{dispatched ? <Check size={10} /> : "2"}</i>Incident created</span><b aria-hidden="true" /><span className={dispatched ? "done" : ""}><i>{dispatched ? <Check size={10} /> : "3"}</i>Response team notified</span></div>
    <div className={`automation-message ${offline ? "offline-copy" : ""}`}>
      {loading ? <><span className="activity-spinner" /> Sending critical event to configured webhook…</> : dispatched ? <><CheckCircle2 size={13} /> Automation dispatched <time>• {dispatchedTime} IST</time></> : offline ? "Automation offline — core monitoring unaffected" : status?.status === "standby" ? "Webhook configured · reachability confirmed on dispatch." : "Dispatches only after a critical image analysis."}
    </div>
  </section>;
}

function ZoneTable({ result }: { result: CrowdAnalysisResult | null }) {
  const rows = zones.map(zone => {
    if (zone.id !== "A" || !result) return zone;
    const status = result.riskLevel === "CRITICAL" ? "CRITICAL" : result.occupancyPercent >= 55 || result.riskLevel === "HIGH" ? "WATCH" : "NORMAL";
    return { ...zone, occupancy: result.occupancyPercent, status };
  });
  return <section className="panel zone-panel"><div className="panel-heading compact"><div><div className="eyebrow">LIVE OCCUPANCY</div><h2>Zone Status</h2></div><button className="text-button">View all zones <ArrowUpRight size={13} /></button></div>
    <div className="zone-table"><div className="zone-row zone-header"><span>ZONE</span><span>CHECKPOINT</span><span>OCCUPANCY</span><span>STATUS</span></div>{rows.map(zone => <div className="zone-row" key={zone.id}><span className="zone-name"><span className={`zone-marker ${zone.status.toLowerCase()}`}>{zone.id}</span><b>{zone.name}</b></span><span className="zone-checkpoint">{zone.checkpoint}</span><span className="zone-occupancy"><span className="mini-bar"><i style={{ width: `${zone.occupancy}%`, background: zone.status === "CRITICAL" ? "#db7a69" : zone.status === "WATCH" ? "#e0aa52" : "#6dba8c" }} /></span><b>{zone.occupancy}%</b></span><span><span className={`status-pill ${zone.status.toLowerCase()}`}><i />{zone.status}</span></span></div>)}</div>
  </section>;
}

function CrowdChart({ result }: { result: CrowdAnalysisResult | null }) {
  const chartData = result ? [...crowdReadings.slice(0, -1), { time: "NOW", people: result.peopleCount }] : crowdReadings;
  return <section className="panel chart-panel"><div className="panel-heading compact"><div><div className="eyebrow">PEOPLE DETECTED <span className="heading-separator">·</span> LAST 12 MIN</div><h2>Crowd Count</h2></div><div className="chart-controls"><span className="chart-current"><i /> LIVE</span><button className="chart-range">12 min <ChevronDown size={12} /></button></div></div>
    <div className="chart-stat"><strong>{result?.peopleCount ?? mockSummary.peopleDetected}</strong><span>people in frame</span>{result && <span className="chart-change">{result.processingMs} ms processing</span>}</div>
    <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}><defs><linearGradient id="crowdFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#79c995" stopOpacity={0.18} /><stop offset="100%" stopColor="#79c995" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#272e33" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#78838a", fontSize: 10 }} axisLine={false} tickLine={false} interval={2} /><YAxis domain={[0, "dataMax + 5"]} tick={{ fill: "#78838a", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#171c1f", border: "1px solid #343b40", borderRadius: 6, color: "#e9eeeb", fontSize: 11 }} labelStyle={{ color: "#9aa5a1" }} /><Area type="monotone" dataKey="people" stroke="#77c894" strokeWidth={2} fill="url(#crowdFill)" activeDot={{ r: 4, fill: "#77c894", stroke: "#101412", strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
  </section>;
}

function IncidentTimeline({ result, time, demo, automation }: { result: CrowdAnalysisResult | null; time: string | null; demo: boolean; automation: AutomationStatus | null }) {
  const icons = { alert: AlertTriangle, action: ArrowDownRight, notice: Check };
  const liveEvents: Incident[] = result ? [
    {
      id: "analysis",
      title: demo ? "Local demo scenario loaded" : "Image analysis completed",
      detail: `Zone A · ${result.peopleCount} people · ${result.riskLevel} risk · ${result.processingMs} ms`,
      time: time ?? "NOW",
      kind: "notice",
    },
    ...(result.riskLevel === "CRITICAL" ? [{
      id: "critical",
      title: "Critical threshold reached",
      detail: demo ? "Local demo threshold · no webhook dispatched" : automation?.status === "dispatched" ? "Automation dispatched to n8n" : automation?.status === "offline" ? "Automation offline · core monitoring unaffected" : "Critical threshold reached · dispatch pending",
      time: time ?? "NOW",
      kind: "alert" as const,
    }] : []),
  ] : incidents;
  return <section className="panel incident-panel"><div className="panel-heading compact"><div><div className="eyebrow">EVENT LOG <span className="heading-separator">·</span> TODAY</div><h2>Incident Timeline</h2></div><button className="text-button">All incidents <ArrowUpRight size={13} /></button></div>
    <div className="timeline">{liveEvents.map((incident, index) => { const Icon = icons[incident.kind]; return <div className={`timeline-item ${incident.kind}`} key={incident.id}><div className="timeline-marker"><Icon size={12} /></div><div className="timeline-copy"><div className="timeline-title">{incident.title}{index === 0 && <span className="new-event">NEW</span>}</div><div className="timeline-detail">{incident.detail}</div></div><time>{incident.time}</time></div>; })}</div>
  </section>;
}

export default function Dashboard() {
  const [result, setResult] = useState<CrowdAnalysisResult | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recommendationResult, setRecommendationResult] = useState<RecommendationResult | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [demoVersion, setDemoVersion] = useState(0);
  const [analysisUpdatedAt, setAnalysisUpdatedAt] = useState<string | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;
    void getAutomationStatus().then(status => {
      if (active && requestVersion.current === 0) setAutomationStatus(status);
    }).catch(() => {
      if (active) setAutomationStatus({ status: "offline", dispatchedAt: null, detail: "Backend status unavailable" });
    });
    return () => { active = false; };
  }, []);

  const beginAnalysis = () => {
    const requestId = ++requestVersion.current;
    setResult(null);
    setRecommendationResult(null);
    setRecommendationLoading(false);
    setAutomationLoading(false);
    setAnalysisError(null);
    setAnalysisStatus("analyzing");
    return requestId;
  };

  const loadRecommendation = async (analysisResult: CrowdAnalysisResult, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setRecommendationLoading(true);
    try {
      const value = await recommendCrowd(analysisResult, "Gate A");
      if (requestId === requestVersion.current) {
        setRecommendationResult(value);
        if (analysisResult.riskLevel === "CRITICAL") {
          setAutomationLoading(true);
          try {
            const automation = await dispatchCriticalAutomation(analysisResult, "Gate A", value.recommendation);
            if (requestId === requestVersion.current) setAutomationStatus(automation);
          } catch {
            if (requestId === requestVersion.current) setAutomationStatus({ status: "offline", dispatchedAt: null, detail: "Webhook request failed" });
          } finally {
            if (requestId === requestVersion.current) setAutomationLoading(false);
          }
        }
      }
    } catch {
      if (requestId !== requestVersion.current) return;
      const recommendation = analysisResult.riskLevel === "CRITICAL"
        ? "Pause new entry into Gate A and reassess when its reported occupancy is below 70%."
        : analysisResult.riskLevel === "HIGH"
          ? "Meter new entry into Gate A while occupancy remains elevated. Reassess when reported occupancy falls below 70%."
          : analysisResult.riskLevel === "MODERATE"
            ? "Manage arrivals to Gate A at a controlled pace and monitor the reported risk score."
            : "Continue monitoring Gate A and maintain normal flow while the supplied metrics remain low.";
      setRecommendationResult({ recommendation, model: "rule-based-fallback", localInference: true, fallback: true });
      if (analysisResult.riskLevel === "CRITICAL") {
        setAutomationLoading(true);
        try {
          const automation = await dispatchCriticalAutomation(analysisResult, "Gate A", recommendation);
          if (requestId === requestVersion.current) setAutomationStatus(automation);
        } catch {
          if (requestId === requestVersion.current) setAutomationStatus({ status: "offline", dispatchedAt: null, detail: "Webhook request failed" });
        } finally {
          if (requestId === requestVersion.current) setAutomationLoading(false);
        }
      }
    } finally {
      if (requestId === requestVersion.current) setRecommendationLoading(false);
    }
  };

  const handleAnalysisResult = (analysisResult: CrowdAnalysisResult, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setResult(analysisResult);
    setAnalysisUpdatedAt(currentClockTime());
    setAnalysisStatus("complete");
    void loadRecommendation(analysisResult, requestId);
  };

  const handleAnalysisError = (message: string, requestId: number) => {
    if (requestId !== requestVersion.current) return;
    setResult(null);
    setRecommendationResult(null);
    setRecommendationLoading(false);
    setAnalysisError(message);
    setAnalysisStatus("error");
  };

  const handleLoadDemo = () => {
    const requestId = ++requestVersion.current;
    setDemoVersion(value => value + 1);
    setResult(demoCrowdAnalysis);
    setAnalysisUpdatedAt(currentClockTime());
    setAnalysisError(null);
    setAnalysisStatus("demo");
    setRecommendationResult(null);
    setRecommendationResult({
      recommendation: "Pause new entry into Gate A and reassess when its reported occupancy is below 70%.",
      model: "demo-scenario",
      localInference: true,
      fallback: false,
    });
    setRecommendationLoading(false);
  };

  const peopleCount = result?.peopleCount ?? mockSummary.peopleDetected;
  const riskLevel = result?.riskLevel ?? "ELEVATED";
  const riskTone = riskLevel === "CRITICAL" ? "coral" : riskLevel === "HIGH" || riskLevel === "MODERATE" ? "amber" : "";

  return <div className="app-shell"><Sidebar /><main className="main-area"><Topbar onLoadDemo={handleLoadDemo} /><div className="dashboard-content">
    <div className="page-intro"><div><div className="date-kicker">{analysisStatus === "demo" ? "LOCAL DEMO · SIMULATED VALUES" : result ? "IMAGE ANALYSIS · ZONE A" : "SAMPLE DASHBOARD · SIMULATED VALUES"}</div><h2>Good afternoon, Arjun <span>—</span></h2><p>{analysisStatus === "demo" ? "Bundled scenario for the demo; no camera or external service is used." : result ? "YOLO analyzed this image. Other workspace figures remain sample data." : "Sample workspace data. Upload a crowd image to run YOLO analysis."}</p></div><div className="intro-meta"><span className="event-live"><i /> {result ? analysisStatus === "demo" ? "DEMO MODE" : "IMAGE ANALYZED" : "SAMPLE WORKSPACE"}</span><span className="intro-divider" /><span><MapPin size={13} /> Kolkata, West Bengal</span></div></div>
    <section className="metrics-grid"><Metric title="People Detected" value={String(peopleCount)} icon={Users} note={analysisStatus === "demo" ? "Simulated · local demo" : result ? "Zone A · current image" : "Sample · 4 zones"} trend={result ? undefined : "12.4%"} /><Metric title="Active Zones" value={String(mockSummary.activeZones).padStart(2, "0")} icon={MapPin} note="Sample workspace value" /><Metric title="Risk Level" value={result ? result.riskLevel : mockSummary.riskLevel} icon={Gauge} tone={result ? riskTone : "amber"} note={analysisStatus === "demo" ? "Simulated · demo scenario" : result ? `Score ${result.riskScore} / 100` : "Sample workspace value"} /><Metric title="Active Incidents" value={String(mockSummary.activeIncidents).padStart(2, "0")} icon={AlertTriangle} tone="coral" note={analysisStatus === "demo" ? "Simulated · demo scenario" : result?.riskLevel === "CRITICAL" ? "Critical threshold reached" : result ? "No new incidents" : "Sample workspace value"} /></section>
    <section className="primary-grid"><VideoFeed result={result} status={analysisStatus} error={analysisError} demoVersion={demoVersion} onAnalysisStart={beginAnalysis} onAnalysisResult={handleAnalysisResult} onAnalysisError={handleAnalysisError} /><RiskAssessment result={result} demo={analysisStatus === "demo"} /></section>
    <section className="guidance-grid"><Recommendation value={recommendationResult} loading={recommendationLoading} /><AutomationCard status={automationStatus} loading={automationLoading} /></section>
    <section className="lower-grid"><ZoneTable result={result} /><div className="right-stack"><CrowdChart result={result} /><IncidentTimeline result={result} time={analysisUpdatedAt} demo={analysisStatus === "demo"} automation={automationStatus} /></div></section>
    <footer className="dashboard-footer"><span>SHAKTIFLOW <span>·</span> CROWD SAFETY INTELLIGENCE</span><span><LockKeyhole size={11} /> Images are processed locally and never stored</span><span>{analysisStatus === "complete" ? `LAST ANALYSIS ${result?.processingMs} MS` : analysisStatus === "demo" ? "LOCAL DEMO SCENARIO" : "SYSTEM READY"}</span></footer>
  </div></main></div>;
}

function currentClockTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}
