import { useState, useEffect, useRef } from "react";

const DAILY_GOALS = { kcal: 1800, protein: 115, carbs: 180, fat: 60 };

const ACTIVITY_LIST = [
  { label: "Cleaning kitchen", mins: 30, metFactor: 3.5 },
  { label: "Vacuuming floors", mins: 20, metFactor: 3.8 },
  { label: "Grocery shopping (walking)", mins: 40, metFactor: 2.5 },
  { label: "Climbing stairs", mins: 15, metFactor: 8.0 },
  { label: "Brisk walk (15 min)", mins: 15, metFactor: 4.5 },
  { label: "Brisk walk (30 min)", mins: 30, metFactor: 4.5 },
  { label: "Yoga / stretching", mins: 30, metFactor: 2.5 },
  { label: "Gym session", mins: 60, metFactor: 6.0 },
  { label: "Cycling (moderate)", mins: 30, metFactor: 6.0 },
  { label: "Swimming", mins: 30, metFactor: 6.0 },
];

const WEIGHT_KG = 53;
function calcBurn(metFactor, mins) {
  return Math.round((metFactor * WEIGHT_KG * (mins / 60)));
}

const TABS = ["Dashboard", "Log Food", "Log Activity", "Ask Coach"];

const palette = {
  purple: "#7F77DD",
  teal: "#1D9E75",
  coral: "#D85A30",
  amber: "#BA7517",
  gray: "#888780",
};

function Ring({ pct, color, size = 80, stroke = 8, label, value }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 1) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--color-border-tertiary)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2+2} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 13, fontWeight: 500, fill: "var(--color-text-primary)" }}>
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{value}</div>
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1rem 1.25rem",
      ...style
    }}>{children}</div>
  );
}

function Badge({ children, color }) {
  const map = {
    teal: { bg: "#E1F5EE", text: "#0F6E56" },
    coral: { bg: "#FAECE7", text: "#993C1D" },
    amber: { bg: "#FAEEDA", text: "#854F0B" },
    purple: { bg: "#EEEDFE", text: "#3C3489" },
    gray: { bg: "#F1EFE8", text: "#5F5E5A" },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{
      background: c.bg, color: c.text,
      fontSize: 11, fontWeight: 500,
      padding: "2px 8px", borderRadius: 20
    }}>{children}</span>
  );
}

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

async function analyzeFood(description) {
  const sys = `You are a nutrition expert for women over 45. Given a food description, return ONLY a JSON object with keys: name (string), kcal_per_100g (number), protein_per_100g (number), carbs_per_100g (number), fat_per_100g (number), suggested_serving_g (number). No markdown, no explanation.`;
  const raw = await callClaude(sys, `Analyze: ${description}`);
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

async function getCoachReply(question, eaten, burned, remaining) {
  const sys = `You are a warm, knowledgeable wellness coach specializing in women over 45. Be concise, practical, and encouraging. Max 120 words.`;
  const ctx = `User stats today — eaten: ${eaten.kcal} kcal, ${eaten.protein}g protein. Activity burned: ${burned} kcal. Remaining goals: ${remaining.kcal} kcal, ${remaining.protein}g protein.`;
  return await callClaude(sys, `${ctx}\n\nQuestion: ${question}`);
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [foodLog, setFoodLog] = useState([]);
  const [actLog, setActLog] = useState([]);
  const [foodInput, setFoodInput] = useState("");
  const [servingG, setServingG] = useState(150);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(null);
  const [actMode, setActMode] = useState("list");
  const [actCustom, setActCustom] = useState("");
  const [actCustomMins, setActCustomMins] = useState(20);
  const [coachQ, setCoachQ] = useState("");
  const [coachA, setCoachA] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [actEstimating, setActEstimating] = useState(false);

  // Totals
  const eaten = foodLog.reduce((a, f) => ({
    kcal: a.kcal + f.kcal,
    protein: a.protein + f.protein,
    carbs: a.carbs + f.carbs,
    fat: a.fat + f.fat,
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

  const burned = actLog.reduce((a, x) => a + x.kcal, 0);
  const netKcal = eaten.kcal - burned;
  const remaining = {
    kcal: Math.max(0, DAILY_GOALS.kcal - netKcal),
    protein: Math.max(0, DAILY_GOALS.protein - eaten.protein),
  };

  // Timeline % (based on current hour)
  const hour = new Date().getHours();
  const dayPct = Math.min(hour / 20, 1); // day ends ~8pm reference

  async function handleAnalyze() {
    if (!foodInput.trim()) return;
    setAnalyzing(true);
    setAnalyzed(null);
    const result = await analyzeFood(foodInput);
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
      kcal: Math.round(analyzed.kcal_per_100g * factor),
      protein: Math.round(analyzed.protein_per_100g * factor),
      carbs: Math.round(analyzed.carbs_per_100g * factor),
      fat: Math.round(analyzed.fat_per_100g * factor),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
    setFoodInput(""); setAnalyzed(null);
  }

  function addActivity(act) {
    setActLog(prev => [...prev, {
      id: Date.now(),
      label: act.label,
      mins: act.mins,
      kcal: calcBurn(act.metFactor, act.mins),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  }

  async function estimateCustomActivity() {
    if (!actCustom.trim()) return;
    setActEstimating(true);
    const sys = `Return ONLY a JSON object with keys: label (string), metFactor (number 1-12). No markdown.`;
    const raw = await callClaude(sys, `Activity: ${actCustom}, duration: ${actCustomMins} mins, woman 53kg age 55`);
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      addActivity({ label: parsed.label || actCustom, mins: actCustomMins, metFactor: parsed.metFactor || 3 });
    } catch { addActivity({ label: actCustom, mins: actCustomMins, metFactor: 3 }); }
    setActCustom(""); setActEstimating(false);
  }

  async function askCoach() {
    if (!coachQ.trim()) return;
    setCoachLoading(true);
    const reply = await getCoachReply(coachQ, eaten, burned, remaining);
    setCoachA(reply);
    setCoachLoading(false);
  }

  // Suggested next meals
  function getSuggestions() {
    if (remaining.protein > 60) return "Focus on protein next: eggs, Greek yogurt, grilled chicken, cottage cheese, or a protein smoothie.";
    if (remaining.kcal < 200) return "You're close to your calorie target — a light snack like raw veggies with hummus or a small handful of nuts is ideal.";
    if (remaining.kcal > 600) return "You have good room for a balanced meal — think lean protein + vegetables + a small portion of complex carbs.";
    return "You're on track! A medium-sized balanced meal will close out your day well.";
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "1rem", fontFamily: "var(--font-sans)" }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px", color: "var(--color-text-primary)" }}>Nourish45</h2>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem" }}>Your daily nutrition & activity companion</p>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-lg)", padding: 4 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            flex: 1, padding: "6px 4px", fontSize: 11, fontWeight: tab === i ? 500 : 400,
            background: tab === i ? "var(--color-background-primary)" : "transparent",
            border: tab === i ? "0.5px solid var(--color-border-tertiary)" : "none",
            borderRadius: "var(--border-radius-md)", cursor: "pointer",
            color: tab === i ? "var(--color-text-primary)" : "var(--color-text-secondary)"
          }}>{t}</button>
        ))}
      </div>

      {/* DASHBOARD */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Rings */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: "var(--color-text-primary)" }}>Today's progress</div>
            <div style={{ display: "flex", justifyContent: "space-around" }}>
              <Ring pct={netKcal / DAILY_GOALS.kcal} color={palette.purple} label="Calories" value={`${Math.round(netKcal)} / ${DAILY_GOALS.kcal}`} />
              <Ring pct={eaten.protein / DAILY_GOALS.protein} color={palette.teal} label="Protein" value={`${Math.round(eaten.protein)}g / ${DAILY_GOALS.protein}g`} />
              <Ring pct={eaten.carbs / DAILY_GOALS.carbs} color={palette.amber} label="Carbs" value={`${Math.round(eaten.carbs)}g`} />
              <Ring pct={eaten.fat / DAILY_GOALS.fat} color={palette.coral} label="Fat" value={`${Math.round(eaten.fat)}g`} />
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Day timeline</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>
              <span>Wake up</span><span>Midday</span><span>Evening</span>
            </div>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 99, height: 10, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${dayPct * 100}%`, height: "100%", background: palette.purple, borderRadius: 99, transition: "width 0.5s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <div style={{ color: "var(--color-text-secondary)" }}>Eaten: <strong>{Math.round(eaten.kcal)} kcal</strong></div>
              <div style={{ color: "var(--color-text-secondary)" }}>Burned: <strong>{burned} kcal</strong></div>
              <div style={{ color: palette.teal }}>Left: <strong>{remaining.kcal} kcal</strong></div>
            </div>
          </Card>

          {/* Suggestion */}
          <Card style={{ borderLeft: `3px solid ${palette.teal}`, borderRadius: "0 var(--border-radius-lg) var(--border-radius-lg) 0" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: palette.teal, marginBottom: 4 }}>What to eat next</div>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>{getSuggestions()}</div>
          </Card>

          {/* Logs */}
          {foodLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Food log</div>
              {foodLog.map(f => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{f.name} <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>({f.servingG}g)</span></div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{f.time} · {f.protein}g protein · {f.carbs}g carbs</div>
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
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{a.time} · {a.mins} min</div>
                  </div>
                  <Badge color="teal">−{a.kcal} kcal</Badge>
                </div>
              ))}
            </Card>
          )}

          {foodLog.length === 0 && actLog.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 13 }}>
              Start logging food or activity to see your progress here.
            </div>
          )}
        </div>
      )}

      {/* LOG FOOD */}
      {tab === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Describe what you're eating</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 8px", lineHeight: 1.5 }}>
              Type the food name, a meal description, or a product barcode number. For example: "200g Greek yogurt", "scrambled eggs with spinach", or "barcode 5449000000996".
            </p>
            <textarea
              value={foodInput}
              onChange={e => setFoodInput(e.target.value)}
              placeholder="e.g. 'oatmeal with banana and almond milk' or product barcode..."
              style={{ width: "100%", minHeight: 80, fontSize: 13, padding: 8, borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box", resize: "vertical" }}
            />
            <button onClick={handleAnalyze} disabled={analyzing || !foodInput.trim()} style={{ marginTop: 8, width: "100%", padding: "8px", fontSize: 13, cursor: "pointer" }}>
              {analyzing ? "Analysing..." : "Analyse nutrition ↗"}
            </button>
          </Card>

          {analyzed && (
            <Card style={{ borderTop: `2px solid ${palette.teal}` }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{analyzed.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Kcal/100g", val: Math.round(analyzed.kcal_per_100g) },
                  { label: "Protein", val: `${analyzed.protein_per_100g}g` },
                  { label: "Carbs", val: `${analyzed.carbs_per_100g}g` },
                  { label: "Fat", val: `${analyzed.fat_per_100g}g` },
                ].map(m => (
                  <div key={m.label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{m.val}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>Serving size (g):</label>
                <input type="number" min="10" max="1000" value={servingG} onChange={e => setServingG(Number(e.target.value))}
                  style={{ width: 70, fontSize: 13, padding: "4px 8px" }} />
                <div style={{ fontSize: 12, color: palette.teal }}>= {Math.round(analyzed.kcal_per_100g * servingG / 100)} kcal · {Math.round(analyzed.protein_per_100g * servingG / 100)}g protein</div>
              </div>
              <button onClick={addFood} style={{ width: "100%", padding: 8, fontSize: 13, cursor: "pointer" }}>Add to log ↗</button>
            </Card>
          )}

          {foodLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Recent — tap to re-add</div>
              {[...foodLog].reverse().slice(0, 4).map(f => (
                <div key={f.id} onClick={() => setFoodLog(prev => [...prev, { ...f, id: Date.now(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }])}
                  style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", cursor: "pointer" }}>
                  <div style={{ fontSize: 13 }}>{f.name} <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>({f.servingG}g)</span></div>
                  <Badge color="gray">{f.kcal} kcal</Badge>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* LOG ACTIVITY */}
      {tab === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["list", "custom"].map(m => (
              <button key={m} onClick={() => setActMode(m)} style={{
                flex: 1, padding: "7px", fontSize: 12,
                background: actMode === m ? "var(--color-background-secondary)" : "transparent",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                fontWeight: actMode === m ? 500 : 400
              }}>
                {m === "list" ? "Common activities" : "Describe custom activity"}
              </button>
            ))}
          </div>

          {actMode === "list" && (
            <Card>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>Tap any activity to add it to your log</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ACTIVITY_LIST.map((a, i) => (
                  <div key={i} onClick={() => addActivity(a)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", borderRadius: "var(--border-radius-md)",
                    border: "0.5px solid var(--color-border-tertiary)", cursor: "pointer",
                    background: "var(--color-background-secondary)"
                  }}>
                    <div>
                      <div style={{ fontSize: 13 }}>{a.label}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{a.mins} min</div>
                    </div>
                    <Badge color="teal">−{calcBurn(a.metFactor, a.mins)} kcal</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {actMode === "custom" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Describe your activity</div>
              <input value={actCustom} onChange={e => setActCustom(e.target.value)}
                placeholder="e.g. 'carried grocery bags up 3 flights of stairs'"
                style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Duration (min):</label>
                <input type="number" min="1" max="180" value={actCustomMins} onChange={e => setActCustomMins(Number(e.target.value))}
                  style={{ width: 60, fontSize: 13, padding: "4px 8px" }} />
              </div>
              <button onClick={estimateCustomActivity} disabled={actEstimating || !actCustom.trim()} style={{ width: "100%", padding: 8, fontSize: 13, cursor: "pointer" }}>
                {actEstimating ? "Estimating..." : "Estimate & add ↗"}
              </button>
            </Card>
          )}

          {actLog.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Today's activity</div>
              {actLog.map(a => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{a.time} · {a.mins} min</div>
                  </div>
                  <Badge color="teal">−{a.kcal} kcal</Badge>
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: palette.teal }}>
                Total burned: {burned} kcal
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ASK COACH */}
      {tab === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Card style={{ borderTop: `2px solid ${palette.purple}` }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Your wellness coach</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 12px", lineHeight: 1.5 }}>
              Ask anything about your day — nutrition, activities, what to eat next, how to hit your goals, or tips for women over 45. Your today's data is shared with the coach automatically.
            </p>
            <textarea value={coachQ} onChange={e => setCoachQ(e.target.value)}
              placeholder="e.g. 'I had a big lunch and feel tired — should I still work out?' or 'What protein-rich snack can I have before bed?'"
              style={{ width: "100%", minHeight: 80, fontSize: 13, padding: 8, borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box", resize: "vertical" }} />
            <button onClick={askCoach} disabled={coachLoading || !coachQ.trim()} style={{ marginTop: 8, width: "100%", padding: 8, fontSize: 13, cursor: "pointer" }}>
              {coachLoading ? "Thinking..." : "Ask coach ↗"}
            </button>
          </Card>

          {coachA && (
            <Card style={{ background: "var(--color-background-secondary)" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: palette.purple, marginBottom: 6 }}>Coach reply</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "var(--color-text-primary)" }}>{coachA}</p>
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
                padding: "7px 10px", fontSize: 12, borderRadius: "var(--border-radius-md)",
                border: "0.5px solid var(--color-border-tertiary)", cursor: "pointer",
                marginBottom: 6, color: "var(--color-text-secondary)",
                background: "var(--color-background-secondary)"
              }}>{q}</div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
