import { useState, useEffect } from "react";

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const FALLBACK_QUESTIONS = [
  { topic: "Life", q: "You can only eat one cuisine for the rest of your life — but you live 20 extra years. Worth it?", a: "Absolutely worth it", b: "Hard pass, I'd rather die free" },
  { topic: "Sports", q: "LeBron James gets a 5-year head start — does he finish with more rings than Jordan?", a: "Yes, LeBron dominates", b: "No, Jordan still wins" },
  { topic: "Absurd", q: "Every dog on Earth can talk, but only says passive-aggressive comments. Good or bad world?", a: "I'd love this honestly", b: "Civilization collapses in a week" },
  { topic: "Pop Culture", q: "The MCU or Star Wars — one gets erased from history. Which survives?", a: "Save the MCU", b: "Save Star Wars" },
  { topic: "Life", q: "Would you rather know the exact date you die, or never know but lose 10 years?", a: "Know the date", b: "Stay ignorant, lose the years" },
  { topic: "Absurd", q: "Every time you lie, a nearby stranger gets $100. Do you become a serial liar?", a: "Yes, I'm doing this", b: "No, my integrity holds" },
  { topic: "Sports", q: "Prime Tiger Woods or prime Jack Nicklaus — one round at Augusta. Who wins?", a: "Tiger in his prime", b: "Jack Nicklaus, no question" },
  { topic: "Pop Culture", q: "Taylor Swift and Beyoncé release albums the same day every year forever. Does either win?", a: "Taylor eventually dominates", b: "Beyoncé, always and forever" },
];

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}
function getInitials(name) {
  return name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}
const AVATAR_COLORS = ["#534AB7","#0F6E56","#993C1D","#993556","#185FA5","#3B6D11","#854F0B","#A32D2D"];
function avatarColor(name) {
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function getTodayQuestion(today) {
  try {
    const rows = await sbFetch(`daily_question?date=eq.${today}&limit=1`);
    if (rows.length > 0) return { topic: rows[0].topic, q: rows[0].question, a: rows[0].option_a, b: rows[0].option_b };
  } catch {}
  return null;
}

async function saveTodayQuestion(today, q) {
  try {
    await sbFetch("daily_question", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ date: today, topic: q.topic, question: q.q, option_a: q.a, option_b: q.b })
    });
  } catch {}
}

async function getTodayVotes(today) {
  try {
    const rows = await sbFetch(`votes?date=eq.${today}`);
    const v = {};
    for (const r of rows) v[r.name] = r.choice;
    return v;
  } catch { return {}; }
}

async function submitVote(today, name, choice) {
  try {
    await sbFetch("votes", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ date: today, name, choice })
    });
  } catch {}
}

async function fetchAIQuestion() {
  if (!ANTHROPIC_API_KEY) return null;
  const topics = ["Sports", "Life & Philosophy", "Pop Culture", "Random & Absurd"];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const prompt = `Generate ONE extremely thought-provoking, controversial "hot take" question for a friend group voting app. Topic: ${topic}.
Format your response as JSON only (no markdown, no preamble):
{"topic":"${topic}","q":"the question text","a":"first option (bold stance)","b":"second option (opposite bold stance)"}
Make it spicy, polarizing, and fun. Both options should be defensible but create strong disagreement.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (parsed.q && parsed.a && parsed.b) return parsed;
  } catch {}
  return null;
}

export default function App() {
  const [question, setQuestion] = useState(null);
  const [votes, setVotes] = useState({});
  const [name, setName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [myVote, setMyVote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("name");
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  useEffect(() => { initApp(); }, []);

  async function initApp() {
    setLoading(true);
    const today = getTodayKey();

    // Load votes from Supabase
    const todayVotes = await getTodayVotes(today);
    setVotes(todayVotes);

    // Load or generate today's shared question
    let q = await getTodayQuestion(today);
    if (!q) {
      q = await fetchAIQuestion();
      if (!q) q = FALLBACK_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUESTIONS.length)];
      await saveTodayQuestion(today, q);
    }
    setQuestion(q);
    setLoading(false);
  }

  function handleNameSubmit() {
    const n = nameInput.trim();
    if (!n) return;
    setName(n);
    const v = votes[n];
    if (v) { setMyVote(v); setScreen("results"); }
    else setScreen("vote");
  }

  async function handleVote(choice) {
    const today = getTodayKey();
    await submitVote(today, name, choice);
    const updated = await getTodayVotes(today);
    setVotes(updated);
    setMyVote(choice);
    setShowEasterEgg(true);
    setTimeout(() => { setShowEasterEgg(false); setScreen("results"); }, 1000);
  }

  const voterList = Object.entries(votes);
  const aVoters = voterList.filter(([,v]) => v === "a");
  const bVoters = voterList.filter(([,v]) => v === "b");
  const total = voterList.length;
  const aPct = total ? Math.round((aVoters.length / total) * 100) : 50;
  const bPct = total ? Math.round((bVoters.length / total) * 100) : 50;

  return (
    <div style={{ width: "100%", maxWidth: 600, position: "relative" }}>
      {showEasterEgg && (
        <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",zIndex:1000,background:"rgba(255,255,255,0.97)",borderRadius:16,padding:"1rem 2rem",boxShadow:"0 0 0 3px rgba(83,74,183,0.4)",textAlign:"center",animation:"popIn 0.2s ease",whiteSpace:"nowrap"}}>
          <span style={{fontSize:22}}>😢</span>
          <p style={{fontSize:17,fontWeight:600,margin:"6px 0 0",color:"#2d1b69"}}>I miss Jack</p>
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes popIn { from { transform: translate(-50%,-50%) scale(0.6); opacity:0 } to { transform: translate(-50%,-50%) scale(1); opacity:1 } }
        .vote-btn { transition: transform 0.1s, box-shadow 0.1s; cursor: pointer; border: none; }
        .vote-btn:hover { transform: translateY(-3px) scale(1.02); }
        .vote-btn:active { transform: scale(0.97); }
        .go-btn { transition: background 0.15s; cursor: pointer; }
        .go-btn:hover { background: rgba(255,255,255,0.25) !important; }
      `}</style>

      <div style={{background:"rgba(255,255,255,0.06)",backdropFilter:"blur(12px)",border:"0.5px solid rgba(255,255,255,0.15)",borderRadius:20,padding:"2rem 1.5rem",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:220,height:220,borderRadius:"50%",background:"rgba(83,74,183,0.2)",pointerEvents:"none"}} />
        <div style={{position:"absolute",bottom:-40,left:-40,width:180,height:180,borderRadius:"50%",background:"rgba(15,110,86,0.15)",pointerEvents:"none"}} />

        <div style={{position:"relative",zIndex:1}}>
          <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
            <h1 style={{fontSize:24,fontWeight:700,color:"#fff",letterSpacing:"-0.5px"}}>Watson's World of Wonder</h1>
            <p style={{fontSize:13,color:"rgba(255,255,255,0.55)",marginTop:6}}>Daily hot takes. No wrong answers. Only regrets.</p>
          </div>

          {loading ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"2rem 0"}}>
              <div style={{width:36,height:36,border:"3px solid rgba(255,255,255,0.15)",borderTop:"3px solid #a78bfa",borderRadius:"50%",animation:"spin 0.9s linear infinite"}} />
              <p style={{color:"rgba(255,255,255,0.45)",fontSize:14}}>Loading today's hot take...</p>
            </div>
          ) : (
            <>
              {question && (
                <div style={{textAlign:"center",marginBottom:"1rem"}}>
                  <span style={{fontSize:12,fontWeight:500,background:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",padding:"4px 14px",borderRadius:8,border:"0.5px solid rgba(255,255,255,0.2)"}}>
                    {question.topic}
                  </span>
                </div>
              )}
              {question && (
                <div style={{background:"rgba(255,255,255,0.08)",border:"0.5px solid rgba(255,255,255,0.15)",borderRadius:14,padding:"1.25rem",marginBottom:"1.5rem",textAlign:"center"}}>
                  <p style={{fontSize:17,fontWeight:500,lineHeight:1.6,margin:0,color:"#fff"}}>{question.q}</p>
                </div>
              )}

              {screen === "name" && (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                  <p style={{fontSize:14,color:"rgba(255,255,255,0.6)",margin:0}}>Enter your first name to cast your vote</p>
                  <div style={{display:"flex",gap:8,width:"100%",maxWidth:320}}>
                    <input type="text" placeholder="Your name..." value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleNameSubmit()}
                      style={{flex:1,padding:"9px 14px",fontSize:15,border:"0.5px solid rgba(255,255,255,0.25)",borderRadius:10,background:"rgba(255,255,255,0.1)",color:"#fff"}} />
                    <button className="go-btn" onClick={handleNameSubmit}
                      style={{padding:"9px 20px",fontSize:14,fontWeight:600,border:"0.5px solid rgba(255,255,255,0.3)",borderRadius:10,background:"rgba(255,255,255,0.15)",color:"#fff"}}>
                      Go
                    </button>
                  </div>
                  {total > 0 && <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",margin:0}}>{total} {total===1?"person has":"people have"} already voted today</p>}
                </div>
              )}

              {screen === "vote" && question && (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <p style={{textAlign:"center",fontSize:14,color:"rgba(255,255,255,0.6)",margin:0}}>What do you think, {name}?</p>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                    {[["a", question.a, "linear-gradient(135deg,#7c3aed,#4f46e5)"],
                      ["b", question.b, "linear-gradient(135deg,#059669,#0891b2)"]].map(([key, label, grad]) => (
                      <button key={key} className="vote-btn" onClick={() => handleVote(key)}
                        style={{padding:"1.1rem",fontSize:14,fontWeight:600,borderRadius:14,background:grad,color:"#fff",lineHeight:1.4,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {screen === "results" && question && (
                <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
                  <div style={{borderRadius:8,overflow:"hidden",height:10,display:"flex",background:"rgba(255,255,255,0.1)"}}>
                    <div style={{width:`${aPct}%`,background:"linear-gradient(90deg,#7c3aed,#4f46e5)",transition:"width 0.6s ease"}} />
                    <div style={{flex:1,background:"linear-gradient(90deg,#059669,#0891b2)",transition:"width 0.6s ease"}} />
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    {[["a", question.a, "#a78bfa", "rgba(124,58,237,0.25)", aVoters, aPct],
                      ["b", question.b, "#34d399", "rgba(5,150,105,0.25)", bVoters, bPct]].map(([key, label, color, bg, voters, pct]) => (
                      <div key={key} style={{background:bg,border:`${myVote===key?"2px":"0.5px"} solid ${myVote===key?color:"rgba(255,255,255,0.12)"}`,borderRadius:14,padding:"1rem"}}>
                        <div style={{fontSize:26,fontWeight:700,color,marginBottom:4}}>{pct}%</div>
                        <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.4,marginBottom:"0.75rem"}}>{label}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {voters.map(([vName]) => (
                            <div key={vName} title={vName} style={{width:28,height:28,borderRadius:"50%",background:avatarColor(vName),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"#fff"}}>
                              {getInitials(vName)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{textAlign:"center",fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>
                    {total} {total===1?"vote":"votes"} cast today {myVote && `· You picked "${myVote==="a"?question.a:question.b}"`}
                  </p>
                  <button onClick={() => { setScreen("name"); setNameInput(""); setName(""); setMyVote(null); }}
                    style={{alignSelf:"center",fontSize:13,color:"rgba(255,255,255,0.4)",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
                    Vote as someone else
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
