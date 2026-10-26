import { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabaseClient";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ─── Date helpers ─────────────────────────────────────────────────────────────
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseLocal = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDate = (iso) => parseLocal(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthKey = (iso) => { const d = parseLocal(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthKeyLabel = (k) => { const [y, m] = k.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
const monthShort = (k) => { const [y, m] = k.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "short" }); };
const addMonths = (k, delta) => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthsBetween = (a, b) => { const [ay, am] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number); return (by - ay) * 12 + (bm - am); };
const dayLabel = (iso) => {
  const today = localToday();
  if (iso === today) return "Today";
  const y = parseLocal(today); y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (iso === yIso) return "Yesterday";
  return parseLocal(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};
const currency = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(n || 0);
const compactINR = (n) => "₹" + new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

const readLocalArray = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// Expense categories — fixed order maps to the validated categorical palette (--cat-1…8)
const CATEGORIES = [
  { id: "General", icon: "tag", color: "var(--cat-1)" },
  { id: "Food", icon: "food", color: "var(--cat-2)" },
  { id: "Transport", icon: "car", color: "var(--cat-3)" },
  { id: "Bills", icon: "bolt", color: "var(--cat-4)" },
  { id: "Health", icon: "heart", color: "var(--cat-5)" },
  { id: "Entertainment", icon: "play", color: "var(--cat-6)" },
  { id: "Shopping", icon: "bag", color: "var(--cat-7)" },
  { id: "Other", icon: "box", color: "var(--cat-8)" },
];
const catMeta = (tag) => CATEGORIES.find(c => c.id === tag) || CATEGORIES[CATEGORIES.length - 1];

const TAB_IDS = ["dashboard", "expenses", "savings", "goals", "lending", "history"];
const tabFromHash = () => { const h = window.location.hash.slice(1); return TAB_IDS.includes(h) ? h : "dashboard"; };

const MOBILE_MQ = "(max-width: 960px)";
const subscribeMQ = (cb) => { const m = window.matchMedia(MOBILE_MQ); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useIsMobile = () => useSyncExternalStore(subscribeMQ, () => window.matchMedia(MOBILE_MQ).matches);

// Light tap feedback where supported (Android); silently ignored elsewhere
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

const GOAL_COLORS =["var(--c-ink)", "var(--c-lime)", "var(--c-blue)", "var(--c-orange)", "var(--c-green)", "var(--c-rose)"];

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
  const tithe = salaryEntries.reduce((s, e) => s + (e.tithe || 0), 0);
  const savings = salaryEntries.reduce((s, e) => s + (e.savingsAlloc || 0), 0);
  const savInv = salaryEntries.filter(e => e.savingsTag === "Investment").reduce((s, e) => s + (e.savingsAlloc || 0), 0);
  const savEm = salaryEntries.filter(e => e.savingsTag === "Emergency").reduce((s, e) => s + (e.savingsAlloc || 0), 0);
  const wants = salaryEntries.reduce((s, e) => s + (e.wantsAlloc || 0), 0);
  const spent = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  return { tithe, savings, savInv, savEm, wants, spent, wantsBalance: wants - spent };
}

function groupByMonth(salaryEntries, expenses) {
  const g = {};
  salaryEntries.forEach(e => { const k = monthKey(e.date); if (!g[k]) g[k] = { key: k, entries: [], expenses: [] }; g[k].entries.push(e); });
  expenses.forEach(e => { const k = monthKey(e.date); if (!g[k]) g[k] = { key: k, entries: [], expenses: [] }; g[k].expenses.push(e); });
  return Object.values(g).sort((a, b) => b.key.localeCompare(a.key));
}

// Groups an already-sorted list into consecutive day buckets
function groupByDay(list) {
  const out = [];
  list.forEach(item => {
    const last = out[out.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else out.push({ date: item.date, items: [item] });
  });
  return out;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const ICONS = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  receipt: <><path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  wallet: <><path d="M19 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 10h-5a2 2 0 0 0 0 4h5z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  swap: <><path d="M4 8h15l-4-4" /><path d="M20 16H5l4 4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  up: <path d="M7 17L17 7M8 7h9v9" />,
  down: <path d="M17 7L7 17M16 17H7V8" />,
  download: <><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chevDown: <path d="M6 9l6 6 6-6" />,
  chevLeft: <path d="M15 6l-6 6 6 6" />,
  chevRight: <path d="M9 6l6 6-6 6" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  heartHand: <><path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></>,
  tag: <><path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z" /><circle cx="8" cy="8" r="1.3" /></>,
  food: <><path d="M6 3v7a3 3 0 0 0 6 0V3M9 3v18" /><path d="M17 3c-2 2-2.5 6 0 8v10" /></>,
  car: <><path d="M3.5 16.5V12l2-5.5h13l2 5.5v4.5z" /><path d="M3.5 12h17" /><circle cx="7.5" cy="16.5" r="1.8" /><circle cx="16.5" cy="16.5" r="1.8" /></>,
  bolt: <path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z" />,
  heart: <path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" />,
  play: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5.5 3.5-5.5 3.5z" /></>,
  bag: <><path d="M5 8h14l-1 12.5H6z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>,
  box: <><path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9" /></>,
  income: <path d="M12 4v16M6 14l6 6 6-6" />,
};

function Icon({ name, size = 18, stroke = 1.8, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {ICONS[name]}
    </svg>
  );
}

function LogoMark({ size = 34 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="var(--lime)" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <path d="M6 18v-5M12 18V6M18 18v-8" />
      </svg>
    </span>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [err, setErr] = useState("");

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

  const ok = err.startsWith("✓");

  return (
    <div className="auth">
      <div className="auth__panel rise">
        <div className="auth__brand">
          <div className="brand" style={{ color: "var(--text-on-ink)" }}>
            <span className="logo-mark" style={{ background: "var(--lime)" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 18v-5M12 18V6M18 18v-8" /></svg>
            </span>
            FinFlow
          </div>
          <div>
            <h1 style={{ fontSize: 34, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.03em", marginBottom: 12 }}>Know where every rupee goes.</h1>
            <p style={{ color: "var(--text-on-ink-2)", fontSize: 15, lineHeight: "22px" }}>Income is split automatically into tithe, wants and savings, so you always know what's safe to spend.</p>
          </div>
          <div className="auth__features" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[["Automatic 10 / 45 / 45 split", "trend"], ["Synced securely to the cloud", "shield"], ["CSV & PDF statements", "download"]].map(([t, ic]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, fontWeight: 600 }}>
                <span className="quick__circle" style={{ width: 36, height: 36 }}><Icon name={ic} size={16} /></span>
                {t}
              </div>
            ))}
          </div>
        </div>

        <div className="auth__form">
          <h2 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 600, letterSpacing: "-0.02em" }}>{isSignUp ? "Create your account" : "Welcome back"}</h2>
          <p style={{ color: "var(--text-3)", marginTop: 4, marginBottom: 28 }}>{isSignUp ? "Start tracking your money in minutes." : "Sign in to your dashboard."}</p>

          <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label className="field">
              <span className="field__label">Email address</span>
              <input className="input" type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input className="input" type="password" placeholder="••••••••" autoComplete={isSignUp ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} required />
            </label>

            {err && (
              <div className={`alert fade ${ok ? "alert--pos" : "alert--neg"}`} role="status">
                <Icon name={ok ? "check" : "alert"} size={16} />
                <span>{ok ? err.slice(2) : err}</span>
              </div>
            )}

            <button type="submit" className="btn btn--primary btn--block" disabled={loading} style={{ marginTop: 6 }}>
              {loading ? <span className="spinner" /> : (isSignUp ? "Create account" : "Sign in")}
            </button>

            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setErr(""); }} className="btn btn--sm" style={{ color: "var(--text-2)" }}>
              {isSignUp ? "Already have an account? Sign in" : "No account yet? Sign up"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="loading">
      <LogoMark size={44} />
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="spinner" style={{ width: 14, height: 14 }} /> Loading your finances…</span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [salaryEntries, setSalaryEntries] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [goals, setGoals] = useState(() => readLocalArray('finflow_goals'));
  const [loans, setLoans] = useState(() => readLocalArray('finflow_loans'));
  const [tab, setTab] = useState(tabFromHash);
  const [openMonth, setOpenMonth] = useState(null);

  // Salary form
  const [sAmt, setSAmt] = useState("");
  const [sDate, setSDate] = useState(localToday);
  const [sTag, setSTag] = useState("Investment");
  const [incType, setIncType] = useState("Salary");

  // Expense form
  const [eName, setEName] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eDate, setEDate] = useState(localToday);
  const [eTag, setETag] = useState("General");

  // Expense list controls
  const [eQuery, setEQuery] = useState("");
  const [eFilter, setEFilter] = useState("All");
  const [eSort, setESort] = useState("newest");
  const [eLimit, setELimit] = useState(30);

  // Export form
  const [expType, setExpType] = useState("Month");
  const [expMonth, setExpMonth] = useState(monthKey(localToday()));
  const [expStart, setExpStart] = useState(localToday);
  const [expEnd, setExpEnd] = useState(localToday);

  // Goals form
  const [gName, setGName] = useState("");
  const [gTarget, setGTarget] = useState("");
  const [gColor, setGColor] = useState("var(--c-ink)");
  const [fundAmts, setFundAmts] = useState({});

  // Lending form
  const [lName, setLName] = useState("");
  const [lAmt, setLAmt] = useState("");
  const [lDate, setLDate] = useState(localToday);
  const [lNote, setLNote] = useState("");
  const [repayAmts, setRepayAmts] = useState({});

  // Chart controls
  const [flowRange, setFlowRange] = useState("6M");
  const [catScope, setCatScope] = useState("month");

  const incomeFormRef = useRef(null);

  // ── App-like navigation: hash-backed tabs (phone back gesture works), slide direction,
  //    per-tab scroll memory, bottom sheets, toasts, keyboard-aware bottom nav ──
  const isMobile = useIsMobile();
  const [dir, setDir] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const tabRef = useRef(tab);
  const sheetRef = useRef(sheet);
  const scrollPos = useRef({});

  useEffect(() => { tabRef.current = tab; sheetRef.current = sheet; });

  useEffect(() => {
    if (!window.history.state?.tab) window.history.replaceState({ tab: tabRef.current }, "", `#${tabRef.current}`);
    const onPop = (e) => {
      if (sheetRef.current) { setSheet(null); return; } // back closes the open sheet first
      const next = e.state?.tab || tabFromHash();
      const prev = tabRef.current;
      if (next === prev) return;
      scrollPos.current[prev] = window.scrollY;
      setDir(TAB_IDS.indexOf(next) > TAB_IDS.indexOf(prev) ? 1 : -1);
      setTab(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useLayoutEffect(() => { window.scrollTo(0, scrollPos.current[tab] || 0); }, [tab]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 56);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const isField = (el) => el?.matches?.("input:not([type=checkbox]):not([type=radio]), select, textarea");
    const root = document.documentElement;
    const onIn = (e) => { if (isField(e.target)) root.classList.add("kb-open"); };
    const onOut = () => setTimeout(() => { if (!isField(document.activeElement)) root.classList.remove("kb-open"); }, 60);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); root.classList.remove("kb-open"); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loaded) {
      localStorage.setItem('finflow_goals', JSON.stringify(goals));
      localStorage.setItem('finflow_loans', JSON.stringify(loans));
    }
  }, [goals, loans, loaded]);

  useEffect(() => {
    if (!session) return;
    loadData().then(data => { setSalaryEntries(data.salaryEntries); setExpenses(data.expenses); setLoaded(true); });
  }, [session]);

  const T = useMemo(() => computeTotals(salaryEntries, expenses), [salaryEntries, expenses]);
  const wPct = T.wants > 0 ? Math.min(100, (T.spent / T.wants) * 100) : 0;
  const groups = useMemo(() => groupByMonth(salaryEntries, expenses), [salaryEntries, expenses]);

  const prevAmt = parseFloat(sAmt) || 0;
  const hasPrev = prevAmt > 0;
  const isExtra = incType === "Extra";
  const pTithe = isExtra ? 0 : prevAmt * 0.1;
  const pWants = isExtra ? prevAmt : prevAmt * 0.9 * 0.5;
  const pSavings = isExtra ? 0 : prevAmt * 0.9 * 0.5;

  // ── Derived views (presentation only — totals above remain the source of truth) ──
  const curKey = monthKey(localToday());
  const prevKey = addMonths(curKey, -1);
  const monthOf = (k) => groups.find(g => g.key === k) || { key: k, entries: [], expenses: [] };
  const thisMonth = monthOf(curKey);
  const lastMonth = monthOf(prevKey);
  const mIncome = sum(thisMonth.entries, e => e.amount);
  const mSpent = sum(thisMonth.expenses, e => e.amount);
  const mSaved = sum(thisMonth.entries, e => e.savingsAlloc);
  const lmSpent = sum(lastMonth.expenses, e => e.amount);
  const spentDelta = lmSpent > 0 ? ((mSpent - lmSpent) / lmSpent) * 100 : null;

  const flowSeries = useMemo(() => {
    const nowKey = monthKey(localToday());
    const latest = groups[0]?.key && groups[0].key > nowKey ? groups[0].key : nowKey;
    const earliest = groups[groups.length - 1]?.key || latest;
    const n = flowRange === "6M" ? 6 : flowRange === "12M" ? 12 : Math.max(1, monthsBetween(earliest, latest) + 1);
    const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
    return Array.from({ length: n }, (_, i) => {
      const k = addMonths(latest, i - (n - 1));
      const g = byKey[k];
      return { key: k, label: monthShort(k), full: monthKeyLabel(k), income: g ? sum(g.entries, e => e.amount) : 0, spent: g ? sum(g.expenses, e => e.amount) : 0 };
    });
  }, [groups, flowRange]);
  const flowIncome = sum(flowSeries, d => d.income);
  const flowSpent = sum(flowSeries, d => d.spent);

  const catData = useMemo(() => {
    const nowKey = monthKey(localToday());
    const src = catScope === "month" ? expenses.filter(e => monthKey(e.date) === nowKey) : expenses;
    const totals = {};
    src.forEach(e => { const id = catMeta(e.tag).id === e.tag ? e.tag : "Other"; totals[id] = (totals[id] || 0) + (e.amount || 0); });
    const total = sum(Object.values(totals), v => v);
    const donut = CATEGORIES.filter(c => totals[c.id] > 0).map(c => ({ name: c.id, value: totals[c.id], color: c.color }));
    const legend = [...donut].sort((a, b) => b.value - a.value).map(d => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }));
    return { total, donut, legend };
  }, [expenses, catScope]);

  const activity = useMemo(() => {
    const items = [
      ...salaryEntries.map(s => ({ kind: "income", id: `s-${s.id}`, rawId: s.id, date: s.date, amount: s.amount, entry: s })),
      ...expenses.map(e => ({ kind: "expense", id: `e-${e.id}`, rawId: e.id, date: e.date, amount: e.amount, entry: e })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return groupByDay(items.slice(0, 8));
  }, [salaryEntries, expenses]);

  const savingsSeries = useMemo(() => {
    const nowKey = monthKey(localToday());
    const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
    return Array.from({ length: 12 }, (_, i) => {
      const k = addMonths(nowKey, i - 11);
      const g = byKey[k];
      return { key: k, label: monthShort(k), full: monthKeyLabel(k), saved: g ? sum(g.entries, e => e.savingsAlloc) : 0, current: k === nowKey };
    });
  }, [groups]);
  const savings12 = sum(savingsSeries, d => d.saved);

  const addSalary = async () => {
    const amount = parseFloat(sAmt);
    if (!amount || amount <= 0 || !sDate || !session) return;
    const isExtra = incType === "Extra";
    const tithe = isExtra ? 0 : +(amount * 0.1).toFixed(2);
    const wantsAlloc = isExtra ? amount : +(amount * 0.9 * 0.5).toFixed(2);
    const savingsAlloc = isExtra ? 0 : +(amount * 0.9 * 0.5).toFixed(2);
    const finalTag = isExtra ? "Extra" : sTag;

    const { data, error } = await supabase.from('salary_entries').insert([{
      user_id: session.user.id, date: sDate, amount, savings_tag: finalTag, tithe, wants_alloc: wantsAlloc, savings_alloc: savingsAlloc
    }]).select();
    if (!error && data) {
      setSalaryEntries(prev => [{ id: data[0].id, date: sDate, amount, savingsTag: finalTag, tithe, wantsAlloc, savingsAlloc }, ...prev]);
      setSAmt(""); setSDate(localToday());
      return true;
    }
    return false;
  };

  const delSalary = async (id) => {
    const { error } = await supabase.from('salary_entries').delete().eq('id', id);
    if (!error) setSalaryEntries(prev => prev.filter(e => e.id !== id));
    return !error;
  };

  const addExpense = async () => {
    const amount = parseFloat(eAmt);
    if (!amount || amount <= 0 || !eName.trim() || !session) return;
    const { data, error } = await supabase.from('expenses').insert([{
      user_id: session.user.id, date: eDate, name: eName.trim(), amount, tag: eTag
    }]).select();
    if (!error && data) {
      setExpenses(prev => [{ id: data[0].id, date: eDate, name: eName.trim(), amount, tag: eTag }, ...prev]);
      setEName(""); setEAmt(""); setEDate(localToday());
      return true;
    }
    return false;
  };

  const delExpense = async (id) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (!error) setExpenses(prev => prev.filter(e => e.id !== id));
    return !error;
  };

  const addGoal = () => {
    const target = parseFloat(gTarget);
    if (!target || target <= 0 || !gName.trim()) return;
    const newGoal = { id: crypto.randomUUID(), name: gName.trim(), target_amount: target, current_amount: 0, color: gColor };
    setGoals(prev => [newGoal, ...prev]);
    setGName(""); setGTarget("");
    return true;
  };

  const delGoal = (id) => {
    setGoals(prev => prev.filter(e => e.id !== id));
  };

  const fundGoal = (goal, amtStr) => {
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return;
    setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, current_amount: g.current_amount + amt } : g));
  };

  const addLoan = () => {
    const amount = parseFloat(lAmt);
    if (!amount || amount <= 0 || !lName.trim()) return;
    const newLoan = { id: crypto.randomUUID(), name: lName.trim(), amount, repaid_amount: 0, date: lDate, note: lNote, status: 'pending' };
    setLoans(prev => [newLoan, ...prev]);
    setLName(""); setLAmt(""); setLNote(""); setLDate(localToday());
    return true;
  };

  const markLoanRepaid = (id) => {
    setLoans(prev => prev.map(l => l.id === id ? { ...l, repaid_amount: l.amount, status: 'repaid' } : l));
  };

  const repayLoan = (id, amtStr) => {
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return;
    setLoans(prev => prev.map(l => {
      if (l.id === id) {
        const newRepaid = (l.repaid_amount || 0) + amt;
        const newStatus = newRepaid >= l.amount ? 'repaid' : 'pending';
        return { ...l, repaid_amount: newRepaid, status: newStatus };
      }
      return l;
    }));
  };

  const delLoan = (id) => {
    setLoans(prev => prev.filter(l => l.id !== id));
  };

  const downloadStatement = (format = 'csv') => {
    let s = [...salaryEntries], e = [...expenses];
    if (expType === "Month" && expMonth) {
      s = s.filter(x => monthKey(x.date) === expMonth);
      e = e.filter(x => monthKey(x.date) === expMonth);
    } else if (expType === "Date Range") {
      s = s.filter(x => x.date >= expStart && x.date <= expEnd);
      e = e.filter(x => x.date >= expStart && x.date <= expEnd);
    }

    const rows = [["Date", "Type", "Name/Tag", "Amount", "Allocations"]];
    s.forEach(x => {
      let alloc = x.savingsTag === "Extra" ? "" : `Tithe: ${x.tithe} | Wants: ${x.wantsAlloc} | Savings: ${x.savingsAlloc}`;
      rows.push([x.date, "Income", x.savingsTag, x.amount, alloc]);
    });
    e.forEach(x => {
      rows.push([x.date, "Expense", `${x.name} (${x.tag})`, `-${x.amount}`, ""]);
    });

    rows.sort((a, b) => {
      if (a[0] === "Date") return -1;
      if (b[0] === "Date") return 1;
      return b[0].localeCompare(a[0]);
    });

    if (format === 'csv') {
      const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Statement_${expType === "Month" ? expMonth : expStart + "_to_" + expEnd}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'pdf') {
      const doc = new jsPDF();
      doc.setFontSize(22);
      doc.text("FinFlow Statement", 14, 22);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);
      doc.text(`Period: ${expType === "Month" ? monthKeyLabel(expMonth) : `${fmtDate(expStart)} to ${fmtDate(expEnd)}`}`, 14, 36);

      doc.autoTable({
        startY: 42,
        head: [rows[0]],
        body: rows.slice(1),
        theme: 'grid',
        headStyles: { fillColor: [18, 19, 22], textColor: [210, 242, 75] },
        styles: { fontSize: 9 }
      });
      doc.save(`Statement_${expType === "Month" ? expMonth : expStart + "_to_" + expEnd}.pdf`);
    }
  };

  const handleSignOut = () => supabase.auth.signOut();
  const sortedSalaries = [...salaryEntries].sort((a, b) => b.date.localeCompare(a.date));

  // Expense list: search, category filter, sort
  const expenseView = useMemo(() => {
    const q = eQuery.trim().toLowerCase();
    let list = expenses.filter(e => (eFilter === "All" || e.tag === eFilter) && (!q || e.name?.toLowerCase().includes(q) || e.tag?.toLowerCase().includes(q)));
    const sorters = {
      newest: (a, b) => b.date.localeCompare(a.date),
      oldest: (a, b) => a.date.localeCompare(b.date),
      highest: (a, b) => b.amount - a.amount,
      lowest: (a, b) => a.amount - b.amount,
    };
    list = [...list].sort(sorters[eSort]);
    return { list, total: sum(list, e => e.amount) };
  }, [expenses, eQuery, eFilter, eSort]);

  if (!session) return <Auth />;
  if (!loaded) return <LoadingScreen />;

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: "grid" },
    { id: "expenses", label: "Expenses", icon: "receipt" },
    { id: "savings", label: "Savings", icon: "wallet" },
    { id: "goals", label: "Goals", icon: "target" },
    { id: "lending", label: "Lending", icon: "swap" },
    { id: "history", label: "History", icon: "clock" },
  ];

  const activeLoans = loans.filter(l => l.status === 'pending');
  const repaidLoans = loans.filter(l => l.status === 'repaid');
  const overBudget = T.wantsBalance < 0;

  const go = (id) => {
    if (id === tab) { window.scrollTo({ top: 0, behavior: "smooth" }); return; } // re-tap: back to top
    haptic();
    scrollPos.current[tab] = window.scrollY;
    setDir(TAB_IDS.indexOf(id) > TAB_IDS.indexOf(tab) ? 1 : -1);
    window.history.pushState({ tab: id }, "", `#${id}`);
    setTab(id);
  };
  const openSheet = (name) => { haptic(); window.history.pushState({ tab, sheet: name }, "", window.location.hash); setSheet(name); };
  const closeSheet = () => { if (window.history.state?.sheet) window.history.back(); else setSheet(null); };
  const notify = (msg, tone = "pos") => setToast((t) => ({ id: (t?.id ?? 0) + 1, msg, tone }));

  // Form submit / delete wrappers: same handlers, plus feedback
  const submitIncome = async () => { if (await addSalary()) { haptic(12); notify(isExtra ? "Extra income added" : "Salary recorded"); closeSheet(); } };
  const submitExpense = async () => { if (await addExpense()) { haptic(12); notify("Expense added"); closeSheet(); } };
  const submitGoal = () => { if (addGoal()) { haptic(12); notify("Goal created"); closeSheet(); } };
  const submitLoan = () => { if (addLoan()) { haptic(12); notify("Loan recorded"); closeSheet(); } };
  const removeSalary = async (id) => { haptic(14); notify(await delSalary(id) ? "Income entry deleted" : "Couldn't delete — try again", "neg"); };
  const removeExpense = async (id) => { haptic(14); notify(await delExpense(id) ? "Expense deleted" : "Couldn't delete — try again", "neg"); };

  const userName = session.user?.email?.split("@")[0] || "there";
  const pageTitle = tab === "dashboard" ? "Dashboard" : TABS.find(t => t.id === tab)?.label;
  const incomeHint = isExtra ? "Extra income goes 100% to your wants balance." : "Salary is split 10% tithe · 45% wants · 45% savings.";

  const renderIncomeForm = (inSheet) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {inSheet && (
        <div className="field">
          <Segmented options={["Salary", "Extra"]} value={incType} onChange={setIncType} label="Income type" />
          <span className="card__sub">{incomeHint}</span>
        </div>
      )}
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "2 1 220px" }}>
          <span className="field__label">Amount</span>
          <span className="input-wrap">
            <span className="input-prefix input-prefix--lg">₹</span>
            <input type="number" inputMode="decimal" enterKeyHint="done" placeholder="0.00" value={sAmt} onChange={e => setSAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && submitIncome()} className="input input--amount" />
          </span>
        </label>
        <div className="field" style={{ flex: "1 1 170px" }}>
          <span className="field__label">Date</span>
          <FinDateSelector value={sDate} onChange={setSDate} label="Income date" />
        </div>
      </div>

      {!isExtra && (
        <div className="field">
          <span className="field__label">Savings go to</span>
          <Segmented options={["Investment", "Emergency"]} value={sTag} onChange={setSTag} label="Savings destination" />
        </div>
      )}

      <div className="tile">
        <div className="stack" aria-hidden="true">
          {isExtra
            ? <span style={{ flexGrow: 1, background: "var(--lime-chart)" }} />
            : <>
              <span style={{ flexGrow: 10, background: "var(--text-3)" }} />
              <span style={{ flexGrow: 45, background: "var(--lime-chart)" }} />
              <span style={{ flexGrow: 45, background: "var(--ink)" }} />
            </>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, marginTop: 14 }}>
          {(isExtra
            ? [["Wants · 100%", pWants, "var(--lime-chart)"], ["New wants balance", T.wantsBalance + pWants, null]]
            : [["Tithe · 10%", pTithe, "var(--text-3)"], ["Wants · 45%", pWants, "var(--lime-chart)"], ["Savings · 45%", pSavings, "var(--ink)"], ["New wants balance", T.wantsBalance + pWants, null]]
          ).map(([lbl, val, col]) => (
            <div key={lbl}>
              <div className="legend__item eyebrow">{col && <span className="dot dot--sq" style={{ background: col }} />}{lbl}</div>
              <Money value={hasPrev || !col ? val : 0} className="money--md" style={{ marginTop: 2, color: hasPrev ? undefined : "var(--text-3)" }} />
            </div>
          ))}
        </div>
      </div>

      <button className={`btn btn--primary${inSheet ? " btn--block" : ""}`} onClick={submitIncome} disabled={!hasPrev} style={inSheet ? undefined : { alignSelf: "flex-start" }}>
        <Icon name="plus" size={16} /> Add {isExtra ? "extra income" : "salary"}
      </button>
    </div>
  );

  const expenseForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="field">
        <span className="field__label">Description</span>
        <input className="input" placeholder="e.g. Groceries" enterKeyHint="next" autoComplete="off" value={eName} onChange={e => setEName(e.target.value)} />
      </label>
      <div className="form-row">
        <label className="field">
          <span className="field__label">Amount</span>
          <span className="input-wrap">
            <span className="input-prefix">₹</span>
            <input className="input num" type="number" inputMode="decimal" enterKeyHint="done" placeholder="0.00" value={eAmt} onChange={e => setEAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && submitExpense()} />
          </span>
        </label>
        <div className="field">
          <span className="field__label">Date</span>
          <FinDateSelector value={eDate} onChange={setEDate} label="Expense date" />
        </div>
      </div>
      <div className="field">
        <span className="field__label">Category</span>
        <div className="chip-grid" role="group" aria-label="Category">
          {CATEGORIES.map(c => (
            <button key={c.id} type="button" className="chip" aria-pressed={eTag === c.id} onClick={() => { haptic(5); setETag(c.id); }}>
              <Icon name={c.icon} size={18} />
              <span>{c.id}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="btn btn--primary btn--block" onClick={submitExpense} disabled={!eName.trim() || !eAmt || parseFloat(eAmt) <= 0}>
        <Icon name="plus" size={16} /> Add expense
      </button>
      {overBudget && (
        <div className="alert alert--neg"><Icon name="alert" size={16} /><span>Over budget by {currency(Math.abs(T.wantsBalance))}</span></div>
      )}
    </div>
  );

  const goalForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="field">
        <span className="field__label">Name</span>
        <input className="input" placeholder="e.g. New car" enterKeyHint="next" autoComplete="off" value={gName} onChange={e => setGName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Target amount</span>
        <span className="input-wrap">
          <span className="input-prefix">₹</span>
          <input className="input num" type="number" inputMode="decimal" enterKeyHint="done" placeholder="0.00" value={gTarget} onChange={e => setGTarget(e.target.value)} onKeyDown={e => e.key === "Enter" && submitGoal()} />
        </span>
      </label>
      <div className="field">
        <span className="field__label">Colour</span>
        <div style={{ display: "flex", gap: 10, padding: "4px 2px" }} role="group" aria-label="Goal colour">
          {GOAL_COLORS.map(c => <button key={c} type="button" className="swatch" aria-pressed={gColor === c} aria-label={c.replace("var(--c-", "").replace(")", "")} onClick={() => setGColor(c)} style={{ background: c }} />)}
        </div>
      </div>
      <button className="btn btn--primary btn--block" onClick={submitGoal} disabled={!gName.trim() || !gTarget || parseFloat(gTarget) <= 0}>
        <Icon name="plus" size={16} /> Create goal
      </button>
    </div>
  );

  const loanForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="field">
        <span className="field__label">Person</span>
        <input className="input" placeholder="Name" enterKeyHint="next" autoComplete="off" value={lName} onChange={e => setLName(e.target.value)} />
      </label>
      <div className="form-row">
        <label className="field">
          <span className="field__label">Amount</span>
          <span className="input-wrap">
            <span className="input-prefix">₹</span>
            <input className="input num" type="number" inputMode="decimal" enterKeyHint="next" placeholder="0.00" value={lAmt} onChange={e => setLAmt(e.target.value)} />
          </span>
        </label>
        <div className="field">
          <span className="field__label">Date</span>
          <FinDateSelector value={lDate} onChange={setLDate} label="Loan date" />
        </div>
      </div>
      <label className="field">
        <span className="field__label">Note <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(optional)</span></span>
        <input className="input" placeholder="What was it for?" enterKeyHint="done" autoComplete="off" value={lNote} onChange={e => setLNote(e.target.value)} onKeyDown={e => e.key === "Enter" && submitLoan()} />
      </label>
      <button className="btn btn--primary btn--block" onClick={submitLoan} disabled={!lName.trim() || !lAmt || parseFloat(lAmt) <= 0}>
        <Icon name="plus" size={16} /> Record loan
      </button>
    </div>
  );

  const SHEETS = {
    income: { title: "Record income", body: renderIncomeForm(true) },
    expense: { title: "Add expense", body: expenseForm },
    goal: { title: "New goal", body: goalForm },
    loan: { title: "New loan", body: loanForm },
  };

  const salaryRowProps = (e, onDelete) => {
    const extra = e.savingsTag === "Extra";
    return {
      icon: "income",
      iconClass: extra ? "row__icon--lime" : "row__icon--ink",
      title: extra ? "Extra income" : `Salary · ${e.savingsTag}`,
      meta: extra ? `${fmtDate(e.date)} · 100% to wants` : `Tithe ${currency(e.tithe)} · Wants ${currency(e.wantsAlloc)} · Savings ${currency(e.savingsAlloc)}`,
      amount: e.amount, positive: true, onDelete, deleteLabel: "Delete income entry",
    };
  };
  const expenseRowProps = (e, onDelete, showDate = true) => {
    const c = catMeta(e.tag);
    return {
      icon: c.icon, iconColor: c.color, title: e.name,
      meta: showDate ? `${e.tag} · ${fmtDate(e.date)}` : e.tag,
      amount: e.amount, positive: false, onDelete, deleteLabel: `Delete expense ${e.name}`,
    };
  };

  return (
    <>
      <div className="shell">
        {/* ── Top bar ── */}
        <header className="topbar" data-scrolled={scrolled}>
          <div className="topbar__lead">
            <div className="brand"><LogoMark /> FinFlow</div>
            <div className="topbar__title" aria-hidden="true">{pageTitle}</div>
          </div>

          <nav className="topnav" aria-label="Primary">
            {TABS.map(({ id, label, icon }) => (
              <button key={id} className="topnav__item" aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
                <Icon name={icon} size={16} /> {label}
              </button>
            ))}
          </nav>

          <div className="topbar__end">
            <div className="user-chip" title={session.user?.email}>
              <span className="avatar">{userName.charAt(0)}</span>
              <span className="user-chip__name">{userName}</span>
            </div>
            <button className="icon-btn icon-btn--solid" onClick={handleSignOut} aria-label="Sign out" title="Sign out" style={{ width: 40, height: 40 }}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <main key="dashboard" className="page" style={{ "--dir": dir }}>
            <PageHeader title={`Hello, ${userName}`} sub={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} />

            <div className="dash">
              {/* Hero: spendable balance */}
              <section className="card card--ink on-ink a-hero" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 28 }}>
                <div>
                  <div className="eyebrow">Available to spend</div>
                  <Money value={T.wantsBalance} className="money--hero" style={{ marginTop: 6, color: overBudget ? "#ff8a80" : undefined }} />
                  <div className="card__sub" style={{ marginTop: 4 }}>Wants balance · {currency(T.wants)} allocated</div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
                    <span style={{ color: "var(--text-on-ink-2)" }}>Wants budget used</span>
                    <span className="num">{wPct.toFixed(0)}%</span>
                  </div>
                  <div className="meter" role="img" aria-label={`${wPct.toFixed(0)}% of wants budget used`}>
                    <div className={`meter__fill${overBudget ? " meter__fill--over" : ""}`} style={{ width: `${wPct}%` }} />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-on-ink-2)" }}>
                    <span className="num" style={{ color: "var(--text-on-ink)", fontWeight: 700 }}>{currency(T.spent)}</span> spent all time
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  <button className="quick" onClick={() => isMobile ? openSheet("income") : incomeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                    <span className="quick__circle"><Icon name="plus" /></span>Income
                  </button>
                  <button className="quick" onClick={() => isMobile ? openSheet("expense") : go("expenses")}>
                    <span className="quick__circle"><Icon name="up" /></span>Expense
                  </button>
                  <button className="quick" onClick={() => go("history")}>
                    <span className="quick__circle"><Icon name="download" /></span>Statement
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="eyebrow" style={{ marginBottom: 2 }}>Set aside</div>
                  {[
                    ["Investments", T.savInv, "trend", T.savings > 0 ? (T.savInv / T.savings) * 100 : 0],
                    ["Emergency fund", T.savEm, "shield", T.savings > 0 ? (T.savEm / T.savings) * 100 : 0],
                    ["Tithe given", T.tithe, "heartHand", null],
                  ].map(([lbl, val, ic, share]) => (
                    <div key={lbl} className="tile" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                      <span className="quick__circle" style={{ width: 36, height: 36 }}><Icon name={ic} size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--text-on-ink-2)", fontWeight: 600 }}>{lbl}</div>
                        <Money value={val} className="money--md" />
                      </div>
                      {share !== null && <span className="badge num">{share.toFixed(0)}%</span>}
                    </div>
                  ))}
                </div>
              </section>

              {/* Cash flow */}
              <section className="card a-flow">
                <div className="card__head">
                  <div>
                    <div className="card__title">Cash flow</div>
                    <div className="legend" style={{ marginTop: 8 }}>
                      <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--c-income)" }} />Income <b className="num" style={{ color: "var(--text)" }}>{currency(flowIncome)}</b></span>
                      <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--c-spent)" }} />Spent <b className="num" style={{ color: "var(--text)" }}>{currency(flowSpent)}</b></span>
                    </div>
                  </div>
                  <Segmented options={["6M", "12M", "All"]} value={flowRange} onChange={setFlowRange} label="Cash flow range" />
                </div>
                {flowIncome + flowSpent === 0 ? (
                  <EmptyState icon="trend" title="No activity in this period" text="Add income or expenses to see your monthly cash flow." />
                ) : (
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={flowSeries} barGap={3} barCategoryGap={flowSeries.length > 12 ? "18%" : "30%"} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--divider)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-3)", fontSize: 12, fontWeight: 600 }} interval="preserveStartEnd" minTickGap={8} />
                        <YAxis tickFormatter={compactINR} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--text-3)", fontSize: 12 }} />
                        <Tooltip cursor={{ fill: "var(--surface-2)", radius: 8 }} content={<ChartTooltip />} />
                        <Bar dataKey="income" name="Income" fill="var(--c-income)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                        <Bar dataKey="spent" name="Spent" fill="var(--c-spent)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              {/* This month */}
              <section className="card a-month">
                <div className="card__head" style={{ marginBottom: 12 }}>
                  <div>
                    <div className="card__title">This month</div>
                    <div className="card__sub">{monthKeyLabel(curKey)}</div>
                  </div>
                </div>
                <div className="list">
                  {[
                    ["Income", mIncome, "pos", `${thisMonth.entries.length} ${thisMonth.entries.length === 1 ? "entry" : "entries"}`],
                    ["Spent", mSpent, null, `${thisMonth.expenses.length} ${thisMonth.expenses.length === 1 ? "expense" : "expenses"}`],
                    ["Saved", mSaved, null, "45% of salary"],
                  ].map(([lbl, val, tone, meta]) => (
                    <div key={lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: lbl === "Income" ? 0 : "1px solid var(--divider)", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{lbl}</div>
                        <div className="stat__meta">{meta}</div>
                      </div>
                      <Money value={val} className={`money--lg ${tone || ""}`} />
                    </div>
                  ))}
                </div>
                <div className="tile" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  {spentDelta === null ? (
                    <span style={{ color: "var(--text-3)" }}>No spending recorded last month to compare.</span>
                  ) : (
                    <>
                      <span className={`badge ${spentDelta > 0 ? "badge--neg" : "badge--pos"}`}>
                        <Icon name={spentDelta > 0 ? "up" : "down"} size={12} stroke={2.4} />
                        <span className="num">{Math.abs(spentDelta).toFixed(0)}%</span>
                      </span>
                      <span style={{ color: "var(--text-2)" }}>{spentDelta > 0 ? "more" : "less"} spending than {monthShort(prevKey)} ({currency(lmSpent)})</span>
                    </>
                  )}
                </div>
              </section>

              {/* Spending breakdown */}
              <section className="card a-cats">
                <div className="card__head" style={{ marginBottom: 12 }}>
                  <div className="card__title">Spending by category</div>
                  <Segmented options={[["month", "Month"], ["all", "All time"]]} value={catScope} onChange={setCatScope} label="Category period" />
                </div>
                <CategoryBreakdown data={catData} />
              </section>

              {/* Record income */}
              <section className="card a-income desktop-only" ref={incomeFormRef}>
                <div className="card__head">
                  <div>
                    <div className="card__title">Record income</div>
                    <div className="card__sub">{incomeHint}</div>
                  </div>
                  <Segmented options={["Salary", "Extra"]} value={incType} onChange={setIncType} label="Income type" />
                </div>
                {renderIncomeForm(false)}
              </section>

              {/* Recent activity */}
              <section className="card a-activity">
                <div className="card__head" style={{ marginBottom: 12 }}>
                  <div className="card__title">Recent activity</div>
                  {activity.length > 0 && <button className="btn btn--sm btn--secondary" onClick={() => go("history")}>View all</button>}
                </div>
                {activity.length === 0 ? (
                  <EmptyState icon="clock" title="Nothing here yet" text="Record your first salary to get started. Your data is saved to your private cloud." />
                ) : (
                  <div className="list">
                    {activity.map(day => (
                      <div key={day.date}>
                        <div className="list__group">{dayLabel(day.date)}</div>
                        {day.items.map(it => it.kind === "income"
                          ? <TxRow key={it.id} {...salaryRowProps(it.entry, () => removeSalary(it.rawId))} />
                          : <TxRow key={it.id} {...expenseRowProps(it.entry, () => removeExpense(it.rawId), false)} />)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </main>
        )}

        {/* ══ EXPENSES ══ */}
        {tab === "expenses" && (
          <main key="expenses" className="page" style={{ "--dir": dir }}>
            <PageHeader title="Expenses" sub="Everything you've spent from your wants balance" action={() => openSheet("expense")} actionLabel="Add expense" />

            <section className="card card--flush" style={{ marginBottom: 16 }}>
              <div className="stat-strip">
                <Stat label="Spent this month" value={mSpent} meta={monthKeyLabel(curKey)} />
                <Stat label="Spent all time" value={T.spent} meta={`${expenses.length} expenses`} />
                <Stat label="Wants balance" value={T.wantsBalance} tone={overBudget ? "neg" : undefined} meta={overBudget ? "Over budget" : `${(100 - wPct).toFixed(0)}% of allocation left`} />
              </div>
            </section>

            <div className="split">
              <section className="card desktop-only">
                <div className="card__head"><div className="card__title">Add expense</div></div>
                {expenseForm}
              </section>

              <section className="card">
                <div className="card__head" style={{ marginBottom: 14 }}>
                  <div>
                    <div className="card__title">Transactions</div>
                    <div className="card__sub">{expenseView.list.length} shown · <span className="num">{currency(expenseView.total)}</span></div>
                  </div>
                </div>
                <div className="toolbar" style={{ marginBottom: 12 }}>
                  <span className="input-wrap grow">
                    <span className="input-icon"><Icon name="search" size={16} /></span>
                    <input className="input" placeholder="Search expenses" value={eQuery} onChange={e => { setEQuery(e.target.value); setELimit(30); }} aria-label="Search expenses" />
                  </span>
                  <select className="select" value={eFilter} onChange={e => { setEFilter(e.target.value); setELimit(30); }} aria-label="Filter by category">
                    <option value="All">All categories</option>
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                  <select className="select" value={eSort} onChange={e => setESort(e.target.value)} aria-label="Sort">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="highest">Highest amount</option>
                    <option value="lowest">Lowest amount</option>
                  </select>
                </div>

                {expenses.length === 0 ? <EmptyState icon="receipt" title="No expenses yet" text="Expenses you add will appear here, grouped by day." /> :
                  expenseView.list.length === 0 ? <EmptyState icon="search" title="No matches" text="Try a different search or category." /> : (
                    <div className="list">
                      {(eSort === "newest" || eSort === "oldest")
                        ? groupByDay(expenseView.list.slice(0, eLimit)).map(day => (
                          <div key={day.date}>
                            <div className="list__group" style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>{dayLabel(day.date)}</span>
                              <span className="num">{currency(sum(day.items, x => x.amount))}</span>
                            </div>
                            {day.items.map(e => <TxRow key={e.id} {...expenseRowProps(e, () => removeExpense(e.id), false)} />)}
                          </div>
                        ))
                        : expenseView.list.slice(0, eLimit).map(e => <TxRow key={e.id} {...expenseRowProps(e, () => removeExpense(e.id))} />)}
                      {expenseView.list.length > eLimit && (
                        <button className="btn btn--secondary btn--sm" style={{ alignSelf: "center", marginTop: 12 }} onClick={() => setELimit(l => l + 30)}>
                          Show more ({expenseView.list.length - eLimit} left)
                        </button>
                      )}
                    </div>
                  )}
              </section>
            </div>
          </main>
        )}

        {/* ══ SAVINGS ══ */}
        {tab === "savings" && (
          <main key="savings" className="page" style={{ "--dir": dir }}>
            <PageHeader title="Savings" sub="45% of every salary, set aside automatically" />
            <div className="split" style={{ marginBottom: 16 }}>
              <section className="card card--ink" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <div className="eyebrow">Total savings</div>
                  <Money value={T.savings} className="money--hero" style={{ marginTop: 6 }} />
                </div>
                <div>
                  <div className="stack" style={{ height: 12 }} role="img" aria-label="Savings split between investments and emergency fund">
                    {T.savings > 0
                      ? <>
                        <span style={{ flexGrow: T.savInv, background: "#ffffff" }} />
                        <span style={{ flexGrow: T.savEm, background: "var(--lime)" }} />
                      </>
                      : <span style={{ flexGrow: 1, background: "var(--ink-3)" }} />}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["Investments", T.savInv, "#ffffff", "trend"], ["Emergency fund", T.savEm, "var(--lime)", "shield"]].map(([lbl, val, col, ic]) => (
                    <div key={lbl} className="tile">
                      <div className="legend__item" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-on-ink-2)" }}><span className="dot dot--sq" style={{ background: col }} />{lbl}</div>
                      <Money value={val} className="money--lg" style={{ marginTop: 6 }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: "var(--text-on-ink-2)" }}>
                        <Icon name={ic} size={13} /><span className="num">{T.savings > 0 ? ((val / T.savings) * 100).toFixed(0) : 0}% of savings</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">Monthly contributions</div>
                    <div className="card__sub">Last 12 months · average <b className="num" style={{ color: "var(--text)" }}>{currency(savings12 / 12)}</b> per month</div>
                  </div>
                  <div className="legend">
                    <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--ink)" }} />Saved</span>
                    <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--lime-chart)" }} />This month</span>
                  </div>
                </div>
                {savings12 === 0 ? <EmptyState icon="wallet" title="No contributions in the last year" text="Savings appear here when you record a salary." /> : (
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={savingsSeries} barCategoryGap="28%" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--divider)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-3)", fontSize: 12, fontWeight: 600 }} interval="preserveStartEnd" minTickGap={4} />
                        <YAxis tickFormatter={compactINR} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--text-3)", fontSize: 12 }} />
                        <Tooltip cursor={{ fill: "var(--surface-2)", radius: 8 }} content={<ChartTooltip />} />
                        <Bar dataKey="saved" name="Saved" radius={[4, 4, 0, 0]} maxBarSize={28}>
                          {savingsSeries.map(d => <Cell key={d.key} fill={d.current ? "var(--lime-chart)" : "var(--ink)"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </div>

            <section className="card">
              <div className="card__head" style={{ marginBottom: 12 }}><div className="card__title">Contributions</div></div>
              {sortedSalaries.filter(e => e.savingsAlloc > 0).length === 0 ? <EmptyState icon="wallet" title="No savings yet" text="Record a salary and 45% will be saved here." /> : (
                <div className="list">
                  {sortedSalaries.filter(e => e.savingsAlloc > 0).map(e => (
                    <TxRow key={e.id} icon={e.savingsTag === "Investment" ? "trend" : "shield"} iconClass={e.savingsTag === "Investment" ? "row__icon--ink" : "row__icon--lime"}
                      title={e.savingsTag === "Investment" ? "Investments" : "Emergency fund"} meta={`${fmtDate(e.date)} · from ${currency(e.amount)} salary`} amount={e.savingsAlloc} positive />
                  ))}
                </div>
              )}
            </section>
          </main>
        )}

        {/* ══ GOALS ══ */}
        {tab === "goals" && (
          <main key="goals" className="page" style={{ "--dir": dir }}>
            <PageHeader title="Goals" sub="Targets you're saving toward" action={() => openSheet("goal")} actionLabel="New goal" />
            {goals.length > 0 && (
              <section className="card card--flush" style={{ marginBottom: 16 }}>
                <div className="stat-strip">
                  <Stat label="Saved toward goals" value={sum(goals, g => g.current_amount)} meta={`${goals.length} ${goals.length === 1 ? "goal" : "goals"}`} />
                  <Stat label="Total targets" value={sum(goals, g => g.target_amount)} meta={`${goals.filter(g => g.current_amount >= g.target_amount).length} completed`} />
                  <Stat label="Still to save" value={sum(goals, g => Math.max(0, g.target_amount - g.current_amount))} meta="Across all goals" />
                </div>
              </section>
            )}
            <div className="split">
              <section className="card desktop-only">
                <div className="card__head"><div className="card__title">New goal</div></div>
                {goalForm}
              </section>

              <section>
                {goals.length === 0 ? (
                  <div className="card"><EmptyState icon="target" title="No goals yet" text="Create a goal to track progress toward something you're saving for." /></div>
                ) : (
                  <div className="cards-2">
                    {goals.map(g => {
                      const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
                      const done = g.current_amount >= g.target_amount;
                      const amt = fundAmts[g.id] || "";
                      const submit = () => { fundGoal(g, amt); setFundAmts(p => ({ ...p, [g.id]: "" })); };
                      return (
                        <article key={g.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span className="row__icon" style={{ color: g.color || "var(--ink)", borderRadius: 12 }}><Icon name="target" size={20} /></span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="row__title" style={{ fontSize: 16 }}>{g.name}</div>
                              {done ? <span className="badge badge--pos" style={{ marginTop: 2 }}><Icon name="check" size={12} stroke={2.4} />Completed</span>
                                : <div className="row__meta">{currency(g.target_amount - g.current_amount)} to go</div>}
                            </div>
                            <button className="icon-btn icon-btn--danger" onClick={() => { haptic(14); delGoal(g.id); notify("Goal deleted"); }} aria-label={`Delete goal ${g.name}`} title="Delete goal"><Icon name="trash" size={16} /></button>
                          </div>
                          <div className="tile">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                              <Money value={g.current_amount} className="money--md" />
                              <span className="num" style={{ color: "var(--text-3)", fontSize: 13 }}>{currency(g.target_amount)}</span>
                            </div>
                            <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} progress`}>
                              <div className="progress__fill" style={{ width: `${pct}%`, background: g.color || "var(--ink)" }} />
                            </div>
                            <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, marginTop: 6 }} className="num">{pct.toFixed(0)}%</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span className="input-wrap" style={{ flex: 1 }}>
                              <span className="input-prefix">₹</span>
                              <input className="input num" style={{ height: 40 }} type="number" inputMode="decimal" placeholder="Add funds" value={amt}
                                onChange={e => setFundAmts(p => ({ ...p, [g.id]: e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} aria-label={`Amount to add to ${g.name}`} />
                            </span>
                            <button className="btn btn--accent btn--sm" style={{ height: 40 }} onClick={submit} disabled={!(parseFloat(amt) > 0)}>Add</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </main>
        )}

        {/* ══ LENDING ══ */}
        {tab === "lending" && (
          <main key="lending" className="page" style={{ "--dir": dir }}>
            <PageHeader title="Lending" sub="Money lent to friends & family" action={() => openSheet("loan")} actionLabel="New loan" />

            <section className="card card--flush" style={{ marginBottom: 16 }}>
              <div className="stat-strip">
                <Stat label="Outstanding" value={sum(activeLoans, l => l.amount - (l.repaid_amount || 0))} meta={`${activeLoans.length} active ${activeLoans.length === 1 ? "loan" : "loans"}`} />
                <Stat label="Repaid to date" value={sum(loans, l => l.repaid_amount || 0)} tone="pos" meta={`${repaidLoans.length} fully repaid`} />
                <Stat label="Total lent" value={sum(loans, l => l.amount)} meta="All loans on record" />
              </div>
            </section>

            <div className="split">
              <div className="stack-v">
                <section className="card desktop-only">
                  <div className="card__head"><div className="card__title">New loan</div></div>
                  {loanForm}
                </section>

                <section className="card">
                  <div className="card__head" style={{ marginBottom: 12 }}><div className="card__title">Repaid</div></div>
                  {repaidLoans.length === 0 ? <EmptyState icon="check" title="No repaid loans yet" text="Loans move here once they're paid back in full." /> : (
                    <div className="list">
                      {repaidLoans.map(l => (
                        <TxRow key={l.id} icon="check" iconClass="row__icon--lime" title={l.name} meta={`Lent ${fmtDate(l.date)}`} amount={l.amount} amountClass="pos" plain
                          onDelete={() => delLoan(l.id)} deleteLabel={`Delete loan record for ${l.name}`} />
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section>
                {activeLoans.length === 0 ? (
                  <div className="card"><EmptyState icon="swap" title="No active loans" text="Record money you've lent and track repayments as they come in." /></div>
                ) : (
                  <div className="cards-2">
                    {activeLoans.map(l => {
                      const repaid = l.repaid_amount || 0;
                      const pct = Math.min(100, (repaid / l.amount) * 100);
                      const amt = repayAmts[l.id] || "";
                      const submit = () => { repayLoan(l.id, amt); setRepayAmts(p => ({ ...p, [l.id]: "" })); };
                      return (
                        <article key={l.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                            <span className="avatar" style={{ width: 40, height: 40, fontSize: 15 }}>{l.name.charAt(0)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="row__title" style={{ fontSize: 16 }}>{l.name}</div>
                              <div className="row__meta">{fmtDate(l.date)}{l.note ? ` · ${l.note}` : ""}</div>
                            </div>
                            <button className="icon-btn icon-btn--danger" onClick={() => delLoan(l.id)} aria-label={`Delete loan to ${l.name}`} title="Delete loan"><Icon name="trash" size={16} /></button>
                          </div>
                          <div className="tile">
                            <div className="eyebrow">Still owed</div>
                            <Money value={l.amount - repaid} className="money--lg" style={{ marginTop: 2 }} />
                            <div className="progress" style={{ marginTop: 12 }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${l.name} repayment progress`}>
                              <div className="progress__fill" style={{ width: `${pct}%`, background: "var(--ink)" }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6, color: "var(--text-3)", fontWeight: 600 }} className="num">
                              <span>{currency(repaid)} repaid</span><span>of {currency(l.amount)}</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span className="input-wrap" style={{ flex: 1 }}>
                              <span className="input-prefix">₹</span>
                              <input className="input num" style={{ height: 40 }} type="number" inputMode="decimal" placeholder="Repayment" value={amt}
                                onChange={e => setRepayAmts(p => ({ ...p, [l.id]: e.target.value }))} onKeyDown={e => e.key === "Enter" && submit()} aria-label={`Repayment from ${l.name}`} />
                            </span>
                            <button className="btn btn--accent btn--sm" style={{ height: 40 }} onClick={submit} disabled={!(parseFloat(amt) > 0)}>Repay</button>
                          </div>
                          <button className="btn btn--outline btn--sm btn--block" onClick={() => { haptic(12); markLoanRepaid(l.id); notify(`${l.name} marked as repaid`); }}><Icon name="check" size={15} /> Mark fully repaid</button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </main>
        )}

        {/* ══ HISTORY ══ */}
        {tab === "history" && (
          <main key="history" className="page" style={{ "--dir": dir }}>
            <PageHeader title="History" sub="Month-by-month breakdown and statements" />

            <section className="card" style={{ marginBottom: 16 }}>
              <div className="card__head" style={{ marginBottom: 16 }}>
                <div>
                  <div className="card__title">Download statement</div>
                  <div className="card__sub">Income and expenses for a month or a custom range.</div>
                </div>
                <Segmented options={["Month", "Date Range"]} value={expType} onChange={setExpType} label="Statement period" />
              </div>
              <div className="toolbar" style={{ alignItems: "flex-end" }}>
                {expType === "Month" ? (
                  <label className="field grow" style={{ flex: "1 1 220px" }}>
                    <span className="field__label">Month</span>
                    <select className="select" value={expMonth} onChange={e => setExpMonth(e.target.value)}>
                      {[...new Set(groups.map(g => g.key))].map(k => <option key={k} value={k}>{monthKeyLabel(k)}</option>)}
                      {groups.length === 0 && <option value={expMonth}>{monthKeyLabel(expMonth)}</option>}
                    </select>
                  </label>
                ) : (
                  <div className="form-row" style={{ flex: "1 1 340px" }}>
                    <div className="field"><span className="field__label">From</span><FinDateSelector value={expStart} onChange={setExpStart} label="Start date" /></div>
                    <div className="field"><span className="field__label">To</span><FinDateSelector value={expEnd} onChange={setExpEnd} label="End date" /></div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn--primary" onClick={() => downloadStatement('csv')}><Icon name="download" size={16} /> CSV</button>
                  <button className="btn btn--secondary" onClick={() => downloadStatement('pdf')}><Icon name="download" size={16} /> PDF</button>
                </div>
              </div>
            </section>

            {groups.length === 0 ? <div className="card"><EmptyState icon="clock" title="No history yet" text="Your monthly summaries will build up here as you add income and expenses." /></div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {groups.map(group => {
                  const gIncome = group.entries.reduce((s, e) => s + e.amount, 0);
                  const gSpent = group.expenses.reduce((s, e) => s + e.amount, 0);
                  const gSaved = group.entries.reduce((s, e) => s + e.savingsAlloc, 0);
                  const isOpen = openMonth === group.key;
                  const [yy] = group.key.split("-");
                  return (
                    <div key={group.key} className="month" data-open={isOpen}>
                      <button className="month__head" onClick={() => setOpenMonth(isOpen ? null : group.key)} aria-expanded={isOpen}>
                        <span className="month__tile"><b>{monthShort(group.key)}</b><small>{yy}</small></span>
                        <span className="month__name" style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>{monthKeyLabel(group.key)}</span>
                          <span className="row__meta" style={{ display: "block" }}>{group.entries.length} income · {group.expenses.length} expenses</span>
                        </span>
                        <span className="month__figs">
                          {[["Income", gIncome, "pos"], ["Spent", gSpent, ""], ["Saved", gSaved, ""]].map(([lbl, v, tone]) => (
                            <span key={lbl} className="month__fig">
                              <span className="eyebrow" style={{ display: "block" }}>{lbl}</span>
                              <span className={`money num ${tone}`} style={{ fontWeight: 700, fontSize: 14 }}>{currency(v)}</span>
                            </span>
                          ))}
                        </span>
                        <span className="month__chev"><Icon name="chevDown" size={18} /></span>
                      </button>

                      {isOpen && (
                        <div className="month__body fade">
                          {group.entries.length > 0 && (
                            <>
                              <div className="list__group" style={{ paddingTop: 16 }}>Income</div>
                              <div className="list">
                                {group.entries.map(e => <TxRow key={e.id} {...salaryRowProps(e)} />)}
                              </div>
                            </>
                          )}
                          {group.expenses.length > 0 && (
                            <>
                              <div className="list__group" style={{ paddingTop: 16 }}>Expenses</div>
                              <div className="list">
                                {group.expenses.map(e => <TxRow key={e.id} {...expenseRowProps(e)} />)}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        )}
      </div>

      {/* Bottom pill nav (small screens) */}
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map(({ id, label, icon }) => (
          <button key={id} className="bottom-nav__item" aria-current={tab === id ? "page" : undefined} aria-label={label} onClick={() => go(id)}>
            <Icon name={icon} size={20} />
            <span className="bottom-nav__label" aria-hidden="true">{id === "dashboard" ? "Home" : label}</span>
          </button>
        ))}
      </nav>

      <Sheet open={!!sheet} onClose={closeSheet} title={SHEETS[sheet]?.title}>
        {SHEETS[sheet]?.body}
      </Sheet>

      {toast && createPortal(
        <div key={toast.id} className={`toast${toast.tone === "neg" ? " toast--neg" : ""}`} role="status" aria-live="polite">
          <span className="toast__icon"><Icon name={toast.tone === "neg" ? "alert" : "check"} size={14} stroke={2.6} /></span>
          {toast.msg}
        </div>, document.body)}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ title, sub, action, actionLabel }) {
  return (
    <div className="page-head" style={{ flexWrap: "nowrap", alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {action && createPortal(
        <button className="fab mobile-only" onClick={action}>
          <span className="fab__icon"><Icon name="plus" size={18} stroke={2.6} /></span>
          {actionLabel}
        </button>,
        document.body
      )}
    </div>
  );
}

// Bottom sheet on phones (dialog on wider screens). Drag the grabber down, tap the backdrop,
// press Escape or use the back gesture to dismiss.
function Sheet({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);

  // Keep it mounted through the exit animation
  if (open && !mounted) { setMounted(true); setClosing(false); }
  if (open && closing) setClosing(false);
  if (!open && mounted && !closing) setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => { setMounted(false); setClosing(false); setDrag(0); }, 230);
    return () => clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [mounted, onClose]);

  if (!mounted) return null;

  const onDown = (e) => {
    if (e.pointerType !== "touch") return;
    dragStart.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => { if (dragStart.current !== null) setDrag(Math.max(0, e.clientY - dragStart.current)); };
  const onUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    if (drag > 110) { setDrag(window.innerHeight); onClose(); }
    else setDrag(0);
  };

  return createPortal(
    <>
      <div className="sheet-backdrop" data-closing={closing} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-closing={closing && drag === 0}
        style={drag > 0 || dragging ? { transform: `translateY(${drag}px)`, transition: dragging ? "none" : "transform .25s var(--ease-out)", animation: "none" } : undefined}>
        <div className="sheet__grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="sheet__handle" />
          <div className="sheet__head">
            <div className="sheet__title">{title}</div>
            <button className="icon-btn" onClick={onClose} onPointerDown={e => e.stopPropagation()} aria-label="Close"><Icon name="plus" size={18} style={{ transform: "rotate(45deg)" }} /></button>
          </div>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </>,
    document.body
  );
}

// Currency with de-emphasised decimals: ₹1,23,456<span>.78</span>
function Money({ value, className = "", style }) {
  const s = currency(value);
  const i = s.lastIndexOf(".");
  return (
    <div className={`money ${className}`} style={style}>
      {i > -1 ? <>{s.slice(0, i)}<span className="money__dec">{s.slice(i)}</span></> : s}
    </div>
  );
}

function Stat({ label, value, meta, tone }) {
  return (
    <div className="stat">
      <div className="eyebrow">{label}</div>
      <Money value={value} className={`money--xl ${tone || ""}`} />
      {meta && <div className="stat__meta" style={{ width: "100%" }}>{meta}</div>}
    </div>
  );
}

// options: ["A","B"] or [["value","Label"], …]
function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return <button key={v} type="button" className="seg__opt" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>;
      })}
    </div>
  );
}

function TxRow({ icon, iconClass = "", iconColor, title, meta, amount, positive, plain, amountClass, onDelete, deleteLabel }) {
  const sign = plain ? "" : positive ? "+" : "−";
  // Touch: swipe left to reveal Delete; a long swipe deletes straight away
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);

  const onPointerDown = (e) => {
    if (!onDelete || e.pointerType !== "touch") return;
    start.current = { x: e.clientX, y: e.clientY, base: x, axis: null };
  };
  const onPointerMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") setDragging(true);
    }
    if (s.axis === "x") setX(Math.max(-180, Math.min(0, s.base + dx)));
  };
  const onPointerEnd = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== "x") { if (s && !s.axis && x < 0) setX(0); return; }
    setDragging(false);
    if (x < -150) { setX(0); onDelete(); }
    else setX(x < -44 ? -88 : 0);
  };

  const row = (
    <div className="row" style={onDelete ? { transform: `translateX(${x}px)` } : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <span className={`row__icon ${iconClass}`} style={iconColor ? { color: iconColor } : undefined}><Icon name={icon} size={18} /></span>
      <div className="row__body">
        <div className="row__title">{title}</div>
        <div className="row__meta">{meta}</div>
      </div>
      <div className="row__end">
        <div className={`row__amount ${amountClass || (positive ? "pos" : "")}`}>{sign}{currency(amount)}</div>
      </div>
      {onDelete && (
        <button className="icon-btn icon-btn--quiet icon-btn--danger row__action" onClick={onDelete} aria-label={deleteLabel} title="Delete">
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );

  if (!onDelete) return row;
  return (
    <div className="swipe" data-dragging={dragging} data-open={x < 0}>
      <button className="swipe__action" onClick={() => { setX(0); onDelete(); }} aria-label={deleteLabel} tabIndex={x < 0 ? 0 : -1} aria-hidden={x === 0}>
        <Icon name="trash" size={18} />Delete
      </button>
      {row}
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip__label">{d.full || d.name}</div>
      {payload.map(p => (
        <div key={p.dataKey || p.name} className="chart-tip__row">
          <span className="legend__item" style={{ color: "var(--text-on-ink-2)" }}>
            <span className="dot dot--sq" style={{ background: p.payload?.color || (p.dataKey === "saved" && d.current ? "var(--lime-chart)" : p.dataKey === "saved" ? "#fff" : p.color || p.fill) }} />
            {p.name}
          </span>
          <b>{currency(p.value)}</b>
        </div>
      ))}
      {d.pct !== undefined && <div className="chart-tip__row" style={{ color: "var(--text-on-ink-2)" }}><span>Share</span><b>{d.pct.toFixed(1)}%</b></div>}
    </div>
  );
}

function CategoryBreakdown({ data }) {
  if (data.total === 0) return <EmptyState icon="receipt" title="No spending in this period" text="Expenses you add will be broken down by category here." />;
  const legendByName = Object.fromEntries(data.legend.map(d => [d.name, d]));
  const donut = data.donut.map(d => ({ ...d, pct: legendByName[d.name].pct }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ position: "relative", width: 156, height: 156, flexShrink: 0, margin: "0 auto" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={donut} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={donut.length > 1 ? 1.5 : 0} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {donut.map(d => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span className="eyebrow">Total</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{compactINR(data.total)}</span>
        </div>
      </div>
      <div className="list" style={{ minWidth: 0 }}>
        {data.legend.map(d => (
          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13 }}>
            <span className="dot" style={{ background: d.color, width: 10, height: 10 }} />
            <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            <span className="num" style={{ color: "var(--text-3)", fontWeight: 600, width: 40, textAlign: "right" }}>{d.pct.toFixed(0)}%</span>
            <span className="num" style={{ fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{currency(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinDateSelector({ value, onChange, label = "Date" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const handleKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, []);

  const [y, m, d] = value ? value.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  const dateObj = new Date(y, m - 1, d);
  const [viewDate, setViewDate] = useState(new Date(y, m - 1, 1));

  const vy = viewDate.getFullYear();
  const vm = viewDate.getMonth();
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const firstDay = new Date(vy, vm, 1).getDay();

  const toggle = () => { if (!open) setViewDate(new Date(y, m - 1, 1)); setOpen(!open); };

  const handleDayClick = (day) => {
    const sel = `${vy}-${String(vm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(sel);
    setOpen(false);
  };

  const nextMonth = (e) => { e.preventDefault(); e.stopPropagation(); setViewDate(new Date(vy, vm + 1, 1)); };
  const prevMonth = (e) => { e.preventDefault(); e.stopPropagation(); setViewDate(new Date(vy, vm - 1, 1)); };

  const isToday = (day) => {
    const t = new Date();
    return t.getDate() === day && t.getMonth() === vm && t.getFullYear() === vy;
  };
  const isSelected = (day) => d === day && (m - 1) === vm && y === vy;

  return (
    <div className="datepick" ref={ref}>
      <button type="button" className="datepick__btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label={`${label}: ${fmtDate(value)}`}>
        <Icon name="calendar" size={16} />
        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </button>

      {open && <div className="datepick__backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div className="datepick__pop" role="dialog" aria-label={label}>
          <div className="datepick__head">
            <span>{viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={prevMonth} className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Previous month"><Icon name="chevLeft" size={16} /></button>
              <button type="button" onClick={nextMonth} className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Next month"><Icon name="chevRight" size={16} /></button>
            </div>
          </div>
          <div className="datepick__grid">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(x => <div key={x} className="datepick__dow">{x}</div>)}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`b-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const cls = isSelected(day) ? " datepick__day--sel" : isToday(day) ? " datepick__day--today" : "";
              return <button type="button" key={day} onClick={() => handleDayClick(day)} className={`datepick__day${cls}`} aria-pressed={isSelected(day)}>{day}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="empty">
      <span className="empty__icon"><Icon name={icon} size={20} /></span>
      {title && <div className="empty__title">{title}</div>}
      {text && <div className="empty__text">{text}</div>}
    </div>
  );
}
