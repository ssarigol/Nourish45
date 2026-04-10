import { useState, useEffect, useRef } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const DAILY_GOALS = { kcal: 1800, protein: 115, carbs: 180, fat: 60 };
const WEIGHT_KG = 53;

const ACTIVITY_LIST = [
  { label: "Cleaning kitchen",            mins: 30, metFactor: 3.5 },
  { label: "Vacuuming floors",            mins: 20, metFactor: 3.8 },
  { label: "Grocery shopping (walking)", mins: 40, metFactor: 2.5 },
  { label: "Climbing stairs",            mins: 15, metFactor: 8.0 },
  { label: "Brisk walk (15 min)",        mins: 15, metFactor: 4.5 },
  { label: "Brisk walk (30 min)",        mins: 30, metFactor: 4.5 },
  { label: "Yoga / stretching",          mins: 30, metFactor: 2.5 },
  { label: "Gym session",                mins: 60, metFactor: 6.0 },
  { label: "Cycling (moderate)",         mins: 30, metFactor: 6.0 },
  { label: "Swimming",                   mins: 30, metFactor: 6.0 },
];

const TABS = ["Dashboard", "Log Food", "Log Activity", "Ask Coach"];

const palette = {
  purple: "#7F77DD", teal: "#1D9E75",
  coral: "#D85A30", amber: "#BA7517", gray: "#888780",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcBurn(metFactor, mins) {
  return Math.round(metFactor * WEIGHT_KG * (mins / 60));
}

// Converts an image File object into a base64 string the Claude API can read.
// Think of base64 as a way of turning binary image data into plain text.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // strip the "data:image/jpeg;base64," prefix
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── API calls ───────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userContent) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

// Sends a food photo to Claude and asks it to estimate the nutrition.
// We pass the image as base64 alongside a text instruction.
async function analyzePhotoFood(base64Image, mimeType) {
  const sys = `You are a nutrition expert for women over 45. Analyse the food in the image and return ONLY a JSON object with: name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, suggested_serving_g. No markdown, no explanation.`;
  const content = [
    { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
    { type: "text", text: "Estimate the nutrition for the food shown. Return JSON only." },
  ];
  const raw = await callClaude(sys, content);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

// Text-based food analysis (kept as a fallback if user prefers typing)
async function analyzeTextFood(description) {
  const sys = `You are a nutrition expert for women over 45. Given a food description, return ONLY a JSON object with: name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, suggested_serving_g. No markdown.`;
  const raw = await callClaude(sys, `Analyse: ${description}`);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

// Looks up a barcode number in the Open Food Facts database.
// This is a free, global product database with 3M+ items — great for travellers.
async function lookupBarcode(barcodeNumber) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcodeNumber}.json`
    );
    const data = await res.json();
    if (data.status !== 1) return null; // product not found

    const n = data.product?.nutriments;
    const name = data.product?.product_name || data.product?.product_name_en || "Unknown product";
    if (!n) return null;

    return {
      name,
      kcal_per_100g:    Math.round(n["energy-kcal_100g"] || n["energy_100g"] / 4.184 || 0),
      protein_per_100g: Math.round(n.proteins_100g || 0),
      carbs_per_100g:   Math.round(n.carbohydrates_100g || 0),
      fat_per_100g:     Math.round(n.fat_per_100g || n.fat_100g || 0),
      suggested_serving_g: Math.round(data.product?.serving_quantity || 100),
    };
  } catch { return null; }
}

async function getCoachReply(question, eaten, burned, remaining) {
  const sys = `You are a warm, knowledgeable wellness coach for women over 45. Be concise, practical, encouraging. Max 120 words.`;
  const ctx = `Today: eaten ${eaten.kcal} kcal, ${eaten.protein}g protein. Burned: ${burned} kcal. Remaining: ${remaining.kcal} kcal, ${remaining.protein}g protein.`;
  return await callClaude(sys, `${ctx}\n\nQuestion: ${question}`);
}

// ─── Small UI components ──────────────────────────────────────────────────────

function Ring({ pct, color, size = 80, stroke = 8, label, value }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 1) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e0dfd8" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2+2} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 13, fontWeight: 500, fill: "#2c2c2a" }}>
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div style={{ fontSize: 12, color: "#888780", textAlign: "center" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#b4b2a9" }}>{value}</div>
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "#ffffff", border: "0.5px solid #d3d1c7",
      borderRadius: 12, padding: "1rem 1.25rem", ...style
    }}>{children}</div>
  );
}

function Badge({ children, color }) {
  const map = {
    teal:   { bg: "#E1F5EE", text: "#0F6E56" },
    coral:  { bg: "#FAECE7", text: "#993C1D" },
    amber:  { bg: "#FAEEDA", text: "#854F0B" },
    purple: { bg: "#EEEDFE", text: "#3C3489" },
    gray:   { bg: "#F1EFE8", text: "#5F5E5A" },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{ background: c.bg, color: c.text, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20 }}>
      {children}
    </span>
  );
}

// ─── Barcode scanner component ────────────────────────────────────────────────
// This component opens the rear camera and uses the ZXing library to
// continuously scan the video stream for a barcode pattern.
// When it finds one, it calls onDetected(barcodeNumber) and stops.

function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);

  useEffect(() => {
    let stopped = false;

    // ZXing is loaded as a global via a <script> tag in index.html.
    // We wait a tick to make sure the video element is mounted in the DOM.
    const start = async () => {
      const ZXing = window.ZXing;
      if (!ZXing) { alert("Barcode library not loaded. Please refresh."); return; }

      const codeReader = new ZXing.BrowserMultiFormatReader();
      readerRef.current = codeReader;

      try {
        // Ask for rear camera specifically (facingMode: environment)
        await codeReader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result, err) => {
            if (stopped) return;
            if (result) {
              stopped = true;
              codeReader.reset();
              onDetected(result.getText()); // pass the barcode number up
            }
          }
        );
      } catch (e) {
        alert("Could not access camera. Please allow camera permissions in your browser settings.");
      }
    };

    start();

    // Cleanup: stop the camera when the component unmounts
    return () => {
      stopped = true;
      readerRef.current?.reset();
    };
  }, []);

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", marginBottom: 12 }}>
      {/* Live camera feed */}
      <video ref={videoRef} style={{ width: "100%", display: "block" }} playsInline muted />
      {/* Overlay with a targeting box to guide the user */}
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none"
      }}>
        <div style={{ width: 220, height: 100, border: "2px solid #7F77DD", borderRadius: 8, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
      </div>
      <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 12 }}>
        Point camera at barcode
      </div>
      <button onClick={onClose} style={{
        position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)",
        color: "#fff", border: "none", borderRadius: 20, padding: "4px 12px", fontSize: 12
      }}>Cancel</button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState(0);
  const [foodLog, setFoodLog] = useState([]);
  const [actLog, setActLog]   = useState([]);

  // Food logging state
  const [foodInput, setFoodInput]   = useState("");
  const [servingG, setServingG]     = useState(150);
  const [analyzing, setAnalyzing]   = useState(false);
  const [analyzed, setAnalyzed]     = useState(null);
  const [inputMode, setInputMode]   = useState("text"); // "text" | "photo" | "barcode"
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState(""); // feedback message during barcode lookup

  // Activity logging state
  const [actMode, setActMode]         = useState("list");
  const [actCustom, setActCustom]     = useState("");
  const [actCustomMins, setActCustomMins] = useState(20);
  const [actEstimating, setActEstimating] = useState(false);

  // Coach state
  const [coachQ, setCoachQ]         = useState("");
  const [coachA, setCoachA]         = useState("");
  const [coachLoading, setCoachLoading] = useState(false);

  // Hidden file input ref — we trigger this programmatically when user taps "Take photo"
  const photoInputRef = useRef(null);

  // ── Derived totals ──────────────────────────────────────────────────────────

  const eaten = foodLog.reduce(
    (a, f) => ({ kcal: a.kcal+f.kcal, protein: a.protein+f.protein, carbs: a.carbs+f.carbs, fat: a.fat+f.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const burned = actLog.reduce((a, x) => a + x.kcal, 0);
  const netKcal = eaten.kcal - burned;
  const remaining = {
    kcal:    Math.max(0, DAILY_GOALS.kcal - netKcal),
    protein: Math.max(0, DAILY_GOALS.protein - eaten.protein),
  };
  const hour    = new Date().getHours();
  const dayPct  = Math.min(hour / 20, 1);

  // ── Food logging handlers ───────────────────────────────────────────────────

  // Called when user picks a photo from camera or photo library.
  // The iPhone will show the native "Take Photo / Choose from Library" sheet.
  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    setAnalyzed(null);
    try {
      const b64   = await fileToBase64(file);
      const mime  = file.type || "image/jpeg";
      const result = await analyzePhotoFood(b64, mime);
      setAnalyzed(result);
      setServingG(result?.suggested_serving_g || 150);
    } catch { alert("Could not analyse photo. Please try again or type the food instead."); }
    setAnalyzing(false);
    // Reset input so the same photo can be re-selected if needed
    e.target.value = "";
  }

  // Called when ZXing successfully reads a barcode number from the camera.
  async function handleBarcodeDetected(code) {
    setScannerOpen(false);
    setScanStatus(`Barcode ${code} detected — looking up product...`);
    setAnalyzing(true);
    setAnalyzed(null);

    const result = await lookupBarcode(code);
    if (result) {
      setAnalyzed(result);
      setServingG(result.suggested_serving_g || 100);
      setScanStatus("");
    } else {
      setScanStatus(`Product not found in database for barcode ${code}. Try typing the food name instead.`);
    }
    setAnalyzing(false);
  }

  async function handleTextAnalyze() {
    if (!foodInput.trim()) return;
    setAnalyzing(true);
    setAnalyzed(null);
    const result = await analyzeTextFood(foodInput);
    setAnalyzed(result);
    setServingG(result?.suggested_serving_g || 150);
    setAnalyzing(false);
  }

  function addFood() {
    if (!analyzed) return;
    const factor = servingG / 100;
    setFoodLog(prev => [...prev, {
      id: Date.now(),
      name: analyzed.name,
      servingG,
      kcal:    Math.round(analyzed.kcal_per_100g    * factor),
      protein: Math.round(analyzed.protein_per_100g * factor),
      carbs:   Math.round(analyzed.carbs_per_100g   * factor),
      fat:     Math.round(analyzed.fat_per_100g     * factor),
      time:    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
    setFoodInput(""); setAnalyzed(null); setScanStatus("");
  }

  // ── Activity handlers ───────────────────────────────────────────────────────

  function addActivity(act) {
    setActLog(prev => [...prev, {
      id: Date.now(), label: act.label, mins: act.mins,
      kcal: calcBurn(act.metFactor, act.mins),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  }

  async function estimateCustomActivity() {
    if (!actCustom.trim()) return;
    setActEstimating(true);
    const sys = `Return ONLY JSON with keys: label (string), metFactor (number 1-12). No markdown.`;
    const raw = await callClaude(sys, `Activity: ${actCustom}, ${actCustomMins} mins, woman 53kg age 55`);
    try {
      const p = JSON.parse(raw.replace(/```json|```/g, "").trim());
      addActivity({ label: p.label || actCustom, mins: actCustomMins, metFactor: p.metFactor || 3 });
    } catch {
      addActivity({ label: actCustom, mins: actCustomMins, metFactor: 3 });
    }
    setActCustom(""); setActEstimating(false);
  }

  // ── Coach ───────────────────────────────────────────────────────────────────

  async function askCoach() {
    if (!coachQ.trim()) return;
    setCoachLoading(true);
    setCoachA(await getCoachReply(coachQ, eaten, burned, remaining));
    setCoachLoading(false);
  }

  // ── Suggestion text ─────────────────────────────────────────────────────────

  function getSuggestions() {
    if (remaining.protein > 60) return "Focus on protein next: eggs, Greek yogurt, grilled chicken, cottage cheese, or a protein smoothie.";
    if (remaining.kcal < 200)   return "You're close to your calorie target — a light snack like raw veggies with hummus or a small handful of nuts is ideal.";
    if (remaining.kcal > 600)   return "You have good room for a balanced meal — lean protein + vegetables + a small portion of complex carbs.";
    return "You're on track! A medium-sized balanced meal will close out your day well.";
  }

  // ── Shared card styles ──────────────────────────────────────────────────────
  const modeBtn = (active) => ({
    flex: 1, padding: "7px 4px", fontSize: 12, cursor: "pointer",
    fontWeight: active ? 500 : 400, borderRadius: 8,
    border: "0.5px solid #b4b2a9",
    background: active ? "#f1efe8" : "transparent",
    color: active ? "#2c2c2a" : "#888780",
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "1rem", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>

      {/* Hidden file input — captures photo from camera on mobile */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"   /* "environment" means rear camera on iPhone */
        onChange={handlePhotoSelected}
        style={{ display: "none" }}
      />

      <h2 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Nourish45</h2>
      <p style={{ fontSize: 13, color: "#888780", margin: "0 0 1rem" }}>Your daily nutrition & activity companion</p>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem", background: "#f1efe8", borderRadius: 12, padding: 4 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            flex: 1, padding: "6px 4px", fontSize: 11, fontWeight: tab===i ? 500 : 400,
            background: tab===i ? "#ffffff" : "transparent",
            border: tab===i ? "0.5px solid #d3d1c7" : "none",
            borderRadius: 8, cursor: "pointer",
            color: tab===i ? "#2c2c2a" : "#888780",
          }}>{t}</button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Today's progress</div>
            <div style={{ display: "flex", justifyContent: "space-around" }}>
              <Ring pct={netKcal/DAILY_GOALS.kcal}       color={palette.purple} label="Calories" value={`${Math.round(netKcal)} / ${DAILY_GOALS.kcal}`} />
              <Ring pct={eaten.protein/DAILY_GOALS.protein} color={palette.teal}   label="Protein"  value={`${Math.round(eaten.protein)}g / ${DAILY_GOALS.protein}g`} />
              <Ring pct={eaten.carbs/DAILY_GOALS.carbs}   color={palette.amber}  label="Carbs"    value={`${Math.round(eaten.carbs)}g`} />
              <Ring pct={eaten.fat/DAILY_GOALS.fat}       color={palette.coral}  label="Fat"      value={`${Math.round(eaten.fat)}g`} />
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Day timeline</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888780", marginBottom: 4 }}>
              <span>Wake up</span><span>Midday</span><span>Evening</span>
            </div>
            <div style={{ background: "#f1efe8", borderRadius: 99, height: 10, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${dayPct*100}%`, height: "100%", background: palette.purple, borderRadius: 99 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "#888780" }}>Eaten: <strong>{Math.round(eaten.kcal)} kcal</strong></span>
              <span style={{ color: "#888780" }}>Burned: <strong>{burned} kcal</strong></span>
              <span style={{ color: palette.teal }}>Left: <strong>{remaining.kcal} kcal</strong></span>
            </div>
          </Card>

          <Card style={{ borderLeft: `3px solid ${palette.teal}`, borderRadius: "0 12px 12px 0" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: palette.teal, marginBottom: 4 }}>What to eat next</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{getSuggestions()}</div>
          </Card>

          {foodLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Food log</div>
              {foodLog.map(f => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "0.5px solid #e8e7e3" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{f.name} <span style={{ color: "#b4b2a9", fontSize: 11 }}>({f.servingG}g)</span></div>
                    <div style={{ fontSize: 11, color: "#888780" }}>{f.time} · {f.protein}g protein</div>
                  </div>
                  <Badge color="purple">{f.kcal} kcal</Badge>
                </div>
              ))}
            </Card>
          )}

          {actLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Activity log</div>
              {actLog.map(a => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "0.5px solid #e8e7e3" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "#888780" }}>{a.time} · {a.mins} min</div>
                  </div>
                  <Badge color="teal">−{a.kcal} kcal</Badge>
                </div>
              ))}
            </Card>
          )}

          {foodLog.length === 0 && actLog.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "#b4b2a9", fontSize: 13 }}>
              Start logging food or activity to see your progress here.
            </div>
          )}
        </div>
      )}

      {/* ── LOG FOOD ── */}
      {tab === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          {/* Three input mode buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setInputMode("photo")}   style={modeBtn(inputMode==="photo")}>📷 Take photo</button>
            <button onClick={() => { setInputMode("barcode"); setScannerOpen(true); }} style={modeBtn(inputMode==="barcode")}>▦ Scan barcode</button>
            <button onClick={() => setInputMode("text")}    style={modeBtn(inputMode==="text")}>✏️ Type food</button>
          </div>

          {/* Photo mode */}
          {inputMode === "photo" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Take a photo of your food</div>
              <p style={{ fontSize: 12, color: "#888780", marginBottom: 12, lineHeight: 1.5 }}>
                Point your camera at a meal, ingredient, or plate. The AI will identify what it sees and estimate the nutrition automatically.
              </p>
              <button onClick={() => photoInputRef.current?.click()} style={{ width: "100%", padding: 12, fontSize: 14, background: palette.purple, color: "#fff", border: "none", borderRadius: 10 }}>
                {analyzing ? "Analysing photo..." : "Open camera ↗"}
              </button>
            </Card>
          )}

          {/* Barcode scanner */}
          {inputMode === "barcode" && scannerOpen && (
            <BarcodeScanner
              onDetected={handleBarcodeDetected}
              onClose={() => { setScannerOpen(false); setInputMode("text"); }}
            />
          )}

          {/* Barcode status message */}
          {scanStatus && (
            <div style={{ fontSize: 13, color: "#888780", padding: "8px 12px", background: "#f5f4f0", borderRadius: 8 }}>
              {scanStatus}
            </div>
          )}

          {/* Text mode */}
          {inputMode === "text" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Describe what you're eating</div>
              <textarea
                value={foodInput}
                onChange={e => setFoodInput(e.target.value)}
                placeholder="e.g. 'oatmeal with banana and almond milk' or a barcode number..."
                style={{ width: "100%", minHeight: 80, fontSize: 16, padding: 8, borderRadius: 8, border: "0.5px solid #b4b2a9", background: "#f9f8f5", boxSizing: "border-box", resize: "vertical" }}
              />
              <button onClick={handleTextAnalyze} disabled={analyzing || !foodInput.trim()} style={{ marginTop: 8, width: "100%", padding: 8, fontSize: 13 }}>
                {analyzing ? "Analysing..." : "Analyse nutrition ↗"}
              </button>
            </Card>
          )}

          {/* Result card — shown after any of the three input modes succeeds */}
          {analyzed && (
            <Card style={{ borderTop: `2px solid ${palette.teal}` }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{analyzed.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Kcal/100g", val: Math.round(analyzed.kcal_per_100g) },
                  { label: "Protein",   val: `${Math.round(analyzed.protein_per_100g)}g` },
                  { label: "Carbs",     val: `${Math.round(analyzed.carbs_per_100g)}g` },
                  { label: "Fat",       val: `${Math.round(analyzed.fat_per_100g)}g` },
                ].map(m => (
                  <div key={m.label} style={{ background: "#f5f4f0", borderRadius: 8, padding: "8px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{m.val}</div>
                    <div style={{ fontSize: 10, color: "#888780" }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: "#888780", whiteSpace: "nowrap" }}>Serving (g):</label>
                <input type="number" min="10" max="1000" value={servingG} onChange={e => setServingG(Number(e.target.value))}
                  style={{ width: 70, fontSize: 13, padding: "4px 8px" }} />
                <div style={{ fontSize: 12, color: palette.teal }}>
                  = {Math.round(analyzed.kcal_per_100g * servingG / 100)} kcal · {Math.round(analyzed.protein_per_100g * servingG / 100)}g protein
                </div>
              </div>
              <button onClick={addFood} style={{ width: "100%", padding: 8, fontSize: 13 }}>Add to today's log ↗</button>
            </Card>
          )}

          {/* Recently logged — tap to re-add without any scanning */}
          {foodLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Recently logged — tap to re-add</div>
              {[...foodLog].reverse().slice(0, 5).map(f => (
                <div key={f.id}
                  onClick={() => setFoodLog(prev => [...prev, { ...f, id: Date.now(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }])}
                  style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid #e8e7e3", cursor: "pointer" }}>
                  <div style={{ fontSize: 13 }}>{f.name} <span style={{ color: "#b4b2a9", fontSize: 11 }}>({f.servingG}g)</span></div>
                  <Badge color="gray">{f.kcal} kcal</Badge>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ── LOG ACTIVITY ── */}
      {tab === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["list","custom"].map(m => (
              <button key={m} onClick={() => setActMode(m)} style={modeBtn(actMode===m)}>
                {m === "list" ? "Common activities" : "Describe custom"}
              </button>
            ))}
          </div>

          {actMode === "list" && (
            <Card>
              <div style={{ fontSize: 12, color: "#888780", marginBottom: 10 }}>Tap any activity to add it</div>
              {ACTIVITY_LIST.map((a, i) => (
                <div key={i} onClick={() => addActivity(a)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", borderRadius: 8, border: "0.5px solid #d3d1c7",
                  marginBottom: 6, background: "#f9f8f5", cursor: "pointer",
                }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "#888780" }}>{a.mins} min</div>
                  </div>
                  <Badge color="teal">−{calcBurn(a.metFactor, a.mins)} kcal</Badge>
                </div>
              ))}
            </Card>
          )}

          {actMode === "custom" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Describe your activity</div>
              <input value={actCustom} onChange={e => setActCustom(e.target.value)}
                placeholder="e.g. 'carried grocery bags up 3 flights of stairs'"
                style={{ width: "100%", fontSize: 16, padding: 8, borderRadius: 8, border: "0.5px solid #b4b2a9", background: "#f9f8f5", boxSizing: "border-box" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
                <label style={{ fontSize: 12, color: "#888780" }}>Duration (min):</label>
                <input type="number" min="1" max="180" value={actCustomMins} onChange={e => setActCustomMins(Number(e.target.value))}
                  style={{ width: 60, fontSize: 13, padding: "4px 8px" }} />
              </div>
              <button onClick={estimateCustomActivity} disabled={actEstimating || !actCustom.trim()} style={{ width: "100%", padding: 8, fontSize: 13 }}>
                {actEstimating ? "Estimating..." : "Estimate & add ↗"}
              </button>
            </Card>
          )}

          {actLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Today's activity</div>
              {actLog.map(a => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid #e8e7e3" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "#888780" }}>{a.time} · {a.mins} min</div>
                  </div>
                  <Badge color="teal">−{a.kcal} kcal</Badge>
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: palette.teal }}>Total burned: {burned} kcal</div>
            </Card>
          )}
        </div>
      )}

      {/* ── ASK COACH ── */}
      {tab === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Card style={{ borderTop: `2px solid ${palette.purple}` }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Your wellness coach</div>
            <p style={{ fontSize: 12, color: "#888780", margin: "0 0 12px", lineHeight: 1.5 }}>
              Ask anything — nutrition, activity suggestions, what to eat next, or tips for women over 45.
            </p>
            <textarea value={coachQ} onChange={e => setCoachQ(e.target.value)}
              placeholder="e.g. 'I had a big lunch — should I still work out?'"
              style={{ width: "100%", minHeight: 80, fontSize: 16, padding: 8, borderRadius: 8, border: "0.5px solid #b4b2a9", background: "#f9f8f5", boxSizing: "border-box", resize: "vertical" }} />
            <button onClick={askCoach} disabled={coachLoading || !coachQ.trim()} style={{ marginTop: 8, width: "100%", padding: 8, fontSize: 13 }}>
              {coachLoading ? "Thinking..." : "Ask coach ↗"}
            </button>
          </Card>

          {coachA && (
            <Card style={{ background: "#f9f8f5" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: palette.purple, marginBottom: 6 }}>Coach reply</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{coachA}</p>
            </Card>
          )}

          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Quick questions</div>
            {[
              "What should I eat for dinner today?",
              "Am I getting enough protein?",
              "Suggest a 10-minute home activity to burn more calories",
              "How is my day going vs my goals?",
            ].map(q => (
              <div key={q} onClick={() => setCoachQ(q)} style={{
                padding: "7px 10px", fontSize: 12, borderRadius: 8,
                border: "0.5px solid #d3d1c7", cursor: "pointer", marginBottom: 6,
                color: "#888780", background: "#f9f8f5",
              }}>{q}</div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
