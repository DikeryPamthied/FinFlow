import { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabaseClient";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable'; // v5: called as autoTable(doc, …), no longer patched onto jsPDF

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
const num = (n) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
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
// Suggested need/want for each category when adding an expense (the person can change it)
const NEED_CATEGORIES = ["Food", "Transport", "Bills", "Health"];
const kindFor = (tag) => (NEED_CATEGORIES.includes(tag) ? "need" : "want");

// Budget plan defaults: 10% tithe off the top, then half of what's left to savings and half to spend.
// needsShare is the needs part of the spending half (wants get the rest).
const DEFAULT_PLAN = { titheOn: true, tithePct: 10, savingsPct: 50, needsShare: 50, saved: false };
const pctOf = (v) => Math.max(0, Math.min(100, parseFloat(v) || 0));
const REPAY_OPTIONS = [["both", "Both equally"], ["need", "Needs"], ["want", "Wants"]];
const DESTINATIONS = { Emergency: { label: "Emergency fund", icon: "shield" }, Investment: { label: "Investments", icon: "trend" } };

const TAB_IDS = ["dashboard", "expenses", "savings", "goals", "lending", "history"];
const tabFromHash = () => { const h = window.location.hash.slice(1); return TAB_IDS.includes(h) ? h : "dashboard"; };

const MOBILE_MQ = "(max-width: 960px)";
const subscribeMQ = (cb) => { const m = window.matchMedia(MOBILE_MQ); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useIsMobile = () => useSyncExternalStore(subscribeMQ, () => window.matchMedia(MOBILE_MQ).matches);

// Light tap feedback where supported (Android); silently ignored elsewhere
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

const GOAL_COLORS =["var(--c-ink)", "var(--c-lime)", "var(--c-blue)", "var(--c-orange)", "var(--c-green)", "var(--c-rose)"];

// ─── Supabase helpers ─────────────────────────────────────────────────────────
// Overlapping loads (an auth event right after start-up) share one request, so the one-time upload below runs once
let loadingData = null;
const loadData = () => (loadingData ??= fetchData().finally(() => { loadingData = null; }));

async function fetchData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { salaryEntries: [], expenses: [], transfers: [], plan: DEFAULT_PLAN, schemaReady: true, splitReady: false, goals: [], loans: [], listsReady: false };
  const [salRes, expRes, planRes, trRes, goalRes, loanRes, splitSal, splitPlan] = await Promise.all([
    supabase.from('salary_entries').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('expenses').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('budget_settings').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('savings_transfers').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('goals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('loans').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    // Columns added by supabase/salary_split_setup.sql; an error here means it hasn't been run yet
    supabase.from('salary_entries').select('needs_alloc, repay_from').limit(1),
    supabase.from('budget_settings').select('savings_pct, needs_share').limit(1),
  ]);
  const p = planRes.data;
  // Plans saved before the savings/spending split: keep their needs-to-wants ratio
  const oldShare = p && parseFloat(p.needs_pct) + parseFloat(p.wants_pct) > 0 ? Math.round(parseFloat(p.needs_pct) / (parseFloat(p.needs_pct) + parseFloat(p.wants_pct)) * 100) : DEFAULT_PLAN.needsShare;
  // Goals and loans live in the database once supabase/goals_loans_setup.sql has been run; until then they stay in this browser
  const listsReady = !goalRes.error && !loanRes.error;
  let goals = goalRes.data || [], loans = loanRes.data || [];
  if (listsReady) [goals, loans] = await uploadLocalLists(user.id, goals, loans);
  return {
    salaryEntries: salRes.data?.map(s => ({
      ...s, amount: parseFloat(s.amount), tithe: parseFloat(s.tithe) || 0, savingsAlloc: parseFloat(s.savings_alloc) || 0, savingsTag: s.savings_tag,
      // Salaries added before the split have no stored needs/wants share; the current plan fills it in
      needsAlloc: s.needs_alloc == null ? null : parseFloat(s.needs_alloc), wantsAlloc: parseFloat(s.wants_alloc) || 0, repayFrom: s.repay_from || null,
    })) || [],
    expenses: expRes.data?.map(e => ({ ...e, amount: parseFloat(e.amount), kind: e.kind === "need" ? "need" : "want" })) || [],
    transfers: trRes.data?.map(t => ({ ...t, amount: parseFloat(t.amount) })) || [],
    plan: p ? {
      titheOn: p.tithe_on, tithePct: parseFloat(p.tithe_pct),
      savingsPct: p.savings_pct == null ? DEFAULT_PLAN.savingsPct : parseFloat(p.savings_pct),
      needsShare: p.needs_share == null ? oldShare : parseFloat(p.needs_share), saved: true,
    } : DEFAULT_PLAN,
    // The budget tables come from supabase/budget_setup.sql; until it has been run, saving plans and moves is unavailable
    schemaReady: !planRes.error && !trRes.error,
    splitReady: !planRes.error && !splitSal.error && !splitPlan.error,
    goals: listsReady ? goals.map(toGoal) : readLocalArray('finflow_goals'),
    loans: listsReady ? loans.map(toLoan) : readLocalArray('finflow_loans'),
    listsReady,
  };
}

const toGoal = (g) => ({ ...g, target_amount: parseFloat(g.target_amount), current_amount: parseFloat(g.current_amount) || 0 });
const toLoan = (l) => ({ ...l, amount: parseFloat(l.amount), repaid_amount: parseFloat(l.repaid_amount) || 0 });
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || "");

// One-time move of goals and loans that older versions kept only in this browser. Anything already in the
// database (same id) is skipped; the browser copy is cleared once the upload succeeds.
async function uploadLocalLists(userId, goals, loans) {
  const lists = [
    { key: 'finflow_goals', table: 'goals', rows: goals, pick: g => ({ name: g.name, target_amount: g.target_amount, current_amount: g.current_amount || 0, color: g.color || null }) },
    { key: 'finflow_loans', table: 'loans', rows: loans, pick: l => ({ name: l.name, amount: l.amount, repaid_amount: l.repaid_amount || 0, date: l.date, note: l.note || null, status: l.status === 'repaid' ? 'repaid' : 'pending' }) },
  ];
  const out = [];
  for (const { key, table, rows, pick } of lists) {
    // Give every browser item a fixed uuid first, so two loads racing each other upsert the same rows instead of duplicating
    const stored = readLocalArray(key).filter(r => r && r.name).map(r => (isUuid(r.id) ? r : { ...r, id: crypto.randomUUID() }));
    localStorage.setItem(key, JSON.stringify(stored));
    const have = new Set(rows.map(r => r.id));
    const local = stored.filter(r => !have.has(r.id));
    if (local.length === 0) { localStorage.removeItem(key); out.push(rows); continue; }
    const { data, error } = await supabase.from(table).upsert(local.map(r => ({ ...pick(r), id: r.id, user_id: userId }))).select();
    if (error) { out.push(rows); continue; } // keep the browser copy and try again next time
    localStorage.removeItem(key);
    const merged = [...(data || []), ...rows];
    out.push(merged.filter((r, i) => merged.findIndex(x => x.id === r.id) === i));
  }
  return out;
}

// Savings = income − tithe − spending − everything moved to the emergency fund or investments
function computeTotals(salaryEntries, expenses, transfers) {
  const income = sum(salaryEntries, e => e.amount);
  const tithe = sum(salaryEntries, e => e.tithe || 0);
  const spent = sum(expenses, e => e.amount || 0);
  // Older salaries' "Investment"/"Emergency" tag isn't treated as a move: all of it counts as savings
  const moved = (dest) => sum(transfers.filter(t => t.destination === dest), t => t.amount);
  const emergency = moved("Emergency");
  const invested = moved("Investment");
  return { income, tithe, spent, emergency, invested, savings: income - tithe - spent - emergency - invested };
}

// How one salary splits: tithe off the top, then savings and the spending half (needs + wants). Extra income all goes to savings.
function splitSalary(amount, tithe, plan) {
  const pot = (amount - tithe) * (1 - plan.savingsPct / 100);
  const needs = +(pot * plan.needsShare / 100).toFixed(2);
  const wants = +(pot - needs).toFixed(2);
  return { needs, wants, savings: +(amount - tithe - needs - wants).toFixed(2) };
}
const allocOf = (e, plan) => e.savingsTag === "Extra" ? { needs: 0, wants: 0 }
  : e.needsAlloc != null ? { needs: e.needsAlloc, wants: e.wantsAlloc } : splitSalary(e.amount, e.tithe || 0, plan);

// Needs and wants are wallets that run month to month. Unspent money rolls into next month. Going below zero is
// covered by savings, and the month's first salary pays that back before topping the wallets up again: split equally,
// or all from needs or all from wants, as chosen when that salary was added.
function walkBudget(salaryEntries, expenses, plan, untilKey) {
  const groups = groupByMonth(salaryEntries, expenses);
  const keys = groups.map(g => g.key);
  const months = {};
  if (keys.length === 0) return { months, needs: 0, wants: 0 };
  const last = keys[0] > untilKey ? keys[0] : untilKey;
  const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
  let needs = 0, wants = 0;
  for (let k = keys[keys.length - 1]; k <= last; k = addMonths(k, 1)) {
    const g = byKey[k] || { entries: [], expenses: [] };
    const salaries = g.entries.filter(e => e.savingsTag !== "Extra").sort((a, b) => a.date.localeCompare(b.date));
    const carry = { needs, wants };
    const debt = Math.max(0, -needs) + Math.max(0, -wants);
    let repaid = 0, repayFrom = null;
    if (salaries.length > 0) {
      const alloc = salaries.reduce((s, e) => { const a = allocOf(e, plan); return { needs: s.needs + a.needs, wants: s.wants + a.wants }; }, { needs: 0, wants: 0 });
      needs = Math.max(0, needs) + alloc.needs;
      wants = Math.max(0, wants) + alloc.wants;
      if (debt > 0) {
        repaid = debt;
        repayFrom = salaries.find(e => e.repayFrom)?.repayFrom || "both";
        if (repayFrom === "need") needs -= debt;
        else if (repayFrom === "want") wants -= debt;
        else { needs -= debt / 2; wants -= debt / 2; }
      }
    }
    const avail = { needs, wants };
    const spent = { needs: sum(g.expenses.filter(e => e.kind === "need"), e => e.amount), wants: sum(g.expenses.filter(e => e.kind !== "need"), e => e.amount) };
    needs -= spent.needs;
    wants -= spent.wants;
    months[k] = { carry, debt, repaid, repayFrom, avail, spent, end: { needs, wants }, hasSalary: salaries.length > 0 };
  }
  return { months, needs, wants };
}

const EMPTY_MONTH = { carry: { needs: 0, wants: 0 }, debt: 0, repaid: 0, repayFrom: null, avail: { needs: 0, wants: 0 }, spent: { needs: 0, wants: 0 }, end: { needs: 0, wants: 0 }, hasSalary: false };

// One wallet as the screens show it: what was there to spend this month, what's used, and what's left (negative = covered by savings)
function walletView(m, kind) {
  const limit = m.avail[kind], spent = m.spent[kind], left = m.end[kind];
  const carried = m.hasSalary ? Math.max(0, m.carry[kind]) : m.carry[kind];
  const repaid = !m.repaid ? 0 : m.repayFrom === "both" ? m.repaid / 2 : m.repayFrom === kind.slice(0, -1) ? m.repaid : 0;
  return { limit, spent, left, carried, repaid, over: left < 0, pct: limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0 };
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
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
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
            <p style={{ color: "var(--text-on-ink-2)", fontSize: 15, lineHeight: "22px" }}>Income lands in your savings first, with your own tithe and spending limits, so you always know what's safe to spend.</p>
          </div>
          <div className="auth__features" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[["Your own tithe, needs & wants plan", "trend"], ["Synced securely to the cloud", "shield"], ["CSV & PDF statements", "download"]].map(([t, ic]) => (
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

// ─── Launch splash ────────────────────────────────────────────────────────────
// The maker's signature plays centre-screen while data loads, glides down to its resting place
// at the bottom, and only then does the app rise in around it.
const SPLASH_MIN_MS = 1450; // long enough for the letters to settle and the dot to land
const SPLASH_MOVE_MS = 850;
const SPLASH_REVEAL_MS = 600; // keep in step with the app-in animation in index.css

function Splash({ ready, onReveal, onDone }) {
  const markRef = useRef(null);
  const bgRef = useRef(null);
  const cb = useRef({ onReveal, onDone });
  const [minDone, setMinDone] = useState(false);

  useEffect(() => { cb.current = { onReveal, onDone }; });

  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !minDone) return;
    const anims = [];
    const finish = () => { cb.current.onReveal(); cb.current.onDone(); };
    // Safety net: never leave the splash up, even where animations are paused (background tabs)
    const fallback = setTimeout(finish, SPLASH_MOVE_MS + SPLASH_REVEAL_MS + 900);
    // Give the (still hidden) page a moment to lay out before measuring the footer
    const measure = setTimeout(() => {
      const mark = markRef.current;
      const target = document.querySelector(".credit .sig");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!mark || !target || reduce || !mark.animate) { finish(); return; }

      // Land on the footer signature; if that's below the fold, land at the bottom of the
      // screen instead (above the bottom nav on phones) and fade out as the app appears.
      const from = mark.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const restY = window.innerHeight - (window.matchMedia(MOBILE_MQ).matches ? 132 : 56);
      const toY = to.top + to.height / 2;
      const offscreen = toY > restY;
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = (offscreen ? restY : toY) - (from.top + from.height / 2);
      const landed = `translate(${dx}px, ${dy}px) scale(1)`;

      const move = mark.animate(
        [{ transform: "scale(1.6)" }, { transform: landed }],
        { duration: SPLASH_MOVE_MS, easing: "cubic-bezier(.65, 0, .35, 1)", fill: "forwards" }
      );
      anims.push(move);
      move.onfinish = () => {
        cb.current.onReveal();
        const reveal = { duration: SPLASH_REVEAL_MS, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" };
        const bg = bgRef.current.animate([{ opacity: 1 }, { opacity: 0 }], reveal);
        anims.push(bg);
        if (offscreen) anims.push(mark.animate([{ transform: landed, opacity: 1 }, { transform: `translate(${dx}px, ${dy + 10}px) scale(1)`, opacity: 0 }], reveal));
        bg.onfinish = () => cb.current.onDone();
      };
    }, 40);
    return () => { clearTimeout(measure); clearTimeout(fallback); anims.forEach(a => a.cancel()); };
  }, [ready, minDone]);

  return (
    <div className="splash" role="status" aria-label="Loading your finances">
      <div className="splash__bg" ref={bgRef} />
      <div className="splash__mark" ref={markRef}>
        <Signature lead="Built by" name="Kery" autoplay />
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [splashPhase, setSplashPhase] = useState("show"); // show → reveal → done
  const [salaryEntries, setSalaryEntries] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [schemaReady, setSchemaReady] = useState(true);
  const [splitReady, setSplitReady] = useState(true);
  const [goals, setGoals] = useState([]);
  const [loans, setLoans] = useState([]);
  const [listsReady, setListsReady] = useState(true);
  const [tab, setTab] = useState(tabFromHash);
  const [openMonth, setOpenMonth] = useState(null);

  // Salary form
  const [sAmt, setSAmt] = useState("");
  const [sDate, setSDate] = useState(localToday);
  const [incType, setIncType] = useState("Salary");
  const [repayFrom, setRepayFrom] = useState("both");

  // Expense form
  const [eName, setEName] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eDate, setEDate] = useState(localToday);
  const [eTag, setETag] = useState("General");
  const [eKind, setEKind] = useState(kindFor("General"));

  // Move-from-savings form (emergency fund / investments)
  const [tDest, setTDest] = useState("Emergency");
  const [tAmt, setTAmt] = useState("");
  const [tDate, setTDate] = useState(localToday);
  const [tNote, setTNote] = useState("");

  // Budget plan form (a draft until saved)
  const [draft, setDraft] = useState(DEFAULT_PLAN);
  const [planSaving, setPlanSaving] = useState(false);

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

  useLayoutEffect(() => {
    window.scrollTo(0, scrollPos.current[tab] || 0);
    document.documentElement.dataset.scrollDir = "up"; // a new page always shows the add button
  }, [tab]);

  // Scrolling down tucks the floating add button away; scrolling back up brings it back
  useEffect(() => {
    const root = document.documentElement;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 56);
      if (Math.abs(y - lastY) < 8) return; // ignore jitter
      root.dataset.scrollDir = y > lastY && y > 80 ? "down" : "up";
      lastY = y;
    };
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

  // Lets CSS hold the app hidden while the splash plays, then rise it in on reveal
  useEffect(() => {
    document.documentElement.dataset.splash = splashPhase;
  }, [splashPhase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthChecked(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // Signed out: the next sign-in loads fresh data behind the splash again
      if (!session) { setLoaded(false); setSplashPhase("show"); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Only until supabase/goals_loans_setup.sql has been run: keep goals and loans in this browser
  useEffect(() => {
    if (loaded && !listsReady) {
      localStorage.setItem('finflow_goals', JSON.stringify(goals));
      localStorage.setItem('finflow_loans', JSON.stringify(loans));
    }
  }, [goals, loans, loaded, listsReady]);

  useEffect(() => {
    if (!session) return;
    loadData().then(data => {
      setSalaryEntries(data.salaryEntries); setExpenses(data.expenses); setTransfers(data.transfers);
      setPlan(data.plan); setSchemaReady(data.schemaReady); setSplitReady(data.splitReady);
      setGoals(data.goals); setLoans(data.loans); setListsReady(data.listsReady); setLoaded(true);
    });
  }, [session]);

  const walk = useMemo(() => walkBudget(salaryEntries, expenses, plan, monthKey(localToday())), [salaryEntries, expenses, plan]);
  // Savings is what's left once the money still sitting in the needs and wants wallets is counted out
  const T = useMemo(() => {
    const t = computeTotals(salaryEntries, expenses, transfers);
    const wallets = Math.max(0, walk.needs) + Math.max(0, walk.wants);
    return { ...t, wallets, savings: t.savings - wallets };
  }, [salaryEntries, expenses, transfers, walk]);
  const groups = useMemo(() => groupByMonth(salaryEntries, expenses), [salaryEntries, expenses]);

  const prevAmt = parseFloat(sAmt) || 0;
  const hasPrev = prevAmt > 0;
  const isExtra = incType === "Extra";
  const tithePct = isExtra || !plan.titheOn ? 0 : plan.tithePct;
  const pTithe = prevAmt * tithePct / 100;
  const pSplit = isExtra ? { needs: 0, wants: 0, savings: prevAmt } : splitSalary(prevAmt, pTithe, plan);
  // Overspending this salary pays back to savings: only when it's the first salary of its month
  const sMonth = walk.months[monthKey(sDate)];
  const pDebt = isExtra || sMonth?.hasSalary ? 0
    : sMonth ? sMonth.debt : Math.max(0, -walk.needs) + Math.max(0, -walk.wants);

  // ── Derived views (presentation only — totals above remain the source of truth) ──
  const curKey = monthKey(localToday());
  const prevKey = addMonths(curKey, -1);
  const monthOf = (k) => groups.find(g => g.key === k) || { key: k, entries: [], expenses: [] };
  const thisMonth = monthOf(curKey);
  const lastMonth = monthOf(prevKey);
  const mIncome = sum(thisMonth.entries, e => e.amount);
  const mSpent = sum(thisMonth.expenses, e => e.amount);
  const mTithe = sum(thisMonth.entries, e => e.tithe);
  const mKept = mIncome - mTithe - mSpent; // what this month added to savings
  const curWallets = walk.months[curKey];
  const budget = curWallets
    ? { active: curWallets.hasSalary || curWallets.avail.needs !== 0 || curWallets.avail.wants !== 0, salary: sum(thisMonth.entries.filter(e => e.savingsTag !== "Extra"), e => e.amount), needs: walletView(curWallets, "needs"), wants: walletView(curWallets, "wants") }
    : { active: false, salary: 0, needs: walletView(EMPTY_MONTH, "needs"), wants: walletView(EMPTY_MONTH, "wants") };
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

  // Money set aside each month: moves to the emergency fund / investments
  const savingsSeries = useMemo(() => {
    const nowKey = monthKey(localToday());
    const byKey = {};
    transfers.forEach(t => { const k = monthKey(t.date); byKey[k] = (byKey[k] || 0) + t.amount; });
    return Array.from({ length: 12 }, (_, i) => {
      const k = addMonths(nowKey, i - 11);
      return { key: k, label: monthShort(k), full: monthKeyLabel(k), saved: byKey[k] || 0, current: k === nowKey };
    });
  }, [transfers]);
  const savings12 = sum(savingsSeries, d => d.saved);

  // Salary: tithe (if on) off the top, then the plan's split between savings, needs and wants. Extra income: all to savings.
  // The split is stored with the salary so later plan changes don't rewrite past months.
  const addSalary = async () => {
    const amount = parseFloat(sAmt);
    if (!amount || amount <= 0 || !sDate || !session) return;
    const isExtra = incType === "Extra";
    const tithe = isExtra || !plan.titheOn ? 0 : +(amount * plan.tithePct / 100).toFixed(2);
    const split = isExtra ? { needs: 0, wants: 0, savings: +(amount - tithe).toFixed(2) } : splitSalary(amount, tithe, plan);
    const tag = isExtra ? "Extra" : "Salary";
    const repay = pDebt > 0 ? repayFrom : null;

    const row = { user_id: session.user.id, date: sDate, amount, savings_tag: tag, tithe, wants_alloc: split.wants, savings_alloc: split.savings };
    if (splitReady) Object.assign(row, { needs_alloc: split.needs, repay_from: repay }); // columns from supabase/salary_split_setup.sql
    const { data, error } = await supabase.from('salary_entries').insert([row]).select();
    if (!error && data) {
      setSalaryEntries(prev => [{
        id: data[0].id, date: sDate, amount, savingsTag: tag, tithe, savingsAlloc: split.savings,
        needsAlloc: splitReady ? split.needs : null, wantsAlloc: split.wants, repayFrom: splitReady ? repay : null,
      }, ...prev]);
      setSAmt(""); setSDate(localToday()); setRepayFrom("both");
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
    const row = { user_id: session.user.id, date: eDate, name: eName.trim(), amount, tag: eTag };
    if (schemaReady) row.kind = eKind; // the kind column arrives with supabase/budget_setup.sql
    const { data, error } = await supabase.from('expenses').insert([row]).select();
    if (!error && data) {
      setExpenses(prev => [{ id: data[0].id, date: eDate, name: eName.trim(), amount, tag: eTag, kind: schemaReady ? eKind : "want" }, ...prev]);
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

  const setExpenseKind = async (id, kind) => {
    const { error } = await supabase.from('expenses').update({ kind }).eq('id', id);
    if (!error) setExpenses(prev => prev.map(e => (e.id === id ? { ...e, kind } : e)));
    return !error;
  };

  const addTransfer = async () => {
    const amount = parseFloat(tAmt);
    if (!amount || amount <= 0 || !tDate || !session || !schemaReady) return false;
    const note = tNote.trim() || null;
    const { data, error } = await supabase.from('savings_transfers').insert([{
      user_id: session.user.id, date: tDate, amount, destination: tDest, note
    }]).select();
    if (!error && data) {
      setTransfers(prev => [{ id: data[0].id, date: tDate, amount, destination: tDest, note }, ...prev]);
      setTAmt(""); setTNote(""); setTDate(localToday());
      return true;
    }
    return false;
  };

  const delTransfer = async (id) => {
    const { error } = await supabase.from('savings_transfers').delete().eq('id', id);
    if (!error) setTransfers(prev => prev.filter(t => t.id !== id));
    return !error;
  };

  const savePlan = async () => {
    if (!session || !schemaReady) return false;
    // Without the savings_pct column (supabase/salary_split_setup.sql) the savings share stays at the default
    const savingsPct = splitReady ? pctOf(draft.savingsPct) : DEFAULT_PLAN.savingsPct;
    const next = { titheOn: draft.titheOn, tithePct: pctOf(draft.tithePct), savingsPct, needsShare: pctOf(draft.needsShare), saved: true };
    // needs_pct / wants_pct (% of the whole salary) are kept filled in for older versions of the app
    const spend = (100 - (next.titheOn ? next.tithePct : 0)) * (1 - next.savingsPct / 100);
    const row = {
      user_id: session.user.id, tithe_on: next.titheOn, tithe_pct: next.tithePct, updated_at: new Date().toISOString(),
      needs_pct: +(spend * next.needsShare / 100).toFixed(2), wants_pct: +(spend * (100 - next.needsShare) / 100).toFixed(2),
      ...(splitReady ? { savings_pct: next.savingsPct, needs_share: next.needsShare } : {}),
    };
    setPlanSaving(true);
    const { error } = await supabase.from('budget_settings').upsert(row);
    setPlanSaving(false);
    if (error) return false;
    setPlan(next);
    return true;
  };

  // Goals and loans: saved to the database (or, before the setup script is run, to this browser). Each returns true on success.
  const saveRow = async (table, op) => {
    if (!listsReady) return { ok: true };
    const { data, error } = await op(supabase.from(table));
    return { ok: !error, data };
  };

  const addGoal = async () => {
    const target = parseFloat(gTarget);
    if (!target || target <= 0 || !gName.trim()) return false;
    const row = { name: gName.trim(), target_amount: target, current_amount: 0, color: gColor };
    const res = await saveRow('goals', q => q.insert(row).select().single());
    if (!res.ok) return false;
    setGoals(prev => [res.data ? toGoal(res.data) : { ...row, id: crypto.randomUUID() }, ...prev]);
    setGName(""); setGTarget("");
    return true;
  };

  const delGoal = async (id) => {
    const res = await saveRow('goals', q => q.delete().eq('id', id));
    if (res.ok) setGoals(prev => prev.filter(e => e.id !== id));
    return res.ok;
  };

  const fundGoal = async (goal, amtStr) => {
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return false;
    const current_amount = goal.current_amount + amt;
    const res = await saveRow('goals', q => q.update({ current_amount }).eq('id', goal.id));
    if (res.ok) setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, current_amount } : g));
    return res.ok;
  };

  const addLoan = async () => {
    const amount = parseFloat(lAmt);
    if (!amount || amount <= 0 || !lName.trim()) return false;
    const row = { name: lName.trim(), amount, repaid_amount: 0, date: lDate, note: lNote, status: 'pending' };
    const res = await saveRow('loans', q => q.insert(row).select().single());
    if (!res.ok) return false;
    setLoans(prev => [res.data ? toLoan(res.data) : { ...row, id: crypto.randomUUID() }, ...prev]);
    setLName(""); setLAmt(""); setLNote(""); setLDate(localToday());
    return true;
  };

  const updateLoan = async (id, patch) => {
    const res = await saveRow('loans', q => q.update(patch).eq('id', id));
    if (res.ok) setLoans(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    return res.ok;
  };

  const markLoanRepaid = (loan) => updateLoan(loan.id, { repaid_amount: loan.amount, status: 'repaid' });

  const repayLoan = (loan, amtStr) => {
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return false;
    const repaid_amount = (loan.repaid_amount || 0) + amt;
    return updateLoan(loan.id, { repaid_amount, status: repaid_amount >= loan.amount ? 'repaid' : 'pending' });
  };

  const delLoan = async (id) => {
    const res = await saveRow('loans', q => q.delete().eq('id', id));
    if (res.ok) setLoans(prev => prev.filter(l => l.id !== id));
    return res.ok;
  };

  const downloadStatement = (format = 'csv') => {
    let s = [...salaryEntries], e = [...expenses], t = [...transfers];
    if (expType === "Month" && expMonth) {
      s = s.filter(x => monthKey(x.date) === expMonth);
      e = e.filter(x => monthKey(x.date) === expMonth);
      t = t.filter(x => monthKey(x.date) === expMonth);
    } else if (expType === "Date Range") {
      s = s.filter(x => x.date >= expStart && x.date <= expEnd);
      e = e.filter(x => x.date >= expStart && x.date <= expEnd);
      t = t.filter(x => x.date >= expStart && x.date <= expEnd);
    }
    const period = expType === "Month" ? monthKeyLabel(expMonth) : expType === "Date Range" ? `${fmtDate(expStart)} – ${fmtDate(expEnd)}` : "All time";
    const fileBase = `FinFlow_Statement_${expType === "Month" ? expMonth : expType === "Date Range" ? `${expStart}_to_${expEnd}` : "all"}`;

    // One chronological list: income, expenses and money moved out of savings
    const lines = [
      ...s.map(x => ({ date: x.date, type: "Income", title: x.savingsTag === "Extra" ? "Extra income" : "Salary", category: "", kind: "",
        amount: x.amount, note: x.tithe > 0 ? `Tithe ${num(x.tithe)} · ${num(x.amount - x.tithe)} to savings` : "All to savings" })),
      ...e.map(x => ({ date: x.date, type: "Expense", title: x.name, category: x.tag, kind: x.kind === "need" ? "Need" : "Want", amount: -x.amount, note: "" })),
      ...t.map(x => ({ date: x.date, type: "Set aside", title: `To ${DESTINATIONS[x.destination]?.label.toLowerCase() || x.destination}`, category: "", kind: "",
        amount: -x.amount, note: x.note || "" })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const income = sum(s, x => x.amount), tithe = sum(s, x => x.tithe), spent = sum(e, x => x.amount);
    const needs = sum(e.filter(x => x.kind === "need"), x => x.amount), wants = spent - needs, setAside = sum(t, x => x.amount);
    const kept = income - tithe - spent - setAside;

    if (format === 'csv') {
      const fix = (n) => (Number(n) || 0).toFixed(2); // plain numbers so spreadsheets can sum them
      const rows = [
        ["FinFlow Statement"],
        ["Period", period],
        ["Generated", fmtDate(localToday())],
        ["Account", session.user?.email || ""],
        [],
        ["Summary", "Amount (INR)"],
        ["Income", fix(income)],
        ["Tithe", fix(tithe)],
        ["Spent", fix(spent)],
        ["  Needs", fix(needs)],
        ["  Wants", fix(wants)],
        ["Set aside", fix(setAside)],
        ["Kept in savings", fix(kept)],
        [],
        ["Date", "Type", "Description", "Category", "Need / Want", "Amount (INR)", "Details"],
        ...lines.map(l => [l.date, l.type, l.title, l.category, l.kind, fix(l.amount), l.note]),
      ];
      const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      // BOM so Excel opens it as UTF-8
      const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${fileBase}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (format === 'pdf') {
      // FinFlow look: ink header card, lime mark, soft summary tiles, airy table.
      // Built-in PDF fonts have no ₹ glyph, so amounts read "Rs".
      const INK = [18, 19, 22], LIME = [210, 242, 75], SURFACE2 = [244, 245, 247], DIVIDER = [238, 240, 242];
      const TEXT2 = [91, 95, 103], TEXT3 = [141, 145, 153], ON_INK2 = [154, 158, 166], POS = [43, 138, 62];
      const rs = (n) => `${n < 0 ? "-" : ""}Rs ${num(Math.abs(n))}`;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;

      // Header card
      doc.setFillColor(...INK);
      doc.roundedRect(M, M, W - M * 2, 40, 5, 5, "F");
      doc.setFillColor(...LIME);
      doc.roundedRect(M + 8, M + 8, 11, 11, 2.5, 2.5, "F");
      doc.setFillColor(...INK);
      [[2.6, 4], [5.2, 6], [7.8, 2.5]].forEach(([x, h]) => doc.roundedRect(M + 8 + x, M + 8 + 8.5 - h, 1.3, h, 0.6, 0.6, "F"));
      doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(255, 255, 255);
      doc.text("FinFlow", M + 23, M + 15.8);
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...ON_INK2);
      doc.text("STATEMENT", W - M - 8, M + 11, { align: "right" });
      doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(255, 255, 255);
      doc.text(period, W - M - 8, M + 18, { align: "right" });
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...ON_INK2);
      doc.text(session.user?.email || "", M + 8, M + 32);
      doc.text(`Generated ${fmtDate(localToday())}`, W - M - 8, M + 32, { align: "right" });

      // Summary tiles
      const tiles = [["Income", income, POS], ["Spent", spent, INK], ["Set aside", setAside, INK], ["Kept in savings", kept, kept < 0 ? [207, 61, 54] : INK]];
      const gap = 4, tw = (W - M * 2 - gap * 3) / 4, ty = M + 46;
      tiles.forEach(([label, val, col], i) => {
        const x = M + i * (tw + gap);
        doc.setFillColor(...SURFACE2);
        doc.roundedRect(x, ty, tw, 21, 3.5, 3.5, "F");
        doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...TEXT3);
        doc.text(label.toUpperCase(), x + 5, ty + 7.5);
        doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...col);
        doc.text(rs(val), x + 5, ty + 15.5);
      });
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...TEXT2);
      doc.text(`Tithe ${rs(tithe)}   ·   Needs ${rs(needs)}   ·   Wants ${rs(wants)}`, M, ty + 29);

      // Transactions
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
      doc.text("Transactions", M, ty + 40);
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...TEXT3);
      doc.text(`${lines.length} ${lines.length === 1 ? "entry" : "entries"}`, W - M, ty + 40, { align: "right" });

      if (lines.length === 0) {
        doc.setFillColor(...SURFACE2);
        doc.roundedRect(M, ty + 45, W - M * 2, 20, 3.5, 3.5, "F");
        doc.setFontSize(9.5).setTextColor(...TEXT2);
        doc.text("No transactions in this period.", W / 2, ty + 56.5, { align: "center" });
      } else {
        autoTable(doc, {
          startY: ty + 44,
          margin: { left: M, right: M, bottom: 20 },
          head: [["Date", "Type", "Description", "Category", "Amount"]],
          body: lines.map(l => [fmtDate(l.date), l.type, l.note ? `${l.title}\n${l.note}` : l.title, [l.category, l.kind].filter(Boolean).join(" · "), l.type === "Income" ? `+${rs(l.amount)}` : rs(l.amount)]),
          theme: "plain",
          styles: { font: "helvetica", fontSize: 8.5, textColor: INK, cellPadding: { top: 3.2, bottom: 3.2, left: 3, right: 3 }, lineColor: DIVIDER, lineWidth: { bottom: 0.25 }, valign: "middle" },
          headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, lineWidth: 0 },
          columnStyles: { 0: { cellWidth: 26, textColor: TEXT2 }, 1: { cellWidth: 20 }, 3: { cellWidth: 38, textColor: TEXT2 }, 4: { cellWidth: 32, halign: "right", fontStyle: "bold" } },
          didParseCell: (d) => {
            if (d.section === "head" && d.column.index === 4) d.cell.styles.halign = "right";
            if (d.section !== "body") return;
            const l = lines[d.row.index];
            if (d.column.index === 1) d.cell.styles.textColor = l.type === "Income" ? POS : l.type === "Set aside" ? TEXT3 : INK;
            if (d.column.index === 4) d.cell.styles.textColor = l.type === "Income" ? POS : l.type === "Set aside" ? TEXT2 : INK;
          },
        });
      }

      // Footer on every page
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...DIVIDER).setLineWidth(0.3).line(M, H - 13, W - M, H - 13);
        doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...TEXT3);
        doc.text("FinFlow · Built by Kery.", M, H - 8);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: "right" });
      }
      doc.save(`${fileBase}.pdf`);
    }
  };

  const handleSignOut = () => supabase.auth.signOut();
  const sortedSalaries = [...salaryEntries].sort((a, b) => b.date.localeCompare(a.date));
  const moves = [...transfers].sort((a, b) => b.date.localeCompare(a.date));

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

  if (authChecked && !session) return <Auth />;
  const splash = splashPhase !== "done" && (
    <Splash key="splash" ready={loaded} onReveal={() => setSplashPhase(p => (p === "show" ? "reveal" : p))} onDone={() => setSplashPhase("done")} />
  );
  if (!loaded) return <>{splash}</>;

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
  const overdrawn = T.savings < 0;

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
  const submitGoal = async () => { if (await addGoal()) { haptic(12); notify("Goal created"); closeSheet(); } else if (gName.trim() && parseFloat(gTarget) > 0) notify("Couldn't save the goal. Try again.", "neg"); };
  const listsSetupNote = loaded && !listsReady && (
    <div className="alert alert--neg" style={{ marginBottom: 16 }}>
      <Icon name="alert" size={16} />
      <span>Saved on this device only. Run <b>supabase/goals_loans_setup.sql</b> in your Supabase SQL editor to sync goals and loans across devices.</span>
    </div>
  );
  const removeLoan = async (l) => { haptic(14); if (await delLoan(l.id)) notify(`Loan to ${l.name} deleted`); else notify("Couldn't save. Check your connection and try again.", "neg"); };
  const submitLoan = async () => { if (await addLoan()) { haptic(12); notify("Loan recorded"); closeSheet(); } else if (lName.trim() && parseFloat(lAmt) > 0) notify("Couldn't save the loan. Try again.", "neg"); };
  const removeSalary = async (id) => { haptic(14); notify(await delSalary(id) ? "Income entry deleted" : "Couldn't delete — try again", "neg"); };
  const removeExpense = async (id) => { haptic(14); notify(await delExpense(id) ? "Expense deleted" : "Couldn't delete — try again", "neg"); };
  const flipKind = async (e) => {
    const kind = e.kind === "need" ? "want" : "need";
    haptic(6);
    notify(await setExpenseKind(e.id, kind) ? `${e.name} now counts as a ${kind}` : "Couldn't change — try again", "pos");
  };
  const submitTransfer = async () => { if (await addTransfer()) { haptic(12); notify(`Moved to ${DESTINATIONS[tDest].label.toLowerCase()}`); closeSheet(); } };
  const removeTransfer = async (id) => { haptic(14); notify(await delTransfer(id) ? "Move undone, back in savings" : "Couldn't delete — try again", "neg"); };
  const submitPlan = async () => { if (await savePlan()) { haptic(12); notify("Budget plan saved"); closeSheet(); } else notify("Couldn't save — try again", "neg"); };
  const openPlan = () => { setDraft({ titheOn: plan.titheOn, tithePct: String(plan.tithePct), savingsPct: String(plan.savingsPct), needsShare: String(plan.needsShare) }); openSheet("plan"); };
  const openMove = (dest) => { setTDest(dest); openSheet("move"); };

  const userName = session.user?.email?.split("@")[0] || "there";
  const pageTitle = tab === "dashboard" ? "Dashboard" : TABS.find(t => t.id === tab)?.label;
  const incomeHint = isExtra ? "Extra income goes straight to your savings."
    : `${plan.titheOn ? `${plan.tithePct}% tithe comes off the top. Of the rest, ` : ""}${plan.savingsPct}% goes to savings and ${100 - plan.savingsPct}% to needs and wants.`;

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

      <div className="tile">
        <div className="stack" aria-hidden="true">
          {tithePct > 0 && <span style={{ flexGrow: tithePct, background: "var(--text-3)" }} />}
          <span style={{ flexGrow: Math.max(0.001, pSplit.savings), background: "var(--text-2)" }} />
          {pSplit.needs > 0 && <span style={{ flexGrow: pSplit.needs, background: "var(--ink)" }} />}
          {pSplit.wants > 0 && <span style={{ flexGrow: pSplit.wants, background: "var(--lime-chart)" }} />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, marginTop: 14 }}>
          {[
            ...(tithePct > 0 ? [[`Tithe · ${tithePct}%`, pTithe, "var(--text-3)"]] : []),
            ["To savings", pSplit.savings, "var(--text-2)"],
            ...(isExtra ? [] : [["Needs", pSplit.needs, "var(--ink)"], ["Wants", pSplit.wants, "var(--lime-chart)"]]),
            ["New savings balance", T.savings + pSplit.savings + Math.min(pDebt, pSplit.needs + pSplit.wants), null],
          ].map(([lbl, val, col]) => (
            <div key={lbl}>
              <div className="legend__item eyebrow">{col && <span className="dot dot--sq" style={{ background: col }} />}{lbl}</div>
              <Money value={hasPrev || !col ? val : 0} className="money--md" style={{ marginTop: 2, color: hasPrev ? undefined : "var(--text-3)" }} />
            </div>
          ))}
        </div>
      </div>

      {pDebt > 0 && (
        <div className="field">
          <span className="field__label">Pay back savings</span>
          <span className="card__sub">You overspent by <b className="num" style={{ color: "var(--neg)" }}>{currency(pDebt)}</b> and savings covered it. This salary pays it back from:</span>
          <Segmented options={REPAY_OPTIONS} value={repayFrom} onChange={setRepayFrom} label="Pay back savings from" />
        </div>
      )}

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
            <button key={c.id} type="button" className="chip" aria-pressed={eTag === c.id} onClick={() => { haptic(5); setETag(c.id); setEKind(kindFor(c.id)); }}>
              <Icon name={c.icon} size={18} />
              <span>{c.id}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">Counts as</span>
        <Segmented options={[["need", "Need"], ["want", "Want"]]} value={eKind} onChange={setEKind} label="Need or want" />
        {budget.active && (() => {
          const b = eKind === "need" ? budget.needs : budget.wants;
          return <span className="card__sub">{b.over ? `${eKind === "need" ? "Needs" : "Wants"} are over by ` : `${eKind === "need" ? "Needs" : "Wants"} left this month: `}<b className="num" style={{ color: b.over ? "var(--neg)" : "var(--text)" }}>{currency(Math.abs(b.left))}</b>{b.over ? ", covered by savings" : <> of {currency(b.limit)}</>}</span>;
        })()}
      </div>
      <button className="btn btn--primary btn--block" onClick={submitExpense} disabled={!eName.trim() || !eAmt || parseFloat(eAmt) <= 0}>
        <Icon name="plus" size={16} /> Add expense
      </button>
      {overdrawn && (
        <div className="alert alert--neg"><Icon name="alert" size={16} /><span>Savings are overdrawn by {currency(Math.abs(T.savings))}</span></div>
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

  const moveAmt = parseFloat(tAmt) || 0;
  const moveForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="field">
        <span className="field__label">Move to</span>
        <Segmented options={[["Emergency", "Emergency fund"], ["Investment", "Investments"]]} value={tDest} onChange={setTDest} label="Move to" />
      </div>
      <div className="form-row">
        <label className="field">
          <span className="field__label">Amount</span>
          <span className="input-wrap">
            <span className="input-prefix">₹</span>
            <input className="input num" type="number" inputMode="decimal" enterKeyHint="next" placeholder="0.00" value={tAmt} onChange={e => setTAmt(e.target.value)} />
          </span>
        </label>
        <div className="field">
          <span className="field__label">Date</span>
          <FinDateSelector value={tDate} onChange={setTDate} label="Move date" />
        </div>
      </div>
      <label className="field">
        <span className="field__label">Note <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(optional)</span></span>
        <input className="input" placeholder={tDest === "Investment" ? "e.g. Index fund SIP" : "e.g. Monthly top-up"} enterKeyHint="done" autoComplete="off" value={tNote} onChange={e => setTNote(e.target.value)} onKeyDown={e => e.key === "Enter" && submitTransfer()} />
      </label>
      <div className="tile" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
        <span style={{ color: "var(--text-2)" }}>Savings after this</span>
        <b className="num" style={{ color: T.savings - moveAmt < 0 ? "var(--neg)" : "var(--text)" }}>{currency(T.savings - moveAmt)}</b>
      </div>
      {moveAmt > T.savings && <div className="alert alert--neg"><Icon name="alert" size={16} /><span>That's more than you have in savings.</span></div>}
      {!schemaReady && <div className="alert alert--neg"><Icon name="alert" size={16} /><span>Moving money needs the one-time database setup first.</span></div>}
      <button className="btn btn--primary btn--block" onClick={submitTransfer} disabled={!schemaReady || moveAmt <= 0}>
        <Icon name={DESTINATIONS[tDest].icon} size={16} /> {tDest === "Investment" ? "Invest" : "Add to emergency fund"}
      </button>
    </div>
  );

  // Plan preview uses this month's salary, else the latest one, else a round example
  const draftTithe = draft.titheOn ? pctOf(draft.tithePct) : 0;
  const draftSavingsPct = pctOf(draft.savingsPct);
  const draftShare = pctOf(draft.needsShare);
  const exampleSalary = budget.salary || sortedSalaries.find(e => e.savingsTag !== "Extra")?.amount || 30000;
  const exampleTithe = exampleSalary * draftTithe / 100;
  const exampleSplit = splitSalary(exampleSalary, exampleTithe, { savingsPct: draftSavingsPct, needsShare: draftShare });
  const pctInput = (key, label) => (
    <span className="input-wrap">
      <input className="input num input--pct" type="number" inputMode="decimal" min="0" max="100" enterKeyHint="next" value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} aria-label={`${label} percentage`} />
      <span className="input-suffix">%</span>
    </span>
  );
  const planForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="card__sub" style={{ margin: 0 }}>After tithe, each salary splits between savings and spending. Unspent needs and wants roll into next month. Overspending is covered by savings and paid back from your next salary.</p>
      <div className="field">
        <span className="field__label">Tithe</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Segmented options={[["on", "On"], ["off", "Off"]]} value={draft.titheOn ? "on" : "off"} onChange={v => setDraft(d => ({ ...d, titheOn: v === "on" }))} label="Tithe" />
          {draft.titheOn && <div style={{ width: 110 }}>{pctInput("tithePct", "Tithe")}</div>}
        </div>
      </div>
      <div className="form-row">
        <label className="field">
          <span className="field__label">Savings</span>
          {pctInput("savingsPct", "Savings")}
          <span className="card__sub">Of what's left after tithe. The rest is for spending.</span>
        </label>
        <label className="field">
          <span className="field__label">Needs</span>
          {pctInput("needsShare", "Needs share of spending")}
          <span className="card__sub">Of the spending part. Wants get the other {100 - draftShare}%.</span>
        </label>
      </div>
      <div className="tile">
        <div className="stack" aria-hidden="true">
          {exampleTithe > 0 && <span style={{ flexGrow: exampleTithe, background: "var(--text-3)" }} />}
          {exampleSplit.savings > 0 && <span style={{ flexGrow: exampleSplit.savings, background: "var(--text-2)" }} />}
          {exampleSplit.needs > 0 && <span style={{ flexGrow: exampleSplit.needs, background: "var(--ink)" }} />}
          {exampleSplit.wants > 0 && <span style={{ flexGrow: exampleSplit.wants, background: "var(--lime-chart)" }} />}
        </div>
        <div className="card__sub" style={{ marginTop: 12 }}>On a <b className="num" style={{ color: "var(--text)" }}>{currency(exampleSalary)}</b> salary:</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, marginTop: 8 }}>
          {[
            ...(draftTithe > 0 ? [[`Tithe · ${draftTithe}%`, exampleTithe, "var(--text-3)"]] : []),
            ["Savings", exampleSplit.savings, "var(--text-2)"],
            ["Needs", exampleSplit.needs, "var(--ink)"],
            ["Wants", exampleSplit.wants, "var(--lime-chart)"],
          ].map(([lbl, val, col]) => (
            <div key={lbl}>
              <div className="legend__item eyebrow"><span className="dot dot--sq" style={{ background: col }} />{lbl}</div>
              <Money value={val} className="money--md" style={{ marginTop: 2 }} />
            </div>
          ))}
        </div>
      </div>
      {!schemaReady && <div className="alert alert--neg"><Icon name="alert" size={16} /><span>Saving a plan needs the one-time database setup first.</span></div>}
      {schemaReady && !splitReady && <div className="alert alert--neg"><Icon name="alert" size={16} /><span>Run <b>supabase/salary_split_setup.sql</b> in your Supabase SQL editor to change the savings %. Until then it stays at {DEFAULT_PLAN.savingsPct}%.</span></div>}
      <button className="btn btn--primary btn--block" onClick={submitPlan} disabled={!schemaReady || planSaving}>
        {planSaving ? <span className="spinner" /> : <><Icon name="check" size={16} /> Save plan</>}
      </button>
    </div>
  );

  const SHEETS = {
    income: { title: "Record income", body: renderIncomeForm(true) },
    expense: { title: "Add expense", body: expenseForm },
    goal: { title: "New goal", body: goalForm },
    loan: { title: "New loan", body: loanForm },
    move: { title: tDest === "Investment" ? "Invest" : "Add to emergency fund", body: moveForm },
    plan: { title: "Budget plan", body: planForm },
  };

  const salaryRowProps = (e, onDelete) => {
    const extra = e.savingsTag === "Extra";
    return {
      icon: "income",
      iconClass: extra ? "row__icon--lime" : "row__icon--ink",
      title: extra ? "Extra income" : "Salary",
      meta: e.tithe > 0 ? `Tithe ${currency(e.tithe)} · ${currency(e.amount - e.tithe)} to savings` : `${fmtDate(e.date)} · all to savings`,
      amount: e.amount, positive: true, onDelete, deleteLabel: "Delete income entry",
    };
  };
  const expenseRowProps = (e, onDelete, showDate = true) => {
    const c = catMeta(e.tag);
    return {
      icon: c.icon, iconColor: c.color, title: e.name,
      meta: showDate ? `${e.tag} · ${fmtDate(e.date)}` : e.tag,
      kind: e.kind, onKind: schemaReady ? () => flipKind(e) : undefined,
      amount: e.amount, positive: false, onDelete, deleteLabel: `Delete expense ${e.name}`,
    };
  };

  return (
    <>
      {splash}
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
            <button className="icon-btn icon-btn--solid" onClick={openPlan} aria-label="Budget plan" title="Budget plan" style={{ width: 40, height: 40 }}>
              <Icon name="sliders" size={18} />
            </button>
            <button className="icon-btn icon-btn--solid" onClick={handleSignOut} aria-label="Sign out" title="Sign out" style={{ width: 40, height: 40 }}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <main key="dashboard" className="page" style={{ "--dir": dir }}>
            <PageHeader title={`Hello, ${userName}`} sub={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} />

            {!schemaReady ? (
              <div className="alert alert--neg" style={{ marginBottom: 16 }}>
                <Icon name="alert" size={16} />
                <span>One-time setup needed: run <b>supabase/budget_setup.sql</b> in your Supabase SQL editor to turn on budget plans and moving money.</span>
              </div>
            ) : !plan.saved && (
              <section className="card plan-prompt" style={{ marginBottom: 16 }}>
                <span className="quick__circle" style={{ background: "var(--lime)", color: "var(--ink)" }}><Icon name="sliders" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card__title">Set up your budget plan</div>
                  <div className="card__sub">Choose your tithe, how much of each salary you save, and how the rest splits between needs and wants.</div>
                </div>
                <button className="btn btn--primary btn--sm" onClick={openPlan}>Set up</button>
              </section>
            )}

            <div className="dash">
              {/* Hero: spendable balance */}
              <section className="card card--ink on-ink a-hero" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 28 }}>
                <div>
                  <div className="eyebrow">Savings balance</div>
                  <Money value={T.savings} className="money--hero" style={{ marginTop: 6, color: overdrawn ? "#ff8a80" : undefined }} />
                  <div className="card__sub" style={{ marginTop: 4 }}>After tithe and spending · {currency(T.emergency + T.invested)} set aside</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[["Needs", budget.needs], ["Wants", budget.wants]].map(([lbl, b]) => (
                    <div key={lbl}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                        <span style={{ color: "var(--text-on-ink-2)" }}>{lbl} this month</span>
                        {b.over
                          ? <span className="num" style={{ color: "#ff8a80" }}>{currency(b.left)} <span style={{ color: "var(--text-on-ink-2)" }}>from savings</span></span>
                          : <span className="num">{currency(b.spent)} <span style={{ color: "var(--text-on-ink-2)" }}>/ {currency(b.limit)}</span></span>}
                      </div>
                      <div className="meter" role="img" aria-label={`${lbl}: ${b.pct.toFixed(0)}% of this month's limit used`}>
                        {b.pct > 0 && <div className={`meter__fill${b.over ? " meter__fill--over" : ""}`} style={{ width: `${b.pct}%` }} />}
                      </div>
                    </div>
                  ))}
                  {!budget.active && <div style={{ fontSize: 12, color: "var(--text-on-ink-2)" }}>Needs and wants fill up once a salary is recorded.</div>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                  <button className="quick" onClick={() => isMobile ? openSheet("income") : incomeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                    <span className="quick__circle"><Icon name="plus" /></span>Income
                  </button>
                  <button className="quick" onClick={() => isMobile ? openSheet("expense") : go("expenses")}>
                    <span className="quick__circle"><Icon name="up" /></span>Expense
                  </button>
                  <button className="quick" onClick={() => openMove("Emergency")}>
                    <span className="quick__circle"><Icon name="shield" /></span>Set aside
                  </button>
                  <button className="quick" onClick={() => go("history")}>
                    <span className="quick__circle"><Icon name="download" /></span>Statement
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="eyebrow" style={{ marginBottom: 2 }}>Set aside</div>
                  {[
                    ["Emergency fund", T.emergency, "shield", T.emergency + T.invested > 0 ? (T.emergency / (T.emergency + T.invested)) * 100 : 0],
                    ["Investments", T.invested, "trend", T.emergency + T.invested > 0 ? (T.invested / (T.emergency + T.invested)) * 100 : 0],
                    ...(T.tithe > 0 || plan.titheOn ? [["Tithe given", T.tithe, "heartHand", null]] : []),
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
                    ["Kept in savings", mKept, mKept < 0 ? "neg" : null, "After tithe and spending"],
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
            <PageHeader title="Expenses" sub="Everything you've spent from your needs and wants" action={() => openSheet("expense")} actionLabel="Add expense" />

            <section className="card" style={{ marginBottom: 16 }}>
              <div className="card__head" style={{ marginBottom: 18 }}>
                <div>
                  <div className="card__title">This month's limits</div>
                  <div className="card__sub">{monthKeyLabel(curKey)} · <span className="num">{currency(mSpent)}</span> spent · <span className="num">{currency(T.spent)}</span> all time</div>
                </div>
              </div>
              {!budget.active ? (
                <EmptyState icon="income" title="No salary recorded yet" text="Needs and wants fill up once a salary is added." />
              ) : (
                <div className="budget-bars">
                  <BudgetBar label="Needs" b={budget.needs} color="var(--ink)" />
                  <BudgetBar label="Wants" b={budget.wants} color="var(--lime-chart)" />
                </div>
              )}
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
            <PageHeader title="Savings" sub="What's left after tithe and spending. Move some into your emergency fund or investments." action={() => openMove("Emergency")} actionLabel="Set aside" />
            <div className="split" style={{ marginBottom: 16 }}>
              <section className="card card--ink" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <div className="eyebrow">Savings balance</div>
                  <Money value={T.savings} className="money--hero" style={{ marginTop: 6, color: overdrawn ? "#ff8a80" : undefined }} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn--accent" onClick={() => openMove("Emergency")}><Icon name="shield" size={16} /> Add to emergency fund</button>
                  <button className="btn btn--secondary" onClick={() => openMove("Investment")}><Icon name="trend" size={16} /> Invest</button>
                </div>
                <div>
                  <div className="stack" style={{ height: 12 }} role="img" aria-label="Money set aside, split between emergency fund and investments">
                    {T.emergency + T.invested > 0
                      ? <>
                        <span style={{ flexGrow: T.emergency, background: "var(--lime)" }} />
                        <span style={{ flexGrow: T.invested, background: "#ffffff" }} />
                      </>
                      : <span style={{ flexGrow: 1, background: "var(--ink-3)" }} />}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  {[["Emergency fund", T.emergency, "var(--lime)", "shield"], ["Investments", T.invested, "#ffffff", "trend"]].map(([lbl, val, col, ic]) => (
                    <div key={lbl} className="tile">
                      <div className="legend__item" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-on-ink-2)" }}><span className="dot dot--sq" style={{ background: col }} />{lbl}</div>
                      <Money value={val} className="money--lg money--fit" style={{ marginTop: 6 }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: "var(--text-on-ink-2)" }}>
                        <Icon name={ic} size={13} /><span className="num">{T.emergency + T.invested > 0 ? ((val / (T.emergency + T.invested)) * 100).toFixed(0) : 0}% of set aside</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">Set aside each month</div>
                    <div className="card__sub">Last 12 months · average <b className="num" style={{ color: "var(--text)" }}>{currency(savings12 / 12)}</b> per month</div>
                  </div>
                  <div className="legend">
                    <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--ink)" }} />Set aside</span>
                    <span className="legend__item"><span className="dot dot--sq" style={{ background: "var(--lime-chart)" }} />This month</span>
                  </div>
                </div>
                {savings12 === 0 ? <EmptyState icon="wallet" title="Nothing set aside in the last year" text="Use Add to emergency fund or Invest to move money out of savings." /> : (
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={savingsSeries} barCategoryGap="28%" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--divider)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-3)", fontSize: 12, fontWeight: 600 }} interval="preserveStartEnd" minTickGap={4} />
                        <YAxis tickFormatter={compactINR} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--text-3)", fontSize: 12 }} />
                        <Tooltip cursor={{ fill: "var(--surface-2)", radius: 8 }} content={<ChartTooltip />} />
                        <Bar dataKey="saved" name="Set aside" radius={[4, 4, 0, 0]} maxBarSize={28}>
                          {savingsSeries.map(d => <Cell key={d.key} fill={d.current ? "var(--lime-chart)" : "var(--ink)"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </div>

            <section className="card">
              <div className="card__head" style={{ marginBottom: 12 }}><div className="card__title">Moves</div></div>
              {moves.length === 0 ? <EmptyState icon="wallet" title="Nothing moved yet" text="Money you add to your emergency fund or invest will be listed here." /> : (
                <div className="list">
                  {moves.map(m => {
                    const d = DESTINATIONS[m.destination];
                    return (
                      <TxRow key={m.id} icon={d.icon} iconClass={m.destination === "Investment" ? "row__icon--ink" : "row__icon--lime"} title={d.label}
                        meta={`${fmtDate(m.date)}${m.note ? ` · ${m.note}` : ""}`}
                        amount={m.amount} positive
                        onDelete={() => removeTransfer(m.id)} deleteLabel={`Undo move to ${d.label.toLowerCase()}`} />
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        )}

        {/* ══ GOALS ══ */}
        {tab === "goals" && (
          <main key="goals" className="page" style={{ "--dir": dir }}>
            <PageHeader title="Goals" sub="Targets you're saving toward" action={() => openSheet("goal")} actionLabel="New goal" />
            {listsSetupNote}
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
                      const submit = async () => { if (!(parseFloat(amt) > 0)) return; if (await fundGoal(g, amt)) setFundAmts(p => ({ ...p, [g.id]: "" })); else notify("Couldn't save. Check your connection and try again.", "neg"); };
                      return (
                        <article key={g.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span className="row__icon" style={{ color: g.color || "var(--ink)", borderRadius: 12 }}><Icon name="target" size={20} /></span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="row__title" style={{ fontSize: 16 }}>{g.name}</div>
                              {done ? <span className="badge badge--pos" style={{ marginTop: 2 }}><Icon name="check" size={12} stroke={2.4} />Completed</span>
                                : <div className="row__meta">{currency(g.target_amount - g.current_amount)} to go</div>}
                            </div>
                            <button className="icon-btn icon-btn--danger" onClick={async () => { haptic(14); if (await delGoal(g.id)) notify("Goal deleted"); else notify("Couldn't save. Check your connection and try again.", "neg"); }} aria-label={`Delete goal ${g.name}`} title="Delete goal"><Icon name="trash" size={16} /></button>
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
            {listsSetupNote}

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
                          onDelete={() => removeLoan(l)} deleteLabel={`Delete loan record for ${l.name}`} />
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
                      const submit = async () => { if (!(parseFloat(amt) > 0)) return; if (await repayLoan(l, amt)) setRepayAmts(p => ({ ...p, [l.id]: "" })); else notify("Couldn't save. Check your connection and try again.", "neg"); };
                      return (
                        <article key={l.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                            <span className="avatar" style={{ width: 40, height: 40, fontSize: 15 }}>{l.name.charAt(0)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="row__title" style={{ fontSize: 16 }}>{l.name}</div>
                              <div className="row__meta">{fmtDate(l.date)}{l.note ? ` · ${l.note}` : ""}</div>
                            </div>
                            <button className="icon-btn icon-btn--danger" onClick={() => removeLoan(l)} aria-label={`Delete loan to ${l.name}`} title="Delete loan"><Icon name="trash" size={16} /></button>
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
                          <button className="btn btn--outline btn--sm btn--block" onClick={async () => { haptic(12); if (await markLoanRepaid(l)) notify(`${l.name} marked as repaid`); else notify("Couldn't save. Check your connection and try again.", "neg"); }}><Icon name="check" size={15} /> Mark fully repaid</button>
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
                  const gKept = gIncome - group.entries.reduce((s, e) => s + e.tithe, 0) - gSpent;
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
                          {[["Income", gIncome, "pos"], ["Spent", gSpent, ""], ["Kept", gKept, gKept < 0 ? "neg" : ""]].map(([lbl, v, tone]) => (
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

        <footer className="credit" data-waiting={splashPhase !== "done"}>
          <Signature lead="Built by" name="Kery" />
        </footer>
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
// Maker's signature: each letter flickers through typefaces, then settles one by one.
// Plays on mount when `autoplay` (the launch splash), otherwise starts settled; hover or tap replays it.
const SIG_FACES = 7;
function Signature({ lead, name, autoplay = false }) {
  const [run, setRun] = useState(autoplay ? 1 : 0);
  const [faces, setFaces] = useState(() => [...name].map(() => (autoplay ? "idle" : "final")));
  const [settled, setSettled] = useState(!autoplay);

  useEffect(() => {
    if (!run || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let last = [];
    const id = setInterval(() => {
      const t = performance.now() - start;
      const next = [...name].map((_, i) => {
        if (t >= 520 + i * 150) return "final";
        let f; // never repeat the previous face, so every tick visibly changes
        do { f = Math.floor(Math.random() * SIG_FACES); } while (f === last[i]);
        return f;
      });
      last = next;
      setFaces(next);
      const done = next.every(f => f === "final");
      setSettled(done);
      if (done) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [run, name]);

  const replay = () => { setSettled(false); setRun(r => r + 1); };

  return (
    <span className="sig" data-settled={settled} onMouseEnter={replay} onClick={replay} role="img" aria-label={`${lead} ${name}`}>
      <span className="sig__lead" aria-hidden="true">{lead}</span>
      <span className="sig__name" aria-hidden="true">
        {[...name].map((ch, i) => (
          <span key={i} className="sig__cell">
            <span className="sig__size">{ch}</span>
            <span className={`sig__glyph sig__glyph--${faces[i]}`}>{ch}</span>
          </span>
        ))}
        <span className="sig__dot" />
      </span>
    </span>
  );
}

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
// A month's needs or wants limit: what's left up top, a bar of what's used, the figures underneath
function BudgetBar({ label, b, color }) {
  const used = Math.round(b.limit > 0 ? (b.spent / b.limit) * 100 : 0);
  const notes = [
    b.carried > 0 && `${currency(b.carried)} rolled over`,
    b.carried < 0 && `${currency(b.carried)} carried in`,
    b.repaid > 0 && `${currency(b.repaid)} paid back to savings`,
  ].filter(Boolean);
  return (
    <div className="budget-bar" data-over={b.over}>
      <div className="budget-bar__top">
        <span className="legend__item budget-bar__label"><span className="dot dot--sq" style={{ background: color }} />{label}</span>
        <span className="budget-bar__left">
          <Money value={b.left} className="money--lg" />
          <span>{b.over ? "from savings" : "left"}</span>
        </span>
      </div>
      <div className="budget-bar__track" role="img" aria-label={`${label}: ${used}% of ${currency(b.limit)} used`}>
        {b.spent > 0 && <div className="budget-bar__fill" style={{ width: `${b.pct}%`, background: b.over ? "var(--neg)" : color }} />}
      </div>
      <div className="budget-bar__foot">
        <span><b className="num">{currency(b.spent)}</b> used</span>
        <span className="num">{used}% of {currency(b.limit)}</span>
      </div>
      {(notes.length > 0 || b.over) && (
        <div className="budget-bar__foot" style={{ marginTop: 4 }}>
          <span>{b.over ? `Overspent, so ${currency(-b.left)} came out of savings. Your next salary pays it back.` : notes.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

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

function TxRow({ icon, iconClass = "", iconColor, title, meta, amount, positive, plain, amountClass, onDelete, deleteLabel, kind, onKind }) {
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
        {kind && (onKind
          ? <button type="button" className="kind-pill" data-kind={kind} onClick={onKind} title="Tap to switch need / want" aria-label={`Counts as a ${kind}. Switch to ${kind === "need" ? "want" : "need"}`}>{kind === "need" ? "Need" : "Want"}</button>
          : <span className="kind-pill" data-kind={kind}>{kind === "need" ? "Need" : "Want"}</span>)}
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
  // Ranked bars instead of a rainbow donut: the biggest category is the one lime mark, the rest stay ink
  const top = data.legend[0];
  return (
    <div className="cat-break">
      <div className="cat-break__total">
        <Money value={data.total} className="money--lg" />
        <span className="cat-break__lead">Most on <b>{top.name}</b> · {top.pct.toFixed(0)}%</span>
      </div>
      <ul className="cat-break__list">
        {data.legend.map((d, i) => (
          <li key={d.name} className="cat-break__row">
            <span className="cat-break__icon" aria-hidden="true"><Icon name={catMeta(d.name).icon} size={15} /></span>
            <div className="cat-break__body">
              <div className="cat-break__top">
                <span className="cat-break__name">{d.name}</span>
                <span className="cat-break__pct num">{d.pct.toFixed(0)}%</span>
                <span className="cat-break__amt num">{currency(d.value)}</span>
              </div>
              <div className="cat-break__track">
                <div className="cat-break__fill" data-top={i === 0} style={{ width: `${Math.max(d.pct, 1.5)}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FinDateSelector({ value, onChange, label = "Date" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (!ref.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    const handleKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, []);

  // The calendar renders in a portal on <body>, so a scrolling sheet or card can't clip it. On wider screens it's
  // pinned under the field (or above it when there's no room below); on phones CSS turns it into a bottom sheet.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const pop = popRef.current, btn = ref.current;
      if (!pop || !btn) return;
      if (window.innerWidth <= 600) { pop.style.top = pop.style.left = ""; return; }
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
      const below = r.bottom + gap + h <= window.innerHeight - gap || r.top - gap - h < gap;
      pop.style.top = `${below ? r.bottom + gap : r.top - gap - h}px`;
      pop.style.left = `${Math.min(Math.max(gap, r.left), window.innerWidth - w - gap)}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

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

      {open && createPortal(<>
        <div className="datepick__backdrop" onClick={() => setOpen(false)} />
        <div className="datepick__pop" ref={popRef} role="dialog" aria-label={label}>
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
      </>, document.body)}
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
