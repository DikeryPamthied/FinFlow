import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabaseClient";

// ─── Date helpers (timezone-safe) ─────────────────────────────────────────
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const parseLocal = (iso) => { const [y,m,d] = iso.split("-").map(Number); return new Date(y,m-1,d); };
const fmtDate  = (iso) => parseLocal(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const fmtMonth = (iso) => parseLocal(iso).toLocaleDateString("en-US",{month:"long",year:"numeric"});
const monthKey = (iso) => { const d=parseLocal(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthKeyLabel = (k) => { const [y,m]=k.split("-"); return new Date(+y,+m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const currency = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(n||0);

// ─── Persistent storage (Supabase) ────────────────────────────────────────
async function loadData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { salaryEntries: [], expenses: [] };

  const [salRes, expRes] = await Promise.all([
    supabase.from('salary_entries').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('expenses').select('*').eq('user_id', user.id).order('date', { ascending: false })
  ]);

  return {
    salaryEntries: salRes.data?.map(s => ({
      ...s,
      amount: parseFloat(s.amount),
      tithe: parseFloat(s.tithe),
      wantsAlloc: parseFloat(s.wants_alloc),
      savingsAlloc: parseFloat(s.savings_alloc),
      savingsTag: s.savings_tag
    })) || [],
    expenses: expRes.data?.map(e => ({
      ...e,
      amount: parseFloat(e.amount)
    })) || []
  };
}

// ─── Computation (always from scratch — no delta bugs) ────────────────────
function computeTotals(salaryEntries, expenses) {
  const tithe    = salaryEntries.reduce((s,e)=>s+(e.tithe||0), 0);
  const savings  = salaryEntries.reduce((s,e)=>s+(e.savingsAlloc||0), 0);
  const savInv   = salaryEntries.filter(e=>e.savingsTag==="Investment").reduce((s,e)=>s+(e.savingsAlloc||0), 0);
  const savEm    = salaryEntries.filter(e=>e.savingsTag==="Emergency").reduce((s,e)=>s+(e.savingsAlloc||0), 0);
  const wants    = salaryEntries.reduce((s,e)=>s+(e.wantsAlloc||0), 0);
  const spent    = expenses.reduce((s,e)=>s+(e.amount||0), 0);
  return { tithe, savings, savInv, savEm, wants, spent, wantsBalance: wants-spent };
}

function groupByMonth(salaryEntries, expenses) {
  const g = {};
  salaryEntries.forEach(e => {
    const k = monthKey(e.date);
    if (!g[k]) g[k] = { key:k, entries:[], expenses:[] };
    g[k].entries.push(e);
  });
  expenses.forEach(e => {
    const k = monthKey(e.date);
    if (!g[k]) g[k] = { key:k, entries:[], expenses:[] };
    g[k].expenses.push(e);
  });
  return Object.values(g).sort((a,b)=>b.key.localeCompare(a.key));
}

// ─── Theme ─────────────────────────────────────────────────────────────────
const C = {
  bg:"#0a0a0b", surface:"#111113", surfaceHi:"#1a1a1e",
  border:"#242428", borderHi:"#2e2e34",
  gold:"#c9a84c", goldL:"#e8c96a", goldD:"#7a6230",
  teal:"#4ecdc4", rose:"#ff6b6b", green:"#6bcb77", purple:"#9b6cf7",
  text:"#f0ede8", mid:"#9b9790", dim:"#5a5752",
};

// ─── Auth Component ────────────────────────────────────────────────────────
function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [err, setErr]         = useState("");

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setErr("");
    const { error } = isSignUp 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    
    if (error) setErr(error.message);
    else if (isSignUp) alert("Check your email for confirmation!");
    setLoading(false);
  };

  return (
    <div style={{background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'Syne',system-ui,sans-serif"}}>
      <div style={{width:"100%", maxWidth:400, background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:40, position:"relative", overflow:"hidden"}}>
        <div style={{position:"absolute", top:-80, right:-80, width:240, height:240, background:"radial-gradient(circle,rgba(201,168,76,.08) 0%,transparent 70%)", pointerEvents:"none"}} />
        
        <div style={{textAlign:"center", marginBottom:32}}>
          <div style={{fontFamily:"'DM Serif Display',serif", fontSize:32, color:C.gold}}>FinFlow</div>
          <div style={{fontFamily:"'DM Mono',monospace", fontSize:11, color:C.dim, letterSpacing:4, textTransform:"uppercase", marginTop:6}}>Wealth Access</div>
        </div>

        <form onSubmit={handleAuth} style={{display:"flex", flexDirection:"column", gap:16}}>
          <div style={{display:"flex", flexDirection:"column", gap:6}}>
            <label style={{fontFamily:"'DM Mono',monospace", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:2}}>Email Address</label>
            <FInput type="email" placeholder="name@example.com" value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <div style={{display:"flex", flexDirection:"column", gap:6}}>
            <label style={{fontFamily:"'DM Mono',monospace", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:2}}>Password</label>
            <FInput type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required />
          </div>

          {err && <div style={{fontSize:12, color:C.rose, background:"rgba(255,107,107,.08)", padding:"10px 14px", borderRadius:8, border:`1px solid rgba(255,107,107,.2)`}}>{err}</div>}

          <button disabled={loading} style={{
            background:`linear-gradient(135deg,${C.gold},${C.goldL})`, border:"none", borderRadius:10, padding:"14px",
            fontSize:14, fontWeight:700, color:"#0a0a0b", cursor:"pointer", marginTop:12, transition:"all .18s", opacity:loading?0.7:1
          }}>{loading ? "Processing..." : (isSignUp ? "Create Account" : "Sign In")}</button>

          <button type="button" onClick={()=>setIsSignUp(!isSignUp)} style={{background:"none", border:"none", color:C.mid, fontSize:13, cursor:"pointer", marginTop:8}}>
            {isSignUp ? "Already have an account? Sign In" : "Need an account? Sign Up"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]     = useState(null);
  const [loaded, setLoaded]       = useState(false);
  const [salaryEntries, setSalaryEntries] = useState([]);
  const [expenses, setExpenses]   = useState([]);

  const [tab, setTab]             = useState("dashboard");
  const [openMonth, setOpenMonth] = useState(null);

  // Salary form
  const [sAmt,  setSAmt]  = useState("");
  const [sDate, setSDate] = useState(localToday);
  const [sTag,  setSTag]  = useState("Investment");

  // Expense form
  const [eName, setEName] = useState("");
  const [eAmt,  setEAmt]  = useState("");
  const [eDate, setEDate] = useState(localToday);
  const [eTag,  setETag]  = useState("General");

  // Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // Load from Supabase
  useEffect(() => {
    if (!session) return;
    loadData().then(data => {
      setSalaryEntries(data.salaryEntries);
      setExpenses(data.expenses);
      setLoaded(true);
    });
  }, [session]);

  // ── Derived ──
  const T = useMemo(() => computeTotals(salaryEntries, expenses), [salaryEntries, expenses]);
  const wPct = T.wants > 0 ? Math.min(100, (T.spent / T.wants) * 100) : 0;
  const groups = useMemo(() => groupByMonth(salaryEntries, expenses), [salaryEntries, expenses]);

  const prevAmt  = parseFloat(sAmt) || 0;
  const hasPrev  = prevAmt > 0;
  const pTithe   = prevAmt * 0.1;
  const pWants   = prevAmt * 0.9 * 0.5;
  const pSavings = prevAmt * 0.9 * 0.5;

  // ── Handlers ──
  const addSalary = async () => {
    const amount = parseFloat(sAmt);
    if (!amount || amount <= 0 || !sDate || !session) return;
    
    const tithe = +(amount * 0.1).toFixed(2);
    const wantsAlloc = +(amount * 0.9 * 0.5).toFixed(2);
    const savingsAlloc = +(amount * 0.9 * 0.5).toFixed(2);

    const { data, error } = await supabase.from('salary_entries').insert([{
      user_id: session.user.id,
      date: sDate,
      amount,
      savings_tag: sTag,
      tithe,
      wants_alloc: wantsAlloc,
      savings_alloc: savingsAlloc
    }]).select();

    if (!error && data) {
      const entry = { id: data[0].id, date: sDate, amount, savingsTag: sTag, tithe, wantsAlloc, savingsAlloc };
      setSalaryEntries(prev => [entry, ...prev]);
      setSAmt(""); setSDate(localToday());
    }
  };

  const delSalary = async (id) => {
    const { error } = await supabase.from('salary_entries').delete().eq('id', id);
    if (!error) setSalaryEntries(prev => prev.filter(e => e.id !== id));
  };

  const addExpense = async () => {
    const amount = parseFloat(eAmt);
    if (!amount || amount <= 0 || !eName.trim() || !session) return;

    const { data, error } = await supabase.from('expenses').insert([{
      user_id: session.user.id,
      date: eDate,
      name: eName.trim(),
      amount,
      tag: eTag
    }]).select();

    if (!error && data) {
      const exp = { id: data[0].id, date: eDate, name: eName.trim(), amount, tag: eTag };
      setExpenses(prev => [exp, ...prev]);
      setEName(""); setEAmt(""); setEDate(localToday());
    }
  };

  const delExpense = async (id) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (!error) setExpenses(prev => prev.filter(e => e.id !== id));
  };

  const handleSignOut = () => supabase.auth.signOut();

  const sortedSalaries = [...salaryEntries].sort((a,b) => b.date.localeCompare(a.date));
  const sortedExpenses = [...expenses].sort((a,b) => b.date.localeCompare(a.date));

  if (!session) return <Auth />;

  if (!loaded) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.dim,fontFamily:"monospace",fontSize:13}}>
      Connecting to cloud...
    </div>
  );

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'Syne',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:${C.goldD};border-radius:2px}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        input[type=date]{color-scheme:dark}
        select option{background:${C.surface};color:${C.text}}
        button{font-family:inherit}
      `}</style>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"0 24px 80px"}}>

        {/* ── NAV ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"26px 0 28px",borderBottom:`1px solid ${C.border}`,marginBottom:36,gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:C.gold}}>FinFlow</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:C.dim,letterSpacing:3,textTransform:"uppercase",marginTop:3}}>Wealth Tracker</div>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:20}}>
            <div style={{display:"flex",gap:3,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:4,flexWrap:"wrap"}}>
              {[["dashboard","Dashboard"],["expenses","Expenses"],["savings","Savings"],["history","History"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setTab(id)} style={{
                  padding:"8px 18px",borderRadius:7,border:tab===id?`1px solid ${C.borderHi}`:"1px solid transparent",
                  background:tab===id?C.surfaceHi:"transparent",color:tab===id?C.gold:C.mid,
                  fontSize:13,fontWeight:600,cursor:"pointer",letterSpacing:.3,transition:"all .18s",
                }}>{lbl}</button>
              ))}
            </div>
            <button onClick={handleSignOut} style={{background:"none", border:"none", color:C.dim, fontSize:11, cursor:"pointer", textTransform:"uppercase", letterSpacing:1.5}}>Sign Out</button>
          </div>
        </div>

        {/* ══════════ DASHBOARD ══════════ */}
        {tab === "dashboard" && <div>
          <SectionHeader title="Dashboard" sub="All-Time Totals" />
          <div style={{background:"linear-gradient(140deg,#151510 0%,#111113 55%,#0f0f14 100%)",border:`1px solid ${C.goldD}`,borderRadius:16,padding:28,marginBottom:26,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-80,right:-80,width:280,height:280,background:"radial-gradient(circle,rgba(201,168,76,.09) 0%,transparent 68%)",pointerEvents:"none"}} />
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:3,textTransform:"uppercase",color:C.dim}}>Record a Salary</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:C.teal,background:"rgba(78,205,196,.08)",border:"1px solid rgba(78,205,196,.22)",padding:"4px 10px",borderRadius:6}}>✓ Multiple per month supported</span>
            </div>
            <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:C.dim,letterSpacing:2,textTransform:"uppercase"}}>Tag savings as:</span>
              {["Investment","Emergency"].map(t=>(
                <button key={t} onClick={()=>setSTag(t)} style={{
                  padding:"5px 15px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .18s",
                  border: sTag===t ? (t==="Investment"?"1px solid rgba(155,108,247,.4)":"1px solid rgba(201,168,76,.4)") : `1px solid ${C.border}`,
                  background: sTag===t ? (t==="Investment"?"rgba(155,108,247,.12)":"rgba(201,168,76,.12)") : "transparent",
                  color: sTag===t ? (t==="Investment"?C.purple:C.gold) : C.mid,
                }}>{t}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:10,alignItems:"stretch",flexWrap:"wrap"}}>
              <div style={{position:"relative",flex:1,minWidth:180}}>
                <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontFamily:"'DM Mono',monospace",fontSize:18,color:C.gold,pointerEvents:"none"}}>$</span>
                <input type="number" inputMode="decimal" placeholder="0.00" value={sAmt} onChange={e => setSAmt(e.target.value)} onKeyDown={e => e.key==="Enter" && addSalary()}
                  style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 14px 14px 38px",fontFamily:"'DM Mono',monospace",fontSize:22,fontWeight:500,color:C.text,outline:"none"}}
                />
              </div>
              <input type="date" value={sDate} onChange={e => setSDate(e.target.value)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 12px",fontFamily:"'DM Mono',monospace",fontSize:14,color:C.text,outline:"none",minWidth:148}} />
              <button onClick={addSalary} disabled={!hasPrev} style={{
                  background: hasPrev ? `linear-gradient(135deg,${C.gold},${C.goldL})` : "rgba(255,255,255,.06)",
                  border:"none",borderRadius:10,padding:"14px 26px",fontSize:14,fontWeight:700,
                  color: hasPrev ? "#0a0a0b" : C.dim, cursor: hasPrev ? "pointer" : "not-allowed"
                }}>Add Salary</button>
            </div>
            {hasPrev && (
              <div style={{display:"flex",gap:24,marginTop:18,paddingTop:18,borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                {[["Tithe (10%)",pTithe,C.gold],["Wants (45%)",pWants,C.teal],["Savings (45%)",pSavings,C.purple],["New Wants Total",T.wantsBalance+pWants,C.teal]].map(([lbl,val,col])=>(
                  <div key={lbl}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,letterSpacing:2.5,textTransform:"uppercase",color:C.dim,marginBottom:3}}>{lbl}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:500,color:col}}>{currency(val)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:24}}>
            <MetricCard color={C.gold} accent={C.goldD} icon="⛪" label="Total Tithe Given" value={currency(T.tithe)} sub={`${salaryEntries.length} entries`} pct={salaryEntries.length?100:0} pctColor={C.gold} pctLabel="10% of income" />
            <MetricCard color={T.wantsBalance<0?C.rose:C.teal} accent="#2a6b68" icon="💳" label="Wants Balance" value={currency(T.wantsBalance)} sub={`of ${currency(T.wants)} allocated`} pct={Math.max(0,100-wPct)} pctColor={C.teal} pctLabel={`${Math.max(0,100-wPct).toFixed(0)}% left`} />
            <MetricCard color={C.purple} accent="#3d2a5e" icon="📈" label="Total Savings" value={currency(T.savings)} sub={`Inv: ${currency(T.savInv)} · Em: ${currency(T.savEm)}`} pct={T.savings>0?100:0} pctColor={C.purple} pctLabel="↑ Growing" />
            <MetricCard color={C.rose} accent="#7a3535" icon="🧾" label="Total Spent" value={currency(T.spent)} sub={`${expenses.length} expenses`} pct={wPct} pctColor={C.rose} pctLabel={`${wPct.toFixed(0)}% of budget`} />
          </div>
          {sortedSalaries.length > 0 && (
            <Panel title="Recent Salary Entries">
              <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:260,overflowY:"auto"}}>
                {sortedSalaries.slice(0,8).map(e=>(
                  <SalaryEntryRow key={e.id} entry={e} onDelete={()=>delSalary(e.id)} />
                ))}
              </div>
            </Panel>
          )}
          {salaryEntries.length===0 && <EmptyState icon="💰" text={"Enter your first salary above to begin.\nData is saved to your private cloud account."} />}
        </div>}

        {/* ══════════ EXPENSES ══════════ */}
        {tab === "expenses" && <div>
          <SectionHeader title="Expenses" sub="Wants & Needs" />
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16,marginBottom:24}}>
            <Panel title="Add Expense">
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                <FInput placeholder="Expense name..." value={eName} onChange={e=>setEName(e.target.value)} />
                <div style={{display:"flex",gap:8}}>
                  <FInput type="number" inputMode="decimal" placeholder="Amount" value={eAmt} onChange={e=>setEAmt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addExpense()} />
                  <FInput type="date" value={eDate} onChange={e=>setEDate(e.target.value)} style={{width:148,flex:"0 0 auto"}} />
                </div>
                <select value={eTag} onChange={e=>setETag(e.target.value)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 13px",fontFamily:"inherit",fontSize:14,color:C.text,outline:"none",cursor:"pointer"}}>
                  {["General","Food","Transport","Bills","Health","Entertainment","Shopping","Other"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={addExpense} disabled={!eName.trim()||!eAmt||parseFloat(eAmt)<=0} style={{background:"rgba(78,205,196,.09)",border:"1px solid rgba(78,205,196,.25)",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:700,color:C.teal,cursor:"pointer"}}>+ Add Expense</button>
                {T.wantsBalance<0 && <div style={{fontSize:11,color:C.rose,fontFamily:"'DM Mono',monospace",marginTop:5}}>⚠ Over budget by {currency(Math.abs(T.wantsBalance))}</div>}
              </div>
            </Panel>
            <Panel title="Transactions">
              {sortedExpenses.length===0 ? <EmptyState icon="💸" text="No expenses recorded yet" /> : (
                <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:450,overflowY:"auto"}}>
                  {sortedExpenses.map(e=>(
                    <div key={e.id} style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,.022)",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 13px"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{e.name}</div>
                        <div style={{fontSize:10,color:C.dim,fontFamily:"'DM Mono',monospace"}}>{e.tag} · {fmtDate(e.date)}</div>
                      </div>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,color:C.rose,margin:"0 9px"}}>-{currency(e.amount)}</span>
                      <DelBtn onClick={()=>delExpense(e.id)} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>}

        {/* ══════════ SAVINGS ══════════ */}
        {tab === "savings" && <div>
          <SectionHeader title="Savings" sub="Wealth Building" />
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14,marginBottom:22}}>
            <MetricCard color={C.teal} accent="#2a6b68" icon="💎" label="Total Savings" value={currency(T.savings)} sub="Accumulated" pct={100} pctColor={C.teal} pctLabel="Private Fund" />
            <MetricCard color={C.purple} accent="#3d2a5e" icon="📊" label="Investments" value={currency(T.savInv)} sub="Long-term" pct={T.savings>0?(T.savInv/T.savings)*100:0} pctColor={C.purple} pctLabel="Growth" />
            <MetricCard color={C.gold} accent={C.goldD} icon="🛡" label="Emergency" value={currency(T.savEm)} sub="Safety Net" pct={T.savings>0?(T.savEm/T.savings)*100:0} pctColor={C.gold} pctLabel="Stable" />
          </div>
          <Panel title="Contributions">
            {sortedSalaries.length===0 ? <EmptyState icon="🌱" text="No savings yet." /> : (
              <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:500,overflowY:"auto"}}>
                {sortedSalaries.map(e=>(
                  <div key={e.id} style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,.022)",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 13px"}}>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{fmtDate(e.date)}</div><div style={{fontSize:10,color:C.dim}}>{e.savingsTag}</div></div>
                    <span style={{fontFamily:"'DM Mono',monospace",color:C.purple}}>+{currency(e.savingsAlloc)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>}

        {/* ══════════ HISTORY ══════════ */}
        {tab === "history" && <div>
          <SectionHeader title="History" sub="Monthly Breakdown" />
          {groups.map(group=>{
                const gIncome  = group.entries.reduce((s,e)=>s+e.amount,0);
                const gSpent   = group.expenses.reduce((s,e)=>s+e.amount,0);
                const isOpen   = openMonth===group.key;
                return (
                  <div key={group.key} style={{background:C.surface,border:`1px solid ${isOpen?C.borderHi:C.border}`,borderRadius:13,marginBottom:10,overflow:"hidden"}}>
                    <div onClick={()=>setOpenMonth(isOpen?null:group.key)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"17px 22px",cursor:"pointer"}}>
                      <div><div style={{fontFamily:"'DM Serif Display',serif",fontSize:17}}>{monthKeyLabel(group.key)}</div></div>
                      <div style={{display:"flex",gap:18}}><div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.dim}}>INCOME</div><div style={{color:C.gold}}>{currency(gIncome)}</div></div></div>
                    </div>
                    {isOpen && <div style={{padding:"0 22px 22px",borderTop:`1px solid ${C.border}`}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:C.dim,margin:"14px 0 9px"}}>ENTRIES</div>
                      {group.entries.map(e=><SalaryEntryRow key={e.id} entry={e} style={{marginBottom:7}} />)}
                    </div>}
                  </div>
                );
          })}
        </div>}

      </div>
      <style>{`@keyframes si{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────
function MetricCard({color,accent,icon,label,value,sub,pct,pctColor,pctLabel,valueSize=23}) {
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:13,padding:24,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${accent},${color})`}} />
      <div style={{fontSize:17,marginBottom:11,opacity:.75}}>{icon}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,letterSpacing:2.5,textTransform:"uppercase",color:C.dim,marginBottom:7}}>{label}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:valueSize,fontWeight:500,color}}>{value}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:C.dim}}>{sub}</div>
      <div style={{marginTop:12}}>
        <div style={{height:3,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",background:`linear-gradient(90deg,${accent},${pctColor})`,width:`${Math.min(100,Math.max(0,pct))}%`}} />
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:C.dim,marginTop:4}}>{pctLabel}</div>
      </div>
    </div>
  );
}

function Panel({title,children}) {
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:13,padding:24}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,letterSpacing:2.5,textTransform:"uppercase",color:C.dim,marginBottom:16}}>{title}</div>
      {children}
    </div>
  );
}

function SectionHeader({title,sub}) {
  return (
    <div style={{display:"baseline",gap:12,marginBottom:24,display:"flex"}}>
      <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:27,color:C.text}}>{title}</h1>
      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:C.dim,letterSpacing:2.5}}>{sub}</span>
    </div>
  );
}

function FInput({style={},type="text",inputMode,placeholder,value,onChange,onKeyDown,required}) {
  return (
    <input type={type} inputMode={inputMode} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown} required={required}
      style={{flex:1,background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 13px",fontFamily:"inherit",fontSize:14,color:C.text,outline:"none",...style}}
    />
  );
}

function SalaryEntryRow({entry:e, onDelete, style={}}) {
  return (
    <div style={{background:"rgba(201,168,76,.035)",border:"1px solid rgba(201,168,76,.14)",borderRadius:8,padding:"13px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",...style}}>
      <div>
        <div style={{fontSize:10,color:C.dim}}>{fmtDate(e.date)}</div>
        <div style={{fontSize:17,color:C.gold}}>{currency(e.amount)}</div>
      </div>
      <div style={{display:"flex",gap:15}}>
        <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.dim}}>TITHE</div><div style={{color:C.gold}}>{currency(e.tithe)}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.dim}}>SAVINGS</div><div style={{color:C.purple}}>{currency(e.savingsAlloc)}</div></div>
      </div>
      {onDelete && <DelBtn onClick={onDelete} />}
    </div>
  );
}

function DelBtn({onClick}) {
  return (
    <button onClick={onClick} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,padding:"3px 7px"}}>✕</button>
  );
}

function ProgressBar({pct,color,left,right}) {
  return (
    <div style={{marginTop:11}}>
      <div style={{height:3,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",background:color,width:`${Math.min(100,Math.max(0,pct))}%`}} />
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.dim,marginTop:4}}>
        <span>{left}</span><span>{right}</span>
      </div>
    </div>
  );
}

function EmptyState({icon,text}) {
  return (
    <div style={{textAlign:"center",padding:"44px 20px"}}>
      <div style={{fontSize:32,marginBottom:12,opacity:.3}}>{icon}</div>
      <div style={{color:C.dim,fontSize:12,fontFamily:"'DM Mono',monospace",lineHeight:1.8,whiteSpace:"pre-line"}}>{text}</div>
    </div>
  );
}
