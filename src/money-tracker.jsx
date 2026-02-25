import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── Date helpers ─────────────────────────────────────────────────────────────
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const parseLocal = (iso) => { const [y,m,d] = iso.split("-").map(Number); return new Date(y,m-1,d); };
const fmtDate  = (iso) => parseLocal(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const fmtMonth = (iso) => parseLocal(iso).toLocaleDateString("en-US",{month:"long",year:"numeric"});
const monthKey = (iso) => { const d=parseLocal(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthKeyLabel = (k) => { const [y,m]=k.split("-"); return new Date(+y,+m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); };
const currency = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(n||0);

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function loadData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { salaryEntries: [], expenses: [] };
  const [salRes, expRes] = await Promise.all([
    supabase.from('salary_entries').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('expenses').select('*').eq('user_id', user.id).order('date', { ascending: false })
  ]);
  return {
    salaryEntries: salRes.data?.map(s => ({ ...s, amount: parseFloat(s.amount), tithe: parseFloat(s.tithe), wantsAlloc: parseFloat(s.wants_alloc), savingsAlloc: parseFloat(s.savings_alloc), savingsTag: s.savings_tag })) || [],
    expenses: expRes.data?.map(e => ({ ...e, amount: parseFloat(e.amount) })) || []
  };
}

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
  salaryEntries.forEach(e => { const k=monthKey(e.date); if(!g[k])g[k]={key:k,entries:[],expenses:[]}; g[k].entries.push(e); });
  expenses.forEach(e => { const k=monthKey(e.date); if(!g[k])g[k]={key:k,entries:[],expenses:[]}; g[k].expenses.push(e); });
  return Object.values(g).sort((a,b)=>b.key.localeCompare(a.key));
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [err, setErr]         = useState("");
  const [focusedField, setFocusedField] = useState(null);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setErr("");
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    else if (isSignUp) setErr("✓ Check your email for a confirmation link.");
    setLoading(false);
  };

  return (
    <div style={{background:"var(--bg)",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,position:"relative",overflow:"hidden"}}>
      {/* Animated background orbs */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0}}>
        <div style={{position:"absolute",top:"15%",left:"20%",width:500,height:500,background:"radial-gradient(circle,rgba(240,192,64,.07) 0%,transparent 60%)",animation:"orb-move-1 12s ease-in-out infinite"}} />
        <div style={{position:"absolute",bottom:"10%",right:"15%",width:400,height:400,background:"radial-gradient(circle,rgba(45,226,213,.06) 0%,transparent 60%)",animation:"orb-move-2 15s ease-in-out infinite"}} />
        <div style={{position:"absolute",top:"50%",left:"60%",width:300,height:300,background:"radial-gradient(circle,rgba(167,139,250,.05) 0%,transparent 60%)",animation:"orb-move-1 18s 3s ease-in-out infinite"}} />
      </div>

      <div className="anim-fade-up" style={{width:"100%",maxWidth:420,position:"relative",zIndex:1}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:64,height:64,background:"var(--grad-gold)",borderRadius:18,marginBottom:18,boxShadow:"0 0 40px rgba(240,192,64,0.35)",animation:"float 6s ease-in-out infinite"}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V18h-2v-1.07C9.39 16.57 8 15.4 8 14c0-.55.45-1 1-1s1 .45 1 1c0 .48.64.68 1 .37V11H9V9h2V8h2v1h1a3 3 0 0 1 0 6h-1v1.93c1.52-.27 2.72-1.26 3-2.93z" fill="#050508"/>
            </svg>
          </div>
          <h1 style={{fontFamily:"var(--font-ui)",fontSize:34,fontWeight:800,letterSpacing:-1,color:"var(--text)",marginBottom:6}}>
            Fin<span style={{background:"var(--grad-gold)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>Flow</span>
          </h1>
          <p style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-dim)",letterSpacing:4,textTransform:"uppercase"}}>Wealth Intelligence</p>
        </div>

        {/* Card */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border-hi)",borderRadius:"var(--radius-xl)",padding:"36px 36px",backdropFilter:"blur(24px)",boxShadow:"0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset"}}>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:6,letterSpacing:-0.5}}>{isSignUp?"Create Account":"Welcome Back"}</h2>
          <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>{isSignUp?"Start tracking your wealth journey":"Sign in to your financial dashboard"}</p>

          <form onSubmit={handleAuth} style={{display:"flex",flexDirection:"column",gap:16}}>
            <AuthInput label="Email Address" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} focused={focusedField==="email"} onFocus={()=>setFocusedField("email")} onBlur={()=>setFocusedField(null)} required />
            <AuthInput label="Password" type="password" placeholder="••••••••••" value={password} onChange={e=>setPassword(e.target.value)} focused={focusedField==="password"} onFocus={()=>setFocusedField("password")} onBlur={()=>setFocusedField(null)} required />

            {err && (
              <div className="anim-fade-in" style={{fontSize:12,color:err.startsWith("✓")?"var(--teal)":"var(--rose)",background:err.startsWith("✓")?"var(--teal-dim)":"var(--rose-dim)",padding:"11px 14px",borderRadius:"var(--radius-sm)",border:`1px solid ${err.startsWith("✓")?"rgba(45,226,213,.2)":"rgba(255,94,126,.2)"}`}}>
                {err}
              </div>
            )}

            <GoldButton type="submit" disabled={loading} style={{marginTop:4}}>
              {loading ? <LoadingSpinner /> : (isSignUp ? "Create Account →" : "Sign In →")}
            </GoldButton>

            <button type="button" onClick={()=>{setIsSignUp(!isSignUp);setErr("");}} style={{background:"none",border:"none",color:"var(--text-mid)",fontSize:13,cursor:"pointer",paddingTop:4,transition:"color .2s"}}>
              {isSignUp ? "Already have an account? Sign In" : "No account yet? Sign Up"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AuthInput({ label, type, placeholder, value, onChange, focused, onFocus, onBlur, required }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <label style={{fontFamily:"var(--font-mono)",fontSize:10,color:focused?"var(--gold)":"var(--text-dim)",letterSpacing:2,textTransform:"uppercase",transition:"color .2s"}}>{label}</label>
      <input
        type={type} placeholder={placeholder} value={value} onChange={onChange}
        onFocus={onFocus} onBlur={onBlur} required={required}
        style={{
          background:"rgba(255,255,255,0.04)",
          border:`1px solid ${focused?"rgba(240,192,64,0.5)":"var(--border-hi)"}`,
          borderRadius:"var(--radius-sm)",
          padding:"13px 16px",
          fontFamily:"var(--font-ui)",fontSize:15,color:"var(--text)",outline:"none",
          transition:"all .25s var(--ease)",
          boxShadow:focused?"0 0 0 3px rgba(240,192,64,0.08)":"none"
        }}
      />
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{background:"var(--bg)",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
      <div style={{position:"relative",width:48,height:48}}>
        <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid var(--border)"}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid transparent",borderTopColor:"var(--gold)",animation:"spin 0.9s linear infinite"}} />
        </div>
      </div>
      <p style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-dim)",letterSpacing:3,textTransform:"uppercase",animation:"fadeIn 1s ease both"}}>Connecting to Cloud…</p>
    </div>
  );
}

function LoadingSpinner() {
  return <div style={{width:16,height:16,border:"2px solid rgba(5,5,8,.3)",borderTopColor:"#050508",borderRadius:"50%",animation:"spin 0.7s linear infinite",margin:"0 auto"}} />;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]     = useState(null);
  const [loaded, setLoaded]       = useState(false);
  const [salaryEntries, setSalaryEntries] = useState([]);
  const [expenses, setExpenses]   = useState([]);
  const [tab, setTab]             = useState("dashboard");
  const [openMonth, setOpenMonth] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);

  // Salary form
  const [sAmt,  setSAmt]  = useState("");
  const [sDate, setSDate] = useState(localToday);
  const [sTag,  setSTag]  = useState("Investment");

  // Expense form
  const [eName, setEName] = useState("");
  const [eAmt,  setEAmt]  = useState("");
  const [eDate, setEDate] = useState(localToday);
  const [eTag,  setETag]  = useState("General");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadData().then(data => { setSalaryEntries(data.salaryEntries); setExpenses(data.expenses); setLoaded(true); });
  }, [session]);

  const T = useMemo(() => computeTotals(salaryEntries, expenses), [salaryEntries, expenses]);
  const wPct = T.wants > 0 ? Math.min(100, (T.spent / T.wants) * 100) : 0;
  const groups = useMemo(() => groupByMonth(salaryEntries, expenses), [salaryEntries, expenses]);

  const prevAmt  = parseFloat(sAmt) || 0;
  const hasPrev  = prevAmt > 0;
  const pTithe   = prevAmt * 0.1;
  const pWants   = prevAmt * 0.9 * 0.5;
  const pSavings = prevAmt * 0.9 * 0.5;

  const addSalary = async () => {
    const amount = parseFloat(sAmt);
    if (!amount || amount <= 0 || !sDate || !session) return;
    const tithe = +(amount * 0.1).toFixed(2);
    const wantsAlloc = +(amount * 0.9 * 0.5).toFixed(2);
    const savingsAlloc = +(amount * 0.9 * 0.5).toFixed(2);
    const { data, error } = await supabase.from('salary_entries').insert([{
      user_id: session.user.id, date: sDate, amount, savings_tag: sTag, tithe, wants_alloc: wantsAlloc, savings_alloc: savingsAlloc
    }]).select();
    if (!error && data) {
      setSalaryEntries(prev => [{ id:data[0].id, date:sDate, amount, savingsTag:sTag, tithe, wantsAlloc, savingsAlloc }, ...prev]);
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
      user_id: session.user.id, date: eDate, name: eName.trim(), amount, tag: eTag
    }]).select();
    if (!error && data) {
      setExpenses(prev => [{ id:data[0].id, date:eDate, name:eName.trim(), amount, tag:eTag }, ...prev]);
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
  if (!loaded) return <LoadingScreen />;

  const TABS = [
    {id:"dashboard", label:"Dashboard", icon:"⊞"},
    {id:"expenses",  label:"Expenses",  icon:"◎"},
    {id:"savings",   label:"Savings",   icon:"◈"},
    {id:"history",   label:"History",   icon:"≡"},
  ];

  return (
    <div style={{background:"var(--bg)",minHeight:"100vh",color:"var(--text)",fontFamily:"var(--font-ui)",position:"relative"}}>
      {/* Global CSS */}
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes card-enter{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes bar-grow{from{width:0%}}
        @keyframes orb-move-1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(60px,-40px) scale(1.1)}}
        @keyframes orb-move-2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-50px,30px) scale(.9)}}
        @keyframes float{0%,100%{transform:translateY(0) rotate(0)}33%{transform:translateY(-8px) rotate(1deg)}66%{transform:translateY(-4px) rotate(-1deg)}}
        .ff-input:focus{border-color:rgba(240,192,64,.5)!important;box-shadow:0 0 0 3px rgba(240,192,64,.08)!important}
        .ff-btn-ghost:hover{background:rgba(255,255,255,.06)!important;color:var(--text)!important}
        .ff-tab:hover:not(.active){background:rgba(255,255,255,.04)!important;color:var(--text-mid)!important}
        .ff-row:hover{background:rgba(255,255,255,.035)!important;border-color:var(--border-hi)!important}
        .ff-del:hover{color:var(--rose)!important;background:var(--rose-dim)!important;border-radius:6px}
        .ff-month:hover{background:rgba(255,255,255,.03)!important}
        .ff-card:hover{border-color:var(--border-hi)!important;transform:translateY(-2px);box-shadow:0 16px 48px rgba(0,0,0,.5)!important}
        select option{background:var(--surface-2);color:var(--text)}
        .ff-gold-btn:hover{box-shadow:0 8px 32px rgba(240,192,64,.35)!important;transform:translateY(-1px)}
        .ff-gold-btn:active{transform:translateY(0)}
        .ff-tag-btn:hover{opacity:.85}
        @media(max-width:640px){
          .ff-nav-desktop{display:none!important}
          .ff-mobile-menu{display:flex!important}
        }
        @media(min-width:641px){
          .ff-mobile-toggle{display:none!important}
          .ff-mobile-overlay{display:none!important}
        }
      `}</style>

      {/* Ambient Orbs */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
        <div style={{position:"absolute",top:"-10%",right:"-5%",width:600,height:600,background:"radial-gradient(circle,rgba(240,192,64,.05) 0%,transparent 60%)",animation:"orb-move-1 16s ease-in-out infinite"}} />
        <div style={{position:"absolute",bottom:"-5%",left:"-5%",width:500,height:500,background:"radial-gradient(circle,rgba(45,226,213,.04) 0%,transparent 60%)",animation:"orb-move-2 20s ease-in-out infinite"}} />
      </div>

      {/* Main Container */}
      <div style={{maxWidth:1140,margin:"0 auto",padding:"0 20px 100px",position:"relative",zIndex:1}}>

        {/* ── NAV ── */}
        <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"22px 0 24px",marginBottom:32,borderBottom:"1px solid var(--border)",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:36,height:36,background:"var(--grad-gold)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 20px rgba(240,192,64,.3)"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V18h-2v-1.07C9.39 16.57 8 15.4 8 14c0-.55.45-1 1-1s1 .45 1 1c0 .48.64.68 1 .37V11H9V9h2V8h2v1h1a3 3 0 0 1 0 6h-1v1.93c1.52-.27 2.72-1.26 3-2.93z" fill="#050508"/></svg>
            </div>
            <div>
              <span style={{fontSize:20,fontWeight:800,letterSpacing:-0.5}}>Fin<span style={{background:"var(--grad-gold)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>Flow</span></span>
              <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:3,textTransform:"uppercase",marginTop:1}}>Wealth Tracker</div>
            </div>
          </div>

          {/* Desktop Tabs */}
          <div className="ff-nav-desktop" style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{display:"flex",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,padding:4,gap:2}}>
              {TABS.map(({id,label,icon}) => (
                <button key={id} className={`ff-tab${tab===id?" active":""}`} onClick={()=>setTab(id)} style={{
                  padding:"8px 20px",borderRadius:9,border:"none",
                  background:tab===id?"var(--surface-3)":"transparent",
                  color:tab===id?"var(--gold)":"var(--text-dim)",
                  fontSize:13,fontWeight:600,cursor:"pointer",letterSpacing:.2,
                  transition:"all .22s var(--ease)",
                  boxShadow:tab===id?"0 2px 8px rgba(0,0,0,.3)":"none",
                }}>{icon} {label}</button>
              ))}
            </div>
            <button onClick={handleSignOut} className="ff-btn-ghost" style={{background:"none",border:"1px solid var(--border)",color:"var(--text-dim)",fontSize:11,padding:"8px 14px",borderRadius:8,letterSpacing:1.5,textTransform:"uppercase",transition:"all .2s"}}>Out</button>
          </div>

          {/* Mobile Toggle */}
          <button className="ff-mobile-toggle" onClick={()=>setMobileNav(!mobileNav)} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",color:"var(--text-mid)",display:"none",flexDirection:"column",gap:4}}>
            <span style={{display:"block",width:18,height:2,background:"currentColor",borderRadius:1,transition:"transform .2s",transform:mobileNav?"rotate(45deg) translate(4px,4px)":"none"}} />
            <span style={{display:"block",width:18,height:2,background:"currentColor",borderRadius:1,opacity:mobileNav?0:1,transition:"opacity .2s"}} />
            <span style={{display:"block",width:18,height:2,background:"currentColor",borderRadius:1,transition:"transform .2s",transform:mobileNav?"rotate(-45deg) translate(4px,-4px)":"none"}} />
          </button>
        </nav>

        {/* Mobile Nav Dropdown */}
        {mobileNav && (
          <div className="ff-mobile-overlay anim-fade-up" style={{background:"var(--surface-2)",border:"1px solid var(--border-hi)",borderRadius:16,padding:12,marginBottom:24,display:"flex",flexDirection:"column",gap:4}}>
            {TABS.map(({id,label,icon}) => (
              <button key={id} onClick={()=>{setTab(id);setMobileNav(false);}} style={{
                display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:10,border:"none",
                background:tab===id?"var(--surface-3)":"transparent",
                color:tab===id?"var(--gold)":"var(--text-mid)",
                fontSize:14,fontWeight:600,cursor:"pointer",textAlign:"left",
                transition:"all .2s",
              }}>{icon} {label}</button>
            ))}
            <div style={{height:1,background:"var(--border)",margin:"4px 0"}} />
            <button onClick={handleSignOut} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:10,border:"none",background:"none",color:"var(--text-dim)",fontSize:14,cursor:"pointer"}}>← Sign Out</button>
          </div>
        )}

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <div key="dashboard">
            <PageHeader title="Dashboard" sub="All-Time Overview" />

            {/* Metric Cards */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14,marginBottom:28}}>
              {[
                { color:"var(--gold)",   grad:"var(--grad-gold)",   icon:"⛪", label:"Total Tithe",      value:currency(T.tithe),        sub:`${salaryEntries.length} entries`,           pct:salaryEntries.length?100:0, pctLabel:"10% of income",   delay:"delay-1" },
                { color:"var(--teal)",   grad:"var(--grad-teal)",   icon:"💳", label:"Wants Balance",    value:currency(T.wantsBalance),  sub:`of ${currency(T.wants)} allocated`,         pct:Math.max(0,100-wPct),       pctLabel:`${Math.max(0,100-wPct).toFixed(0)}% left`,  delay:"delay-2", negative:T.wantsBalance<0 },
                { color:"var(--violet)", grad:"var(--grad-violet)", icon:"📈", label:"Total Savings",    value:currency(T.savings),       sub:`Inv: ${currency(T.savInv)}`,                pct:T.savings>0?100:0,          pctLabel:"↑ Growing",       delay:"delay-3" },
                { color:"var(--rose)",   grad:"var(--grad-rose)",   icon:"🧾", label:"Total Spent",      value:currency(T.spent),         sub:`${expenses.length} expenses`,               pct:wPct,                       pctLabel:`${wPct.toFixed(0)}% of budget`, delay:"delay-4" },
              ].map(c => <MetricCard key={c.label} {...c} />)}
            </div>

            {/* Add Salary Panel */}
            <div className="anim-card delay-2" style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius-lg)",padding:28,marginBottom:22,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-100,right:-100,width:320,height:320,background:"radial-gradient(circle,rgba(240,192,64,.06) 0%,transparent 65%)",pointerEvents:"none"}} />
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:3,textTransform:"uppercase",color:"var(--text-dim)",marginBottom:6}}>Record Salary</div>
                  <div style={{fontSize:18,fontWeight:700,letterSpacing:-0.3}}>Add Income Entry</div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  {["Investment","Emergency"].map(t => (
                    <button key={t} className="ff-tag-btn" onClick={()=>setSTag(t)} style={{
                      padding:"7px 16px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
                      border:sTag===t?(t==="Investment"?"1px solid rgba(167,139,250,.4)":"1px solid rgba(240,192,64,.4)"):"1px solid var(--border-hi)",
                      background:sTag===t?(t==="Investment"?"var(--violet-dim)":"var(--gold-glow)"):"transparent",
                      color:sTag===t?(t==="Investment"?"var(--violet)":"var(--gold)"):"var(--text-dim)",
                      transition:"all .2s",
                    }}>{t}</button>
                  ))}
                </div>
              </div>

              <div style={{display:"flex",gap:10,alignItems:"stretch",flexWrap:"wrap"}}>
                <div style={{position:"relative",flex:1,minWidth:160}}>
                  <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontFamily:"var(--font-mono)",fontSize:20,color:"var(--gold)",pointerEvents:"none",zIndex:1}}>$</span>
                  <input type="number" inputMode="decimal" placeholder="0.00" value={sAmt} onChange={e=>setSAmt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSalary()} className="ff-input"
                    style={{width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid var(--border-hi)",borderRadius:"var(--radius-sm)",padding:"15px 14px 15px 42px",fontFamily:"var(--font-mono)",fontSize:24,fontWeight:500,color:"var(--text)",outline:"none",transition:"all .25s"}} />
                </div>
                <input type="date" value={sDate} onChange={e=>setSDate(e.target.value)} className="ff-input"
                  style={{background:"rgba(255,255,255,.04)",border:"1px solid var(--border-hi)",borderRadius:"var(--radius-sm)",padding:"15px 14px",fontFamily:"var(--font-mono)",fontSize:13,color:"var(--text)",outline:"none",minWidth:148,transition:"all .25s"}} />
                <GoldButton onClick={addSalary} disabled={!hasPrev}>Add Income</GoldButton>
              </div>

              {hasPrev && (
                <div className="anim-fade-in" style={{display:"flex",gap:20,marginTop:20,paddingTop:20,borderTop:"1px solid var(--border)",flexWrap:"wrap"}}>
                  {[["Tithe 10%",pTithe,"var(--gold)"],["Wants 45%",pWants,"var(--teal)"],["Savings 45%",pSavings,"var(--violet)"],["New Wants Balance",T.wantsBalance+pWants,"var(--teal)"]].map(([lbl,val,col])=>(
                    <div key={lbl}>
                      <div style={{fontFamily:"var(--font-mono)",fontSize:9,letterSpacing:2.5,textTransform:"uppercase",color:"var(--text-dim)",marginBottom:4}}>{lbl}</div>
                      <div style={{fontFamily:"var(--font-mono)",fontSize:16,fontWeight:500,color:col}}>{currency(val)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Salaries */}
            {sortedSalaries.length > 0 && (
              <Panel title="Recent Income Entries">
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto"}}>
                  {sortedSalaries.slice(0,8).map((e,i) => <SalaryRow key={e.id} entry={e} onDelete={()=>delSalary(e.id)} delay={i} />)}
                </div>
              </Panel>
            )}
            {salaryEntries.length === 0 && <EmptyState icon="💰" text={"Enter your first salary above to begin.\nData is saved to your private cloud."} />}
          </div>
        )}

        {/* ══ EXPENSES ══ */}
        {tab === "expenses" && (
          <div key="expenses">
            <PageHeader title="Expenses" sub="Spending Overview" />
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:18,marginBottom:8}}>
              <Panel title="Add Expense">
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <FInput placeholder="Expense name…" value={eName} onChange={e=>setEName(e.target.value)} />
                  <div style={{display:"flex",gap:8}}>
                    <FInput type="number" inputMode="decimal" placeholder="Amount" value={eAmt} onChange={e=>setEAmt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addExpense()} />
                    <FInput type="date" value={eDate} onChange={e=>setEDate(e.target.value)} style={{width:148,flex:"0 0 auto"}} />
                  </div>
                  <select value={eTag} onChange={e=>setETag(e.target.value)} className="ff-input"
                    style={{background:"rgba(255,255,255,.04)",border:"1px solid var(--border-hi)",borderRadius:"var(--radius-sm)",padding:"11px 14px",fontFamily:"var(--font-ui)",fontSize:14,color:"var(--text)",outline:"none",cursor:"pointer",transition:"all .25s"}}>
                    {["General","Food","Transport","Bills","Health","Entertainment","Shopping","Other"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <TealButton onClick={addExpense} disabled={!eName.trim()||!eAmt||parseFloat(eAmt)<=0}>+ Add Expense</TealButton>
                  {T.wantsBalance < 0 && <div style={{fontSize:11,color:"var(--rose)",fontFamily:"var(--font-mono)",marginTop:2}}>⚠ Over budget by {currency(Math.abs(T.wantsBalance))}</div>}
                </div>
              </Panel>

              <Panel title="Transactions">
                {sortedExpenses.length === 0 ? <EmptyState icon="💸" text="No expenses recorded yet" /> : (
                  <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:460,overflowY:"auto"}}>
                    {sortedExpenses.map((e,i) => (
                      <div key={e.id} className="ff-row" style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,.026)",border:"1px solid var(--border)",borderRadius:10,padding:"11px 14px",transition:"all .2s",gap:10}}>
                        <div style={{width:32,height:32,borderRadius:8,background:"var(--rose-dim)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                          {tagIcon(e.tag)}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:600,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.name}</div>
                          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{e.tag} · {fmtDate(e.date)}</div>
                        </div>
                        <span style={{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:600,color:"var(--rose)",flexShrink:0}}>-{currency(e.amount)}</span>
                        <button className="ff-del" onClick={()=>delExpense(e.id)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",fontSize:11,padding:"5px 8px",transition:"all .2s",flexShrink:0}}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        )}

        {/* ══ SAVINGS ══ */}
        {tab === "savings" && (
          <div key="savings">
            <PageHeader title="Savings" sub="Wealth Building" />
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:24}}>
              {[
                { color:"var(--teal)",   grad:"var(--grad-teal)",   icon:"💎", label:"Total Savings",  value:currency(T.savings), sub:"Accumulated",  pct:100,                                       pctLabel:"Private Fund", delay:"delay-1" },
                { color:"var(--violet)", grad:"var(--grad-violet)", icon:"📊", label:"Investments",    value:currency(T.savInv),  sub:"Long-term",    pct:T.savings>0?(T.savInv/T.savings)*100:0,    pctLabel:"Growth",       delay:"delay-2" },
                { color:"var(--gold)",   grad:"var(--grad-gold)",   icon:"🛡", label:"Emergency Fund", value:currency(T.savEm),   sub:"Safety Net",   pct:T.savings>0?(T.savEm/T.savings)*100:0,     pctLabel:"Stable",       delay:"delay-3" },
              ].map(c => <MetricCard key={c.label} {...c} />)}
            </div>
            <Panel title="Savings Contributions">
              {sortedSalaries.length === 0 ? <EmptyState icon="🌱" text="No savings yet." /> : (
                <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:500,overflowY:"auto"}}>
                  {sortedSalaries.map(e => (
                    <div key={e.id} className="ff-row" style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,.026)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",transition:"all .2s",gap:12}}>
                      <div style={{width:36,height:36,borderRadius:9,background:e.savingsTag==="Investment"?"var(--violet-dim)":"var(--gold-glow)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>
                        {e.savingsTag==="Investment"?"📊":"🛡"}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{fmtDate(e.date)}</div>
                        <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{e.savingsTag}</div>
                      </div>
                      <span style={{fontFamily:"var(--font-mono)",fontSize:14,color:e.savingsTag==="Investment"?"var(--violet)":"var(--gold)",fontWeight:600}}>+{currency(e.savingsAlloc)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* ══ HISTORY ══ */}
        {tab === "history" && (
          <div key="history">
            <PageHeader title="History" sub="Monthly Breakdown" />
            {groups.length === 0 && <EmptyState icon="📅" text="No history yet." />}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {groups.map((group,gi) => {
                const gIncome = group.entries.reduce((s,e)=>s+e.amount,0);
                const gSpent  = group.expenses.reduce((s,e)=>s+e.amount,0);
                const gSaved  = group.entries.reduce((s,e)=>s+e.savingsAlloc,0);
                const isOpen  = openMonth===group.key;
                return (
                  <div key={group.key} className="anim-card" style={{animationDelay:`${gi*0.04}s`,background:"var(--surface)",border:`1px solid ${isOpen?"var(--border-hi)":"var(--border)"}`,borderRadius:"var(--radius)",overflow:"hidden",transition:"border-color .2s"}}>
                    <div className="ff-month" onClick={()=>setOpenMonth(isOpen?null:group.key)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px",cursor:"pointer",transition:"background .18s",gap:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:14}}>
                        <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,rgba(240,192,64,.15),rgba(240,192,64,.06))",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-mono)",fontSize:11,color:"var(--gold)",fontWeight:600,flexShrink:0}}>
                          {group.key.split("-")[1]}
                        </div>
                        <div>
                          <div style={{fontSize:16,fontWeight:700,letterSpacing:-0.3}}>{monthKeyLabel(group.key)}</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-dim)",marginTop:2}}>{group.entries.length} entries · {group.expenses.length} expenses</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:2,textTransform:"uppercase"}}>Income</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--gold)",fontWeight:600}}>{currency(gIncome)}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:2,textTransform:"uppercase"}}>Spent</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--rose)",fontWeight:600}}>{currency(gSpent)}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:2,textTransform:"uppercase"}}>Saved</div>
                          <div style={{fontFamily:"var(--font-mono)",fontSize:15,color:"var(--violet)",fontWeight:600}}>{currency(gSaved)}</div>
                        </div>
                        <div style={{fontSize:12,color:"var(--text-dim)",transition:"transform .2s",transform:isOpen?"rotate(90deg)":"none"}}>▶</div>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="anim-fade-in" style={{padding:"0 22px 22px",borderTop:"1px solid var(--border)"}}>
                        {group.entries.length > 0 && (
                          <>
                            <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:3,textTransform:"uppercase",margin:"18px 0 10px"}}>Income Entries</div>
                            <div style={{display:"flex",flexDirection:"column",gap:7}}>
                              {group.entries.map(e => <SalaryRow key={e.id} entry={e} />)}
                            </div>
                          </>
                        )}
                        {group.expenses.length > 0 && (
                          <>
                            <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:3,textTransform:"uppercase",margin:"18px 0 10px"}}>Expenses</div>
                            <div style={{display:"flex",flexDirection:"column",gap:7}}>
                              {group.expenses.map(e => (
                                <div key={e.id} style={{display:"flex",alignItems:"center",background:"rgba(255,94,126,.04)",border:"1px solid rgba(255,94,126,.1)",borderRadius:9,padding:"10px 14px",gap:10}}>
                                  <span style={{fontSize:14}}>{tagIcon(e.tag)}</span>
                                  <div style={{flex:1}}>
                                    <div style={{fontSize:13,fontWeight:600}}>{e.name}</div>
                                    <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{e.tag} · {fmtDate(e.date)}</div>
                                  </div>
                                  <span style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--rose)",fontWeight:600}}>-{currency(e.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Mobile Tab Bar */}
      <div style={{display:"none",position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,10,16,.92)",backdropFilter:"blur(20px)",borderTop:"1px solid var(--border)",padding:"10px 0 18px",zIndex:100}} className="ff-mobile-menu">
        {TABS.map(({id,label,icon})=>(
          <button key={id} onClick={()=>{setTab(id);setMobileNav(false);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",color:tab===id?"var(--gold)":"var(--text-dim)",fontSize:11,fontWeight:600,cursor:"pointer",padding:"6px 0",transition:"color .2s"}}>
            <span style={{fontSize:18}}>{icon}</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:9,letterSpacing:1,textTransform:"uppercase"}}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ color, grad, icon, label, value, sub, pct, pctLabel, delay="", negative=false }) {
  return (
    <div className={`ff-card anim-card ${delay}`} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:22,position:"relative",overflow:"hidden",cursor:"default",transition:"all .3s var(--ease)",boxShadow:"0 4px 24px rgba(0,0,0,.3)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:grad,opacity:0.8}} />
      <div style={{position:"absolute",bottom:-40,right:-40,width:120,height:120,background:`radial-gradient(circle,${color.replace("var(","").replace(")","")==="--gold"?"rgba(240,192,64,.07)":color.includes("teal")?"rgba(45,226,213,.07)":color.includes("violet")?"rgba(167,139,250,.07)":"rgba(255,94,126,.07)"} 0%,transparent 65%)`,pointerEvents:"none"}} />
      <div style={{fontSize:20,marginBottom:12,opacity:.85}}>{icon}</div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:9,letterSpacing:2.5,textTransform:"uppercase",color:"var(--text-dim)",marginBottom:6}}>{label}</div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:22,fontWeight:600,color:negative?"var(--rose)":color,letterSpacing:-0.5,marginBottom:4,animation:"number-count .4s var(--ease) both"}}>{value}</div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-dim)",marginBottom:12}}>{sub}</div>
      <div style={{height:3,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",background:negative?"var(--rose)":grad,width:`${Math.min(100,Math.max(0,pct))}%`,borderRadius:2,animation:"bar-grow .8s var(--ease) both"}} />
      </div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",marginTop:4}}>{pctLabel}</div>
    </div>
  );
}

function Panel({ title, children, accentColor }) {
  return (
    <div className="anim-card" style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:22,position:"relative",overflow:"hidden"}}>
      {accentColor && <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:accentColor,opacity:.5}} />}
      <div style={{fontFamily:"var(--font-mono)",fontSize:10,fontWeight:600,letterSpacing:2.5,textTransform:"uppercase",color:"var(--text-dim)",marginBottom:16}}>{title}</div>
      {children}
    </div>
  );
}

function PageHeader({ title, sub }) {
  return (
    <div className="anim-fade-up" style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:24}}>
      <h1 style={{fontSize:28,fontWeight:800,letterSpacing:-1,color:"var(--text)"}}>{title}</h1>
      <span style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-dim)",letterSpacing:2.5,textTransform:"uppercase"}}>{sub}</span>
    </div>
  );
}

function FInput({ style={}, type="text", inputMode, placeholder, value, onChange, onKeyDown, required }) {
  return (
    <input type={type} inputMode={inputMode} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown} required={required} className="ff-input"
      style={{flex:1,background:"rgba(255,255,255,.04)",border:"1px solid var(--border-hi)",borderRadius:"var(--radius-sm)",padding:"12px 14px",fontFamily:"var(--font-ui)",fontSize:14,color:"var(--text)",outline:"none",transition:"all .25s var(--ease)",...style}}
    />
  );
}

function SalaryRow({ entry:e, onDelete, delay=0 }) {
  return (
    <div className="ff-row" style={{background:"rgba(240,192,64,.035)",border:"1px solid rgba(240,192,64,.12)",borderRadius:10,padding:"13px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",transition:"all .2s",gap:10}}>
      <div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:10,color:"var(--text-dim)",marginBottom:3}}>{fmtDate(e.date)}</div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:18,color:"var(--gold)",fontWeight:600}}>{currency(e.amount)}</div>
      </div>
      <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:1.5}}>Tithe</div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--gold)"}}>{currency(e.tithe)}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:1.5}}>Savings</div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--violet)"}}>{currency(e.savingsAlloc)}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:1.5}}>Tag</div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:11,color:e.savingsTag==="Investment"?"var(--violet)":"var(--gold)"}}>{e.savingsTag}</div>
        </div>
      </div>
      {onDelete && <button className="ff-del" onClick={onDelete} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",fontSize:11,padding:"5px 8px",transition:"all .2s",flexShrink:0}}>✕</button>}
    </div>
  );
}

function GoldButton({ children, onClick, disabled, type, style={} }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="ff-gold-btn"
      style={{background:disabled?"rgba(255,255,255,.06)":"var(--grad-gold)",border:"none",borderRadius:"var(--radius-sm)",padding:"14px 26px",fontSize:14,fontWeight:700,color:disabled?"var(--text-dim)":"#050508",cursor:disabled?"not-allowed":"pointer",transition:"all .25s var(--ease)",boxShadow:disabled?"none":"0 4px 16px rgba(240,192,64,.25)",whiteSpace:"nowrap",...style}}>
      {children}
    </button>
  );
}

function TealButton({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{background:disabled?"rgba(255,255,255,.04)":"rgba(45,226,213,.1)",border:`1px solid ${disabled?"var(--border)":"rgba(45,226,213,.28)"}`,borderRadius:"var(--radius-sm)",padding:"12px 18px",fontSize:13,fontWeight:700,color:disabled?"var(--text-dim)":"var(--teal)",cursor:disabled?"not-allowed":"pointer",transition:"all .2s"}}>
      {children}
    </button>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="anim-fade-in" style={{textAlign:"center",padding:"52px 20px"}}>
      <div style={{fontSize:36,marginBottom:14,opacity:.25,animation:"float 4s ease-in-out infinite"}}>{icon}</div>
      <div style={{color:"var(--text-dim)",fontSize:12,fontFamily:"var(--font-mono)",lineHeight:1.9,whiteSpace:"pre-line"}}>{text}</div>
    </div>
  );
}

function tagIcon(tag) {
  const map = { Food:"🍔", Transport:"🚗", Bills:"⚡", Health:"❤️", Entertainment:"🎬", Shopping:"🛍", General:"📌", Other:"📦" };
  return map[tag] || "📌";
}
