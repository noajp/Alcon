import { useState, useRef, useCallback, useEffect } from "react";

/*
  LICENSE: All ML components are Apache 2.0.
  RF-DETR / DETR / SlimSAM / Transformers.js = Apache 2.0
  Claude API = Commercial API
*/

const COLORS = {
  building: { stroke: "#3b82f6", bg: "rgba(59,130,246,0.15)", fill: "rgba(59,130,246,0.25)" },
  vehicle: { stroke: "#fbbf24", bg: "rgba(251,191,36,0.15)", fill: "rgba(251,191,36,0.25)" },
  person: { stroke: "#f472b6", bg: "rgba(244,114,182,0.15)", fill: "rgba(244,114,182,0.25)" },
  infrastructure: { stroke: "#10b981", bg: "rgba(16,185,129,0.15)", fill: "rgba(16,185,129,0.25)" },
  unknown: { stroke: "#a855f7", bg: "rgba(168,85,247,0.15)", fill: "rgba(168,85,247,0.25)" },
};

const VEHICLE_LABELS = new Set(["car","truck","bus","motorcycle","bicycle","train","boat"]);
const PERSON_LABELS = new Set(["person"]);

function classify(label) {
  if (VEHICLE_LABELS.has(label)) return "vehicle";
  if (PERSON_LABELS.has(label)) return "person";
  return "unknown";
}

let _detector = null;
let _detectorName = "";
let _samModel = null;
let _samProcessor = null;
let _samEmbeddings = null;
let _samImageId = null;

async function loadTransformers() {
  // Try multiple CDN sources in order — different artifacts environments allow different CDNs
  const sources = [
    "https://esm.sh/@huggingface/transformers@3.0.2",
    "https://cdn.jsdelivr.net/npm/@huggingface/[email protected]/+esm",
    "https://esm.sh/@huggingface/transformers@2.17.2",
    "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2",
  ];
  let lastErr;
  for (const src of sources) {
    try {
      return await import(/* @vite-ignore */ src);
    } catch (e) {
      lastErr = e;
      console.warn(`Failed to load from ${src}:`, e.message);
    }
  }
  throw new Error(`All CDN sources failed. Last error: ${lastErr?.message || lastErr}`);
}

async function getDetector(onStatus) {
  if (_detector) return { detector: _detector, modelName: _detectorName };
  const { pipeline } = await loadTransformers();
  try {
    onStatus?.("Loading RF-DETR (Apache 2.0)...");
    _detector = await pipeline("object-detection", "onnx-community/rfdetr_base-ONNX");
    _detectorName = "RF-DETR";
  } catch {
    onStatus?.("RF-DETR unavailable, loading DETR...");
    _detector = await pipeline("object-detection", "Xenova/detr-resnet-50");
    _detectorName = "DETR";
  }
  return { detector: _detector, modelName: _detectorName };
}

async function getSAM(onStatus) {
  if (_samModel && _samProcessor) return { model: _samModel, processor: _samProcessor };
  const { SamModel, AutoProcessor } = await loadTransformers();
  onStatus?.("Loading SlimSAM (Apache 2.0)...");
  _samModel = await SamModel.from_pretrained("Xenova/slimsam-77-uniform");
  _samProcessor = await AutoProcessor.from_pretrained("Xenova/slimsam-77-uniform");
  return { model: _samModel, processor: _samProcessor };
}

// Pre-compute SAM image embeddings once per image
async function computeSAMEmbeddings(imageDataUrl, onStatus) {
  if (_samImageId === imageDataUrl && _samEmbeddings) return _samEmbeddings;
  onStatus?.("Computing image embeddings...");
  const { RawImage } = await loadTransformers();
  const { model, processor } = await getSAM(onStatus);
  const rawImage = await RawImage.read(imageDataUrl);
  const inputs = await processor(rawImage);
  _samEmbeddings = {
    image_embeddings: await model.get_image_embeddings(inputs),
    inputs,
    rawImage,
  };
  _samImageId = imageDataUrl;
  return _samEmbeddings;
}

// Run SAM segmentation given click point (in 0-100% coords)
async function segmentAtPoint(imageDataUrl, xPct, yPct, onStatus) {
  const emb = await computeSAMEmbeddings(imageDataUrl, onStatus);
  const { model, processor } = await getSAM(onStatus);
  const { rawImage, image_embeddings } = emb;
  // Convert percentage to pixel coords
  const px = (xPct / 100) * rawImage.width;
  const py = (yPct / 100) * rawImage.height;
  const input_points = [[[[px, py]]]];
  const input_labels = [[[1]]]; // 1 = foreground point

  const outputs = await model({
    ...image_embeddings,
    input_points,
    input_labels,
  });

  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    emb.inputs.original_sizes,
    emb.inputs.reshaped_input_sizes
  );

  // Pick best mask (highest IoU score)
  const scores = outputs.iou_scores.data;
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;

  // Extract mask -> polygon (bounding box approach for simplicity)
  const mask = masks[0][0]; // shape: [3, H, W] -> we want mask 0 (best is bestIdx)
  const maskTensor = mask;
  const H = maskTensor.dims[1];
  const W = maskTensor.dims[2];
  const data = maskTensor.data;
  const offset = bestIdx * H * W;

  // Find bounding box of mask
  let minX = W, maxX = 0, minY = H, maxY = 0;
  let cxSum = 0, cySum = 0, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[offset + y * W + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cxSum += x;
        cySum += y;
        count++;
      }
    }
  }

  if (count === 0) return null;

  // Trace contour using marching squares simplified — sample boundary points
  const polygon = [];
  const step = Math.max(1, Math.floor(Math.min(maxX - minX, maxY - minY) / 30));
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const here = data[offset + y * W + x];
      if (!here) continue;
      // Boundary if any neighbor is empty
      const isBoundary =
        !data[offset + Math.max(0, y - step) * W + x] ||
        !data[offset + Math.min(H - 1, y + step) * W + x] ||
        !data[offset + y * W + Math.max(0, x - step)] ||
        !data[offset + y * W + Math.min(W - 1, x + step)];
      if (isBoundary) {
        polygon.push([(x / W) * 100, (y / H) * 100]);
      }
    }
  }

  // Sort polygon points by angle from center for proper ordering
  const cx = cxSum / count;
  const cy = cySum / count;
  polygon.sort((a, b) => {
    const angA = Math.atan2(a[1] - (cy / H) * 100, a[0] - (cx / W) * 100);
    const angB = Math.atan2(b[1] - (cy / H) * 100, b[0] - (cx / W) * 100);
    return angA - angB;
  });

  return {
    center: [(cx / W) * 100, (cy / H) * 100],
    bbox: [(minX / W) * 100, (minY / H) * 100, (maxX / W) * 100, (maxY / H) * 100],
    polygon,
    score: scores[bestIdx],
  };
}

async function detectObjects(imageEl, onStatus) {
  const { detector, modelName } = await getDetector(onStatus);
  const canvas = document.createElement("canvas");
  canvas.width = imageEl.naturalWidth;
  canvas.height = imageEl.naturalHeight;
  canvas.getContext("2d").drawImage(imageEl, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const results = await detector(dataUrl, { threshold: 0.4, percentage: true });
  return {
    dets: results.map((r, i) => ({
      id: `${classify(r.label)[0]}${i}`,
      type: classify(r.label),
      subtype: r.label,
      center: [((r.box.xmin + r.box.xmax) / 2) * 100, ((r.box.ymin + r.box.ymax) / 2) * 100],
      bbox: [r.box.xmin * 100, r.box.ymin * 100, r.box.xmax * 100, r.box.ymax * 100],
      confidence: r.score,
      source: modelName,
    })),
    modelName,
  };
}

const CLAUDE_PROMPT = `You detect buildings/structures in aerial imagery.
Return ONLY a JSON array: [{"id":"b1","type":"building","cx":50.0,"cy":30.0,"conf":0.9}]
cx/cy = percentages 0-100. Detect buildings, tanks, silos, towers. NOT vehicles/people/terrain.`;

function extractJSON(text) {
  for (const fn of [
    () => JSON.parse(text.trim()),
    () => JSON.parse(text.replace(/```json\s*/gi,"").replace(/```\s*/gi,"").trim()),
    () => JSON.parse(text.match(/\[[\s\S]*\]/)?.[0]),
    () => { const items=[]; for(const m of text.matchAll(/\{[^{}]*"cx"\s*:\s*[\d.]+[^{}]*\}/g)) try{items.push(JSON.parse(m[0]))}catch{} if(items.length)return items; throw 0; },
  ]) try { const r = fn(); if (r) return r; } catch {}
  throw new Error("JSON parse failed");
}

async function claudeDetect(imageDataUrl) {
  const base64 = imageDataUrl.split(",")[1];
  const mt = imageDataUrl.split(";")[0].split(":")[1] || "image/jpeg";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4000, system: CLAUDE_PROMPT,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mt, data: base64 } },
        { type: "text", text: "Detect structures. JSON array only." },
      ]}],
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return extractJSON(text).map(d => ({
    id: d.id || `b${Math.random().toString(36).slice(2,6)}`,
    type: d.type || "building",
    center: [d.cx ?? 50, d.cy ?? 50],
    confidence: d.conf ?? 0.5,
    source: "Claude",
  }));
}

// SVG polygon overlay for segmented regions
function PolygonOverlay({ dets, selId, style }) {
  const { strokeColor, strokeWidth, fillOpacity, showFill } = style;
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 5 }}
      viewBox="0 0 100 100" preserveAspectRatio="none">
      {dets.filter(d => d.polygon && d.polygon.length > 2).map(d => {
        const sel = selId === d.id;
        return (
          <polygon key={d.id}
            points={d.polygon.map(([x,y]) => `${x},${y}`).join(" ")}
            fill={showFill ? strokeColor : "none"}
            fillOpacity={showFill ? (sel ? fillOpacity * 2 : fillOpacity) : 0}
            stroke={strokeColor} strokeWidth={sel ? strokeWidth * 1.5 : strokeWidth}
            vectorEffect="non-scaling-stroke"/>
        );
      })}
    </svg>
  );
}

function Pin({ det, selected, onMouseDown, onClick }) {
  const c = COLORS[det.type] || COLORS.unknown;
  return (
    <div onMouseDown={onMouseDown} onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onClick(e); }}
      style={{ position:"absolute", left:`${det.center[0]}%`, top:`${det.center[1]}%`,
        transform:"translate(-50%,-50%)", cursor:"grab", zIndex: selected?20:10,
        width:22, height:22, display:"flex", alignItems:"center", justifyContent:"center" }}>
      {selected && <div style={{ position:"absolute", width:18, height:18, borderRadius:"50%",
        border:`1.5px solid ${c.stroke}`, opacity:0.3 }}/>}
      <div style={{ width:10, height:10, borderRadius:"50%", border:`2px solid ${c.stroke}`,
        background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center",
        opacity: selected?1:0.8 }}>
        <div style={{ width:3, height:3, borderRadius:"50%", background:c.stroke }}/>
      </div>
      {det.userLabel && <div style={{ position:"absolute", left:15, top:"50%", transform:"translateY(-50%)",
        fontSize:9, color:"#94a3b8", whiteSpace:"nowrap", background:"rgba(8,12,20,0.85)",
        padding:"1px 5px", borderRadius:2, pointerEvents:"none" }}>{det.userLabel}</div>}
    </div>
  );
}

function ContextMenu({ x, y, det, onClose, onSave, onDelete }) {
  const [tag, setTag] = useState(det.userLabel || "");
  const [type, setType] = useState(det.type || "unknown");
  const [notes, setNotes] = useState(det.notes || "");
  const [pri, setPri] = useState(det.priority || "normal");
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  const c = COLORS[type] || COLORS.unknown;
  const inp = { width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:3, padding:"5px 7px", fontSize:11, color:"#e2e8f0", fontFamily:"inherit",
    outline:"none", boxSizing:"border-box" };
  return (
    <div ref={ref} style={{ position:"fixed", left:Math.min(x,window.innerWidth-260),
      top:Math.min(y,window.innerHeight-360), zIndex:9999, background:"rgba(8,12,20,0.97)",
      border:"1px solid rgba(255,255,255,0.08)", borderRadius:7, padding:12, width:236,
      backdropFilter:"blur(16px)", boxShadow:"0 12px 40px rgba(0,0,0,0.6)",
      fontFamily:"'SF Mono','Fira Code',monospace", color:"#cbd5e1" }}>
      <div style={{ fontSize:9, color:"#475569", marginBottom:8 }}>
        <span style={{ color:c.stroke }}>{type}</span> #{det.id}
        {det.subtype && ` · ${det.subtype}`} · {Math.round((det.confidence||0)*100)}%
        {det.source && <span style={{opacity:0.5}}> · {det.source}</span>}
      </div>
      <div style={{fontSize:8,color:"#475569",marginBottom:2}}>TYPE</div>
      <div style={{display:"flex",gap:3,marginBottom:8,flexWrap:"wrap"}}>
        {Object.keys(COLORS).map(t=>{
          const tc = COLORS[t];
          return (
            <button key={t} onClick={()=>setType(t)} style={{ padding:"2px 6px", fontSize:8, borderRadius:3,
              fontFamily:"inherit", border:type===t?`1px solid ${tc.stroke}`:"1px solid rgba(255,255,255,0.06)",
              background:type===t?tc.bg:"transparent", color:type===t?tc.stroke:"#475569",
              cursor:"pointer" }}>{t}</button>
          );
        })}
      </div>
      <div style={{fontSize:8,color:"#475569",marginBottom:2}}>TAG</div>
      <input value={tag} onChange={e=>setTag(e.target.value)} placeholder="Name..." autoFocus
        style={{...inp, marginBottom:8}}/>
      <div style={{fontSize:8,color:"#475569",marginBottom:2}}>PRIORITY</div>
      <div style={{display:"flex",gap:3,marginBottom:8}}>
        {["low","normal","high","critical"].map(p=>(
          <button key={p} onClick={()=>setPri(p)} style={{ padding:"2px 6px", fontSize:8, borderRadius:3,
            fontFamily:"inherit", border:pri===p?`1px solid ${c.stroke}`:"1px solid rgba(255,255,255,0.06)",
            background:pri===p?c.bg:"transparent", color:pri===p?c.stroke:"#475569",
            cursor:"pointer", textTransform:"uppercase" }}>{p}</button>
        ))}
      </div>
      <div style={{fontSize:8,color:"#475569",marginBottom:2}}>NOTES</div>
      <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes..."
        rows={2} style={{...inp, resize:"vertical"}}/>
      <div style={{display:"flex",gap:5,marginTop:8}}>
        <button onClick={()=>{onSave({...det,type,userLabel:tag,notes,priority:pri});onClose();}}
          style={{flex:1,padding:"4px",fontSize:9,fontWeight:600,borderRadius:3,border:"none",
            background:c.stroke,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>SAVE</button>
        <button onClick={()=>{onDelete(det.id);onClose();}}
          style={{padding:"4px 8px",fontSize:9,borderRadius:3,fontFamily:"inherit",
            border:"1px solid rgba(248,113,113,0.2)",background:"rgba(248,113,113,0.08)",
            color:"#f87171",cursor:"pointer"}}>DEL</button>
        <button onClick={onClose} style={{padding:"4px 8px",fontSize:9,borderRadius:3,
          border:"1px solid rgba(255,255,255,0.06)",background:"transparent",
          color:"#475569",cursor:"pointer",fontFamily:"inherit"}}>✕</button>
      </div>
    </div>
  );
}

export default function App() {
  const [image, setImage] = useState(null);
  const [imageEl, setImageEl] = useState(null);
  const [dets, setDets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [selId, setSelId] = useState(null);
  const [drag, setDrag] = useState(null);
  const [cvModel, setCvModel] = useState("");
  const [tool, setTool] = useState("lasso"); // "lasso" | "segment" | "pin" | "drag"
  const [lassoPoints, setLassoPoints] = useState([]); // active lasso polygon being drawn
  const [showSettings, setShowSettings] = useState(false);
  const [overlayStyle, setOverlayStyle] = useState({
    strokeColor: "#ffffff",
    strokeWidth: 2.5,
    fillOpacity: 0.1,
    showFill: true,
  });
  const [samBusy, setSamBusy] = useState(false);
  const [samUnavailable, setSamUnavailable] = useState(false);
  const containerRef = useRef(null);

  const onUpload = useCallback((e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setDets([]); setError(null); setCtxMenu(null); setSelId(null); setStage("");
    _samEmbeddings = null; _samImageId = null;
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => { setImage(ev.target.result); setImageEl(img); };
      img.src = ev.target.result;
    };
    r.readAsDataURL(f);
  }, []);

  const detect = useCallback(async () => {
    if (!image || !imageEl) return;
    setLoading(true); setError(null); setDets([]);
    let all = [];
    try {
      const { dets: cvDets, modelName } = await detectObjects(imageEl, setStage);
      setCvModel(modelName); all = cvDets; setDets([...all]);
      const c = all.reduce((a,d) => { a[d.type]=(a[d.type]||0)+1; return a; }, {});
      setStage(`${modelName}: ${Object.entries(c).map(([k,v])=>`${v} ${k}`).join(", ")}`);
    } catch (err) { console.warn("CV:", err); setStage("CV unavailable"); }
    try {
      setStage(p => (all.length ? p + " · " : "") + "Buildings...");
      const blds = await claudeDetect(image);
      all = [...all, ...blds]; setDets([...all]);
      setStage(`Done: ${all.length} objects`);
    } catch (err) {
      setError("Buildings: " + err.message);
    }
    setLoading(false);
  }, [image, imageEl]);

  // SAM segment on click
  const segmentClick = useCallback(async (e) => {
    if (samBusy || !image) return;
    const el = containerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;

    setSamBusy(true);
    setStage("Segmenting...");
    try {
      const result = await segmentAtPoint(image, xPct, yPct, setStage);
      if (result) {
        const newDet = {
          id: `s${Date.now()}`,
          type: "unknown",
          center: result.center,
          bbox: result.bbox,
          polygon: result.polygon,
          confidence: result.score,
          source: "SlimSAM",
          manual: true,
        };
        setDets(p => [...p, newDet]);
        setSelId(newDet.id);
        setStage(`Segmented (IoU ${Math.round(result.score * 100)}%)`);
      } else {
        setStage("No segment found");
      }
    } catch (err) {
      console.error("SAM:", err);
      setError("SAM unavailable in this environment. Use LASSO or PIN tools instead.");
      setSamUnavailable(true);
      setTool("lasso"); // fall back to lasso
    }
    setSamBusy(false);
  }, [image, samBusy]);

  const dragStart = useCallback((det, e) => {
    e.preventDefault(); e.stopPropagation();
    setDrag({ id: det.id, sx: e.clientX, sy: e.clientY, oc: [...det.center] });
  }, []);

  const onMove = useCallback(e => {
    if (!drag || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.sx) / r.width) * 100;
    const dy = ((e.clientY - drag.sy) / r.height) * 100;
    setDets(p => p.map(d => d.id === drag.id
      ? { ...d, center: [Math.max(0,Math.min(100,drag.oc[0]+dx)), Math.max(0,Math.min(100,drag.oc[1]+dy))] } : d));
  }, [drag]);

  const onUp = useCallback(() => setDrag(null), []);
  useEffect(() => {
    if (!drag) return;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, onMove, onUp]);

  const pinClick = useCallback((det, e) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, det }); setSelId(det.id);
  }, []);

  // Container click handler — routes to the active tool
  const containerClick = useCallback(e => {
    if (e.target !== e.currentTarget && e.target.tagName !== "IMG" && e.target.tagName !== "svg" && e.target.tagName !== "polygon") return;
    const el = containerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;

    if (tool === "lasso") {
      setLassoPoints(p => [...p, [xPct, yPct]]);
    } else if (tool === "segment") {
      segmentClick(e);
    } else if (tool === "pin") {
      setDets(p => [...p, { id:`m${Date.now()}`, type:"unknown",
        center:[xPct, yPct], confidence:1, manual:true, source:"Manual" }]);
    }
  }, [tool, segmentClick]);

  // Finish drawing the current lasso → create detection
  const finishLasso = useCallback(() => {
    if (lassoPoints.length < 3) {
      setLassoPoints([]);
      return;
    }
    // Compute centroid
    let cx = 0, cy = 0;
    for (const [x, y] of lassoPoints) { cx += x; cy += y; }
    cx /= lassoPoints.length;
    cy /= lassoPoints.length;
    // Compute bbox
    const xs = lassoPoints.map(p => p[0]);
    const ys = lassoPoints.map(p => p[1]);
    const newDet = {
      id: `l${Date.now()}`,
      type: "unknown",
      center: [cx, cy],
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      polygon: [...lassoPoints],
      confidence: 1,
      manual: true,
      source: "Lasso",
    };
    setDets(p => [...p, newDet]);
    setSelId(newDet.id);
    setLassoPoints([]);
    // Open context menu at the centroid for immediate tagging
    const el = containerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setCtxMenu({
        x: r.left + (cx / 100) * r.width,
        y: r.top + (cy / 100) * r.height,
        det: newDet,
      });
    }
  }, [lassoPoints]);

  // Cancel lasso
  const cancelLasso = useCallback(() => setLassoPoints([]), []);

  // Keyboard shortcuts: Enter = finish lasso, Esc = cancel
  useEffect(() => {
    if (tool !== "lasso") return;
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); finishLasso(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelLasso(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, finishLasso, cancelLasso]);

  const counts = dets.reduce((a,d) => { a[d.type]=(a[d.type]||0)+1; return a; }, {});

  return (
    <div style={{ minHeight:"100vh", background:"#080c14", color:"#94a3b8",
      fontFamily:"'SF Mono','Fira Code',monospace", fontSize:10 }}>

      <div style={{ padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.04)",
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:5, height:5, borderRadius:"50%",
            background: samBusy ? "#fbbf24" : dets.length ? "#10b981" : "#334155" }}/>
          <span style={{ fontSize:10, fontWeight:700, letterSpacing:1 }}>ANNOTATOR</span>
          <span style={{ fontSize:7, color:"#a855f7", padding:"0 4px",
            border:"1px solid rgba(168,85,247,0.25)", borderRadius:2 }}>SAM</span>
          <span style={{ fontSize:6, color:"#334155", padding:"0 3px",
            border:"1px solid rgba(255,255,255,0.06)", borderRadius:2 }}>Apache 2.0</span>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {stage && <span style={{ fontSize:8, color:"#475569" }}>{stage}</span>}
          {Object.entries(counts).map(([t,n]) => (
            <span key={t} style={{ fontSize:8, color:(COLORS[t]||COLORS.unknown).stroke }}>{n} {t}</span>
          ))}
        </div>
      </div>

      <div style={{ padding:12 }}>
        {!image ? (
          <label style={{ display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", height:300, border:"1px dashed rgba(255,255,255,0.1)",
            borderRadius:6, cursor:"pointer" }}>
            <input type="file" accept="image/*" onChange={onUpload} style={{ display:"none" }}/>
            <div style={{ fontSize:24, opacity:0.2, marginBottom:6 }}>📡</div>
            <div style={{ fontSize:10, color:"#64748b", letterSpacing:0.8 }}>UPLOAD IMAGE</div>
            <div style={{ fontSize:8, color:"#334155", marginTop:4 }}>
              Click to segment with SlimSAM · Manual annotation
            </div>
          </label>
        ) : (
          <>
            <div style={{ display:"flex", gap:5, marginBottom:10, alignItems:"center", flexWrap:"wrap" }}>
              {/* Tool switcher */}
              <div style={{ display:"flex", gap:0, border:"1px solid rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}>
                {[
                  { id:"lasso", label:"◇ LASSO", color:"#60a5fa" },
                  ...(samUnavailable ? [] : [{ id:"segment", label:"✂ SAM", color:"#a855f7" }]),
                  { id:"pin", label:"+ PIN", color:"#10b981" },
                  { id:"drag", label:"✋ MOVE", color:"#fbbf24" },
                ].map((t, i, arr) => (
                  <button key={t.id} onClick={()=>{setTool(t.id); setLassoPoints([]);}} style={{
                    padding:"5px 10px", fontSize:9, fontWeight:600, border:"none",
                    fontFamily:"inherit",
                    background: tool===t.id ? `${t.color}33` : "transparent",
                    color: tool===t.id ? t.color : "#475569",
                    cursor:"pointer",
                    borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}>{t.label}</button>
                ))}
              </div>

              <label style={{ padding:"5px 10px", fontSize:9, borderRadius:3,
                border:"1px solid rgba(255,255,255,0.06)", color:"#475569",
                cursor:"pointer", fontFamily:"inherit" }}>
                <input type="file" accept="image/*" onChange={onUpload} style={{ display:"none" }}/>NEW
              </label>

              <button onClick={() => setShowSettings(s => !s)} style={{
                padding:"5px 10px", fontSize:9, borderRadius:3,
                border: showSettings ? "1px solid rgba(168,85,247,0.5)" : "1px solid rgba(255,255,255,0.06)",
                background: showSettings ? "rgba(168,85,247,0.15)" : "transparent",
                color: showSettings ? "#a855f7" : "#475569",
                cursor:"pointer", fontFamily:"inherit" }}>⚙ STYLE</button>

              <span style={{ fontSize:7, color:"#334155" }}>
                {tool === "lasso" && (lassoPoints.length === 0
                  ? "click to start drawing a polygon"
                  : `${lassoPoints.length} pts · Enter=finish · Esc=cancel`)}
                {tool === "segment" && "click an object to auto-segment with SAM"}
                {tool === "pin" && "click to add a pin"}
                {tool === "drag" && "drag pins to reposition"}
              </span>

              {tool === "lasso" && lassoPoints.length >= 3 && (
                <>
                  <button onClick={finishLasso} style={{
                    padding:"4px 10px", fontSize:9, fontWeight:600, borderRadius:3, border:"none",
                    fontFamily:"inherit", background:"#16a34a", color:"#fff", cursor:"pointer" }}>
                    ✓ FINISH ({lassoPoints.length})
                  </button>
                  <button onClick={cancelLasso} style={{
                    padding:"4px 10px", fontSize:9, borderRadius:3,
                    border:"1px solid rgba(248,113,113,0.2)", background:"rgba(248,113,113,0.08)",
                    color:"#f87171", cursor:"pointer", fontFamily:"inherit" }}>
                    ✕ CANCEL
                  </button>
                </>
              )}
            </div>

            {/* Settings panel */}
            {showSettings && (
              <div style={{ padding:"10px 12px", marginBottom:10,
                background:"rgba(255,255,255,0.02)",
                border:"1px solid rgba(255,255,255,0.06)", borderRadius:4,
                display:"flex", flexWrap:"wrap", gap:14, alignItems:"center" }}>
                <div style={{ fontSize:8, fontWeight:700, letterSpacing:1, color:"#a855f7" }}>OVERLAY STYLE</div>

                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:8, color:"#475569" }}>COLOR</span>
                  <div style={{ display:"flex", gap:3 }}>
                    {[
                      { v:"#ffffff", label:"白" },
                      { v:"#ef4444", label:"赤" },
                      { v:"#fbbf24", label:"黄" },
                      { v:"#10b981", label:"緑" },
                      { v:"#3b82f6", label:"青" },
                      { v:"#a855f7", label:"紫" },
                      { v:"#f472b6", label:"桃" },
                      { v:"#000000", label:"黒" },
                    ].map(c => (
                      <button key={c.v} onClick={()=>setOverlayStyle(s => ({...s, strokeColor: c.v}))}
                        title={c.label}
                        style={{ width:18, height:18, borderRadius:3, padding:0, cursor:"pointer",
                          background:c.v,
                          border: overlayStyle.strokeColor === c.v ? "2px solid #a855f7" : "1px solid rgba(255,255,255,0.15)",
                        }}/>
                    ))}
                  </div>
                  <input type="color" value={overlayStyle.strokeColor}
                    onChange={e=>setOverlayStyle(s => ({...s, strokeColor: e.target.value}))}
                    style={{ width:24, height:18, padding:0, border:"1px solid rgba(255,255,255,0.1)",
                      borderRadius:3, background:"transparent", cursor:"pointer" }}/>
                </div>

                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:8, color:"#475569" }}>WIDTH</span>
                  <input type="range" min="0.5" max="6" step="0.5" value={overlayStyle.strokeWidth}
                    onChange={e=>setOverlayStyle(s => ({...s, strokeWidth: parseFloat(e.target.value)}))}
                    style={{ width:80 }}/>
                  <span style={{ fontSize:8, color:"#94a3b8", minWidth:18 }}>{overlayStyle.strokeWidth}</span>
                </div>

                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer" }}>
                    <input type="checkbox" checked={overlayStyle.showFill}
                      onChange={e=>setOverlayStyle(s => ({...s, showFill: e.target.checked}))}
                      style={{ cursor:"pointer" }}/>
                    <span style={{ fontSize:8, color:"#475569" }}>FILL</span>
                  </label>
                  {overlayStyle.showFill && (
                    <>
                      <input type="range" min="0" max="0.5" step="0.05" value={overlayStyle.fillOpacity}
                        onChange={e=>setOverlayStyle(s => ({...s, fillOpacity: parseFloat(e.target.value)}))}
                        style={{ width:60 }}/>
                      <span style={{ fontSize:8, color:"#94a3b8", minWidth:24 }}>
                        {Math.round(overlayStyle.fillOpacity * 100)}%
                      </span>
                    </>
                  )}
                </div>

                <button onClick={()=>setOverlayStyle({ strokeColor:"#ffffff", strokeWidth:2.5, fillOpacity:0.1, showFill:true })}
                  style={{ padding:"3px 8px", fontSize:8, borderRadius:3,
                    border:"1px solid rgba(255,255,255,0.06)", background:"transparent",
                    color:"#475569", cursor:"pointer", fontFamily:"inherit" }}>
                  RESET
                </button>
              </div>
            )}

            {error && <div style={{ padding:"4px 10px", marginBottom:8, fontSize:9, color:"#f87171",
              background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:3 }}>{error}</div>}

            <div ref={containerRef} onClick={containerClick}
              style={{ position:"relative", borderRadius:4, overflow:"hidden",
                border:"1px solid rgba(255,255,255,0.04)", background:"#000",
                cursor: samBusy ? "wait" : drag ? "grabbing" : tool === "lasso" ? "crosshair" : tool === "segment" ? "crosshair" : tool === "pin" ? "copy" : "default",
                userSelect:"none" }}>
              <img src={image} alt="" draggable={false}
                style={{ width:"100%", display:"block", pointerEvents:"none" }}/>

              <PolygonOverlay dets={dets} selId={selId} style={overlayStyle}/>

              {/* Lasso in-progress preview */}
              {tool === "lasso" && lassoPoints.length > 0 && (
                <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                  pointerEvents: "none", zIndex: 6 }}
                  viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Closing line preview if 3+ points */}
                  {lassoPoints.length >= 3 && (
                    <polygon
                      points={lassoPoints.map(([x,y]) => `${x},${y}`).join(" ")}
                      fill={overlayStyle.showFill ? overlayStyle.strokeColor : "none"}
                      fillOpacity={overlayStyle.showFill ? overlayStyle.fillOpacity : 0}
                      stroke={overlayStyle.strokeColor}
                      strokeWidth={overlayStyle.strokeWidth}
                      strokeDasharray="6 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* Lines between points */}
                  {lassoPoints.length >= 2 && lassoPoints.length < 3 && (
                    <polyline
                      points={lassoPoints.map(([x,y]) => `${x},${y}`).join(" ")}
                      fill="none"
                      stroke={overlayStyle.strokeColor}
                      strokeWidth={overlayStyle.strokeWidth}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* Vertices */}
                  {lassoPoints.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={0.6}
                      fill={overlayStyle.strokeColor} stroke="#000" strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"/>
                  ))}
                </svg>
              )}

              {dets.map(d => (
                <Pin key={d.id} det={d} selected={selId===d.id}
                  onMouseDown={e => tool === "drag" ? dragStart(d,e) : null}
                  onClick={e => pinClick(d,e)}/>
              ))}
            </div>

            {dets.length > 0 && (
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:8, fontWeight:700, letterSpacing:1, color:"#334155", marginBottom:4 }}>
                  OBJECTS ({dets.length})
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {dets.map(d => {
                    const col = COLORS[d.type] || COLORS.unknown;
                    const sel = selId===d.id;
                    return (
                      <div key={d.id} onClick={()=>setSelId(d.id===selId?null:d.id)}
                        style={{ padding:"1px 6px", fontSize:8, borderRadius:2,
                          border:`1px solid ${sel?col.stroke:"rgba(255,255,255,0.04)"}`,
                          background:sel?col.bg:"transparent", color:sel?col.stroke:"#475569",
                          cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                        <span style={{ width:4, height:4, borderRadius:"50%", background:col.stroke, opacity:0.6 }}/>
                        {d.userLabel || `${d.type}#${d.id}`}
                        {d.polygon && <span style={{ opacity:0.4 }}>◇</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} det={ctxMenu.det}
        onClose={()=>{setCtxMenu(null);setSelId(null);}}
        onSave={u=>setDets(p=>p.map(d=>d.id===u.id?u:d))}
        onDelete={id=>{setDets(p=>p.filter(d=>d.id!==id));setSelId(null);}}/>}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
