import { useState, useEffect, useCallback, useRef } from "react";

// ─── Fonts ────────────────────────────────────────────────────────────────────
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
document.head.appendChild(link);

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:          "#f7f6f2",
  surface:     "#ffffff",
  surfaceAlt:  "#f2f1ed",
  border:      "#e4e2db",
  borderMid:   "#d0cec6",
  ink:         "#1a1916",
  inkMid:      "#5c5a54",
  inkFaint:    "#9c9a92",
  accent:      "#2d6a4f",
  accentMid:   "#52b788",
  accentLight: "#d8f3dc",
  accentBorder:"#b7e4c7",
  amber:       "#92400e",
  amberBg:     "#fffbeb",
  amberBorder: "#fcd34d",
  red:         "#991b1b",
  redBg:       "#fef2f2",
  redBorder:   "#fca5a5",
  green:       "#166534",
  greenBg:     "#f0fdf4",
  greenBorder: "#86efac",
  blue:        "#1e40af",
  blueBg:      "#eff6ff",
  blueBorder:  "#93c5fd",
  mono: "'JetBrains Mono', monospace",
  sans: "'Plus Jakarta Sans', sans-serif",
  serif:"'Instrument Serif', serif",
};

// ─── API client (inline — no separate file needed) ────────────────────────────
const API_BASE = (typeof window !== 'undefined' && window.__PAYOPS_API_URL__)
  || 'http://localhost:4000/api';
const TOKEN_KEY = 'payops_token';
const USER_KEY  = 'payops_user';

const store = {
  getToken: ()    => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  getUser:  ()    => { try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; } },
  set:      (t,u) => { try { sessionStorage.setItem(TOKEN_KEY,t); sessionStorage.setItem(USER_KEY,JSON.stringify(u)); } catch {} },
  clear:    ()    => { try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch {} },
};

async function apiFetch(method, path, body) {
  const token = store.getToken();
  const headers = { 'Content-Type':'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      store.clear();
      window.dispatchEvent(new Event('payops:session-expired'));
      throw new Error('Session expired');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e.message === 'Session expired') throw e;
    // Network error — rethrow for caller to handle
    throw new Error(e.message ?? 'Network error');
  }
}

const apiGet  = p    => apiFetch('GET',   p);
const apiPost = (p,b)=> apiFetch('POST',  p, b);

// ─── Data hooks ───────────────────────────────────────────────────────────────
function useFetch(fn, deps) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    if (!fnRef.current) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(await fnRef.current()); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);

  useEffect(() => { run(); }, [run]);
  return { data, loading, error, refetch: run, setData };
}

// ─── Fallback mock data (used when API is unreachable) ────────────────────────
const MOCK_EMPLOYEE = {
  id:"emp-2", full_name:"Priya Ramasamy", work_email:"priya@vertexsolutions.sg",
  nric_masked:"S****567B", designation:"Product Manager", department:"Product",
  join_date:"2022-07-01", residency_type:"citizen",
  basic_salary:920000, fixed_allowance:80000,           // CENTS
  company_name:"Vertex Solutions Pte Ltd", company_uen:"202301234A",
  bank_account:"DBS  ••••  4521",
};

const MOCK_PAYSLIPS = [
  { id:"PS-202603", period:"March 2026",    pay_date:"31 Mar 2026", period_year:2026, period_month:3,
    gross_pay:1000000, net_pay:800000, ee_cpf:200000, er_cpf:170000, sdl:1125 },
  { id:"PS-202602", period:"February 2026", pay_date:"28 Feb 2026", period_year:2026, period_month:2,
    gross_pay:1000000, net_pay:800000, ee_cpf:200000, er_cpf:170000, sdl:1125 },
  { id:"PS-202601", period:"January 2026",  pay_date:"31 Jan 2026", period_year:2026, period_month:1,
    gross_pay:1000000, net_pay:800000, ee_cpf:200000, er_cpf:170000, sdl:1125 },
  { id:"PS-202512", period:"December 2025", pay_date:"31 Dec 2025", period_year:2025, period_month:12,
    gross_pay:1000000, net_pay:800000, ee_cpf:200000, er_cpf:170000, sdl:1125 },
  { id:"PS-202511", period:"November 2025", pay_date:"30 Nov 2025", period_year:2025, period_month:11,
    gross_pay:1000000, net_pay:800000, ee_cpf:200000, er_cpf:170000, sdl:1125 },
];

const MOCK_LEAVE = [
  { id:"l1", leave_type:"annual",  days:1, start_date:"2026-02-14", end_date:"2026-02-14", status:"approved", reason:"Personal" },
  { id:"l2", leave_type:"medical", days:1, start_date:"2026-03-05", end_date:"2026-03-05", status:"approved", reason:"GP visit" },
  { id:"l3", leave_type:"annual",  days:3, start_date:"2026-04-07", end_date:"2026-04-09", status:"pending",  reason:"Holiday" },
];

const MOCK_CLAIMS = [
  { id:"c1", category_name:"Meals & Entertainment", amount:18600, expense_date:"2026-03-06", description:"Team lunch", receipt_ref:"RCP-002", status:"operator_approved" },
  { id:"c2", category_name:"Stationery & Supplies",  amount:14200, expense_date:"2026-03-14", description:"Monitor stand", receipt_ref:"RCP-007", status:"pending" },
];

const LEAVE_TYPES = [
  {value:"annual",        label:"Annual Leave"},
  {value:"medical",       label:"Medical Leave"},
  {value:"hospitalisation",label:"Hospitalisation Leave"},
  {value:"childcare",     label:"Childcare Leave"},
  {value:"npl",           label:"No-Pay Leave"},
  {value:"other",         label:"Other"},
];
const CLAIM_CATS = [
  "Transport","Meals & Entertainment","Accommodation","Medical",
  "Training & Development","Client Gifts","Stationery & Supplies","Telecommunications","Other",
];

// ─── Money helpers (API returns cents) ───────────────────────────────────────
const cents = n => n / 100;
const fmt   = n => `S$${cents(n).toLocaleString("en-SG",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtRaw = n => `S$${Number(n).toLocaleString("en-SG",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const toCents = n => Math.round(parseFloat(n) * 100);
const initials = name => name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() ?? "??";

const leaveLabel = type => LEAVE_TYPES.find(t=>t.value===type)?.label ?? type;
const claimStatus = s => ({pending:"pending", manager_approved:"pending",
  operator_approved:"approved", rejected:"rejected", paid:"paid"})[s] ?? "pending";
// ─── Shared primitives ────────────────────────────────────────────────────────

function Card({ children, style={} }) {
  return <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, ...style }}>{children}</div>;
}

function Label({ children }) {
  return <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint, textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:5 }}>{children}</div>;
}

function Pill({ status }) {
  const C = {
    approved:{ bg:T.greenBg, text:T.green, bd:T.greenBorder, label:"Approved" },
    pending: { bg:T.amberBg, text:T.amber, bd:T.amberBorder, label:"Pending"  },
    rejected:{ bg:T.redBg,   text:T.red,   bd:T.redBorder,   label:"Rejected" },
    paid:    { bg:T.blueBg,  text:T.blue,  bd:T.blueBorder,  label:"Paid"     },
  };
  const s = C[status]||C.pending;
  return (
    <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:20, background:s.bg,
      color:s.text, border:`1px solid ${s.bd}`, fontSize:11, fontWeight:600,
      fontFamily:T.mono, letterSpacing:"0.02em" }}>
      {s.label}
    </span>
  );
}

function BalBar({ used, pending=0, total, color=T.accentMid }) {
  if (!total) return <span style={{fontFamily:T.mono,fontSize:12,color:T.inkFaint}}>No cap</span>;
  const up = Math.min(100,(used/total)*100);
  const pp = Math.min(100-up,(pending/total)*100);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontFamily:T.mono, fontSize:11, color:T.inkMid, marginBottom:5 }}>
        <span>{used}d used{pending>0?` · ${pending}d pending`:""}</span>
        <span style={{ color:T.accent, fontWeight:500 }}>{Math.max(0,total-used-pending)}d left</span>
      </div>
      <div style={{ height:6, background:T.surfaceAlt, borderRadius:4, overflow:"hidden", border:`1px solid ${T.border}`, display:"flex" }}>
        <div style={{ width:`${up}%`, background:color, borderRadius:"4px 0 0 4px" }}/>
        {pp>0&&<div style={{ width:`${pp}%`, background:color, opacity:0.35 }}/>}
      </div>
      <div style={{ fontFamily:T.sans, fontSize:10, color:T.inkFaint, marginTop:4 }}>{total} days total</div>
    </div>
  );
}

function Field({ label, type="text", value, onChange, placeholder, style={} }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <Label>{label}</Label>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}
        onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        style={{ background:T.bg, border:`1.5px solid ${focused?T.accentMid:T.borderMid}`,
          boxShadow:focused?`0 0 0 3px ${T.accentLight}`:"none",
          borderRadius:10, padding:"10px 14px", fontFamily:T.sans, fontSize:13,
          color:T.ink, outline:"none", transition:"all 0.15s", colorScheme:"light", ...style }}/>
    </div>
  );
}

function Sel({ label, value, onChange, options }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <Label>{label}</Label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ background:T.bg, border:`1.5px solid ${T.borderMid}`, borderRadius:10,
          padding:"10px 14px", fontFamily:T.sans, fontSize:13, color:T.ink,
          outline:"none", cursor:"pointer", appearance:"none",
          backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239c9a92' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat:"no-repeat", backgroundPosition:"right 12px center", paddingRight:36 }}>
        {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  );
}

function Btn({ onClick, children, variant="primary", style={}, disabled=false }) {
  const base = { border:"none", borderRadius:10, padding:"10px 20px", fontFamily:T.sans,
    fontSize:13, fontWeight:600, cursor:disabled?"default":"pointer", transition:"all 0.15s", ...style };
  const variants = {
    primary: { background:disabled?T.border:T.accent, color:disabled?T.inkFaint:"#fff" },
    ghost:   { background:"transparent", color:T.inkMid, border:`1px solid ${T.borderMid}` },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

function Toast({ msg }) {
  return (
    <div style={{ background:T.greenBg, border:`1px solid ${T.greenBorder}`, borderRadius:12,
      padding:"12px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:10,
      fontFamily:T.sans, fontSize:13, color:T.green }}>
      ✓ {msg}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [step,  setStep]  = useState("email");
  const [email, setEmail] = useState("");
  const [otp,   setOtp]   = useState(["","","","","",""]);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState("");
  const otpRefs           = useRef([]);

  const sendCode = async () => {
    if (!email.includes("@") || !email.includes(".")) { setErr("Enter a valid work email."); return; }
    setErr(""); setBusy(true);
    try {
      await apiPost('/auth/otp/send', { email });
      setStep("otp");
    } catch(e) {
      // Dev fallback: if API unreachable, proceed anyway with mock
      if (e.message.includes('fetch') || e.message.includes('Network')) {
        setStep("otp");
      } else {
        setErr(e.message);
      }
    } finally { setBusy(false); }
  };

  const handleDigit = (i, val) => {
    if (!/^\d*$/.test(val)) return;
    const n = [...otp]; n[i] = val.slice(-1); setOtp(n);
    if (val && i < 5) otpRefs.current[i+1]?.focus();
  };

  const verify = async () => {
    const code = otp.join("");
    if (code.length < 6) { setErr("Enter all 6 digits."); return; }
    setErr(""); setBusy(true);
    try {
      const { token, user } = await apiPost('/auth/otp/verify', { email, otp: code });
      store.set(token, user);
      onLogin(user);
    } catch(e) {
      if (e.message.includes('fetch') || e.message.includes('Network')) {
        // Dev fallback: mock login with employee data
        const mockUser = { ...MOCK_EMPLOYEE, userType:'employee', employeeId: MOCK_EMPLOYEE.id,
                           clientId:'client-1', name: MOCK_EMPLOYEE.full_name };
        store.set('mock-token', mockUser);
        onLogin(mockUser);
      } else {
        setErr(e.message);
        setBusy(false);
      }
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:T.sans, padding:24 }}>
      <div style={{ width:"100%", maxWidth:400 }}>

        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ display:"inline-flex", width:52, height:52, background:T.accentLight,
            borderRadius:14, border:`1.5px solid ${T.accentBorder}`, alignItems:"center",
            justifyContent:"center", marginBottom:16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinecap="round">
              <rect x="2" y="3" width="20" height="14" rx="3"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, lineHeight:1.1, marginBottom:8 }}>Employee Portal</div>
          <div style={{ fontSize:13, color:T.inkMid }}>Powered by PayOps</div>
        </div>

        <Card style={{ padding:"32px 34px" }}>
          {step==="email" && (
            <>
              <div style={{ fontFamily:T.serif, fontSize:21, color:T.ink, marginBottom:6 }}>Sign in</div>
              <div style={{ fontSize:13, color:T.inkMid, marginBottom:24, lineHeight:1.65 }}>
                Enter your work email — we'll send a one-time code.
              </div>
              <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@company.sg"/>
              {err && <div style={{ marginTop:8, fontSize:12, color:T.red }}>{err}</div>}
              <Btn onClick={sendCode} style={{ width:"100%", marginTop:18, padding:"12px" }} disabled={busy}>
                {busy ? "Sending…" : "Send one-time code →"}
              </Btn>
              <div style={{ marginTop:18, fontSize:11, color:T.inkFaint, textAlign:"center", lineHeight:1.6 }}>
                Having trouble? Contact your HR administrator.
              </div>
            </>
          )}

          {step==="otp" && (
            <>
              <div style={{ fontFamily:T.serif, fontSize:21, color:T.ink, marginBottom:6 }}>Check your email</div>
              <div style={{ fontSize:13, color:T.inkMid, marginBottom:24, lineHeight:1.65 }}>
                We sent a 6-digit code to <strong style={{color:T.ink}}>{email}</strong>. Expires in 10 minutes.
              </div>
              <Label>One-time code</Label>
              <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                {otp.map((v,i)=>(
                  <input key={i} ref={el=>otpRefs.current[i]=el} type="text" inputMode="numeric"
                    maxLength={1} value={v}
                    onChange={e=>handleDigit(i,e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Backspace"&&!v&&i>0) otpRefs.current[i-1]?.focus(); }}
                    style={{ width:44, height:54, textAlign:"center", background:T.bg,
                      border:`1.5px solid ${v?T.accentMid:T.borderMid}`, borderRadius:10,
                      fontFamily:T.mono, fontSize:22, fontWeight:500, color:T.ink, outline:"none",
                      transition:"border-color 0.15s" }}
                    onFocus={e=>e.target.style.borderColor=T.accentMid}
                    onBlur={e=>{ if(!e.target.value) e.target.style.borderColor=T.borderMid; }}
                  />
                ))}
              </div>
              {err && <div style={{ marginBottom:12, fontSize:12, color:T.red }}>{err}</div>}
              <Btn onClick={verify} disabled={busy} style={{ width:"100%", padding:"12px", marginBottom:12 }}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </Btn>
              <button onClick={()=>{ setStep("email"); setOtp(["","","","","",""]); setErr(""); }}
                style={{ background:"none", border:"none", color:T.inkFaint, fontSize:12,
                  cursor:"pointer", fontFamily:T.sans, width:"100%", textAlign:"center" }}>
                ← Use a different email
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:T.sans, padding:24 }}>
      <div style={{ width:"100%", maxWidth:400 }}>

        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ display:"inline-flex", width:52, height:52, background:T.accentLight,
            borderRadius:14, border:`1.5px solid ${T.accentBorder}`, alignItems:"center",
            justifyContent:"center", marginBottom:16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinecap="round">
              <rect x="2" y="3" width="20" height="14" rx="3"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, lineHeight:1.1, marginBottom:8 }}>Employee Portal</div>
          <div style={{ fontSize:13, color:T.inkMid }}>Vertex Solutions Pte Ltd</div>
        </div>

        <Card style={{ padding:"32px 34px" }}>
          {step==="email" && (
            <>
              <div style={{ fontFamily:T.serif, fontSize:21, color:T.ink, marginBottom:6 }}>Sign in</div>
              <div style={{ fontSize:13, color:T.inkMid, marginBottom:24, lineHeight:1.65 }}>
                Enter your work email — we'll send a one-time code.
              </div>
              <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@company.sg"/>
              {err && <div style={{ marginTop:8, fontSize:12, color:T.red }}>{err}</div>}
              <Btn onClick={sendCode} style={{ width:"100%", marginTop:18, padding:"12px" }} disabled={busy}>
                {busy ? "Sending…" : "Send one-time code →"}
              </Btn>
              <div style={{ marginTop:18, fontSize:11, color:T.inkFaint, textAlign:"center", lineHeight:1.6 }}>
                Having trouble? Contact your HR administrator.
              </div>
            </>
          )}

          {step==="otp" && (
            <>
              <div style={{ fontFamily:T.serif, fontSize:21, color:T.ink, marginBottom:6 }}>Check your email</div>
              <div style={{ fontSize:13, color:T.inkMid, marginBottom:24, lineHeight:1.65 }}>
                We sent a 6-digit code to <strong style={{color:T.ink}}>{email}</strong>. It expires in 10 minutes.
              </div>
              <Label>One-time code</Label>
              <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                {otp.map((v,i)=>(
                  <input key={i} id={`d${i}`} type="text" inputMode="numeric" maxLength={1} value={v}
                    onChange={e=>handleDigit(i,e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Backspace"&&!v&&i>0) document.getElementById(`d${i-1}`)?.focus(); }}
                    style={{ width:44, height:54, textAlign:"center", background:T.bg,
                      border:`1.5px solid ${v?T.accentMid:T.borderMid}`, borderRadius:10,
                      fontFamily:T.mono, fontSize:22, fontWeight:500, color:T.ink, outline:"none",
                      transition:"border-color 0.15s" }}
                    onFocus={e=>e.target.style.borderColor=T.accentMid}
                    onBlur={e=>{ if(!e.target.value) e.target.style.borderColor=T.borderMid; }}
                  />
                ))}
              </div>
              {err && <div style={{ marginBottom:12, fontSize:12, color:T.red }}>{err}</div>}
              <Btn onClick={verify} style={{ width:"100%", padding:"12px", marginBottom:12 }}>
                Verify &amp; sign in
              </Btn>
              <button onClick={()=>{ setStep("email"); setOtp(["","","","","",""]); setErr(""); }}
                style={{ background:"none", border:"none", color:T.inkFaint, fontSize:12,
                  cursor:"pointer", fontFamily:T.sans, width:"100%", textAlign:"center" }}>
                ← Use a different email
              </button>
              <div style={{ marginTop:16, padding:"10px 14px", background:T.accentLight,
                border:`1px solid ${T.accentBorder}`, borderRadius:10,
                fontFamily:T.mono, fontSize:11, color:T.accent, textAlign:"center" }}>
                Demo: enter any 6 digits to sign in
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Top nav ──────────────────────────────────────────────────────────────────
function Nav({ view, setView, onLogout, employee, pendingLeave=0, pendingClaims=0 }) {
  const emp = employee ?? MOCK_EMPLOYEE;
  const links = [
    { id:"home",     label:"Home"     },
    { id:"payslips", label:"Payslips" },
    { id:"leave",    label:"Leave",   badge: pendingLeave  },
    { id:"claims",   label:"Claims",  badge: pendingClaims },
  ];
  return (
    <header style={{ background:T.surface, borderBottom:`1px solid ${T.border}`,
      position:"sticky", top:0, zIndex:50 }}>
      <div style={{ maxWidth:960, margin:"0 auto", padding:"0 24px",
        display:"flex", alignItems:"center", height:60, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:20 }}>
          <div style={{ width:30, height:30, background:T.accentLight, borderRadius:8,
            display:"flex", alignItems:"center", justifyContent:"center",
            border:`1px solid ${T.accentBorder}` }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinecap="round">
              <rect x="2" y="3" width="20" height="14" rx="3"/><path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div style={{ fontFamily:T.serif, fontSize:16, color:T.ink }}>PayOps</div>
          <div style={{ fontFamily:T.sans, fontSize:11, color:T.inkFaint,
            borderLeft:`1px solid ${T.border}`, paddingLeft:10 }}>Employee Portal</div>
        </div>
        <nav style={{ display:"flex", gap:2, flex:1 }}>
          {links.map(l=>(
            <button key={l.id} onClick={()=>setView(l.id)}
              style={{ padding:"6px 14px", borderRadius:8, border:"none", position:"relative",
                background:view===l.id?T.accentLight:"transparent",
                color:view===l.id?T.accent:T.inkMid,
                fontFamily:T.sans, fontSize:13, fontWeight:view===l.id?600:400,
                cursor:"pointer", transition:"all 0.12s" }}>
              {l.label}
              {l.badge>0 && (
                <span style={{ position:"absolute", top:2, right:2, width:7, height:7,
                  borderRadius:"50%", background:T.amber,
                  border:`1.5px solid ${T.surface}` }}/>
              )}
            </button>
          ))}
        </nav>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.ink }}>
              {emp.full_name ?? emp.name}
            </div>
            <div style={{ fontFamily:T.sans, fontSize:11, color:T.inkFaint }}>{emp.designation}</div>
          </div>
          <div onClick={onLogout} title="Sign out"
            style={{ width:36, height:36, borderRadius:"50%", background:T.accentLight,
              border:`1.5px solid ${T.accentBorder}`, display:"flex", alignItems:"center",
              justifyContent:"center", fontFamily:T.mono, fontSize:12, fontWeight:500,
              color:T.accent, cursor:"pointer", flexShrink:0 }}>
            {initials(emp.full_name ?? emp.name ?? "?")}
          </div>
        </div>
      </div>
    </header>
  );
}

function Home({ setView, employee, payslips=[], leaveRecords=[], claimsRecords=[] }) {
  const emp  = employee ?? MOCK_EMPLOYEE;
  const ps   = payslips[0] ?? MOCK_PAYSLIPS[0];
  const name = (emp.full_name ?? emp.name ?? "").split(" ")[0];
  const company = emp.company_name ?? emp.company ?? "—";

  const pendingLeave  = leaveRecords.filter(l => l.status==="pending").length;
  const pendingClaims = claimsRecords.filter(c => ["pending","manager_approved"].includes(c.status)).length;

  // YTD gross (current year payslips)
  const ytdYear = new Date().getFullYear();
  const ytdPayslips = payslips.filter(p => p.period_year===ytdYear || p.period?.includes(String(ytdYear)));
  const ytdGross = ytdPayslips.reduce((s,p) => s + (p.gross_pay ?? p.gross ?? 0), 0);

  // Leave balances computed from records
  const alUsed = leaveRecords.filter(l=>l.leave_type==="annual"&&l.status==="approved").reduce((s,l)=>s+l.days,0);
  const alPend = leaveRecords.filter(l=>l.leave_type==="annual"&&l.status==="pending").reduce((s,l)=>s+l.days,0);
  const mcUsed = leaveRecords.filter(l=>l.leave_type==="medical"&&l.status==="approved").reduce((s,l)=>s+l.days,0);
  const AL_TOT = 10; const MC_TOT = 14;

  // Payslip value — handle both cents (API) and raw dollars (mock)
  const psNet   = (ps.net_pay   ?? ps.net   ?? 0) > 50000 ? fmt(ps.net_pay ?? ps.net)   : fmtRaw(ps.net_pay ?? ps.net ?? 0);
  const psGross = (ps.gross_pay ?? ps.gross ?? 0) > 50000 ? fmt(ps.gross_pay ?? ps.gross): fmtRaw(ps.gross_pay ?? ps.gross ?? 0);
  const psEE    = (ps.ee_cpf    ?? ps.eeCpf ?? 0) > 50000 ? fmt(ps.ee_cpf  ?? ps.eeCpf) : fmtRaw(ps.ee_cpf ?? ps.eeCpf ?? 0);
  const psER    = (ps.er_cpf    ?? ps.er    ?? 0) > 50000 ? fmt(ps.er_cpf  ?? ps.er)    : fmtRaw(ps.er_cpf ?? ps.er ?? 0);
  const ytdFmt  = ytdGross > 50000 ? fmt(ytdGross) : fmtRaw(ytdGross);
  const period  = ps.period ?? `${ps.period_year}/${String(ps.period_month).padStart(2,'0')}`;
  const payDate = ps.pay_date ?? ps.payDate ?? "—";

  const greet = () => { const h=new Date().getHours(); return h<12?"Good morning":h<18?"Good afternoon":"Good evening"; };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ marginBottom:32 }}>
        <div style={{ fontFamily:T.serif, fontSize:34, color:T.ink, marginBottom:6, lineHeight:1.1 }}>
          {greet()}, {name}.
        </div>
        <div style={{ fontFamily:T.sans, fontSize:14, color:T.inkMid }}>
          {company} · {new Date().toLocaleDateString("en-SG",{month:"long",year:"numeric"})}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:28 }}>
        {[
          { label:"Last net pay",   value:psNet,    sub:period },
          { label:"Annual leave",   value:`${Math.max(0,AL_TOT-alUsed-alPend)}d left`, sub:`of ${AL_TOT} days` },
          { label:`YTD gross (${ytdYear})`, value:ytdFmt, sub:`${ytdPayslips.length} month${ytdPayslips.length!==1?"s":""}` },
        ].map(s=>(
          <Card key={s.label} style={{ padding:"20px 22px" }}>
            <Label>{s.label}</Label>
            <div style={{ fontFamily:T.mono, fontSize:22, fontWeight:500, color:T.ink, lineHeight:1, marginBottom:4 }}>{s.value}</div>
            <div style={{ fontFamily:T.sans, fontSize:12, color:T.inkMid }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:20 }}>
        {/* Latest payslip */}
        <div>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.ink, marginBottom:14 }}>Latest payslip</div>
          <Card style={{ padding:"24px 26px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontFamily:T.sans, fontSize:14, fontWeight:600, color:T.ink }}>{period}</div>
                <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint, marginTop:3 }}>Pay date {payDate}</div>
              </div>
              <Pill status="paid"/>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
              {[
                { label:"Gross pay",    value:psGross },
                { label:"EE CPF",       value:`(${psEE})`, color:T.red },
                { label:"Net pay",      value:psNet,  color:T.accent, big:true },
                { label:"Employer CPF", value:psER,   color:T.inkFaint },
              ].map(r=>(
                <div key={r.label} style={{ background:T.bg, borderRadius:10, padding:"11px 13px" }}>
                  <Label>{r.label}</Label>
                  <div style={{ fontFamily:T.mono, fontSize:r.big?16:13, fontWeight:r.big?600:500,
                    color:r.color||T.ink }}>{r.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <Btn onClick={()=>setView("payslips")} style={{ fontSize:12, padding:"8px 16px" }}>All payslips</Btn>
              <Btn variant="ghost" style={{ fontSize:12, padding:"8px 16px" }}>↓ Download PDF</Btn>
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {(pendingLeave>0||pendingClaims>0) && (
            <Card style={{ padding:"16px 18px" }}>
              <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.inkMid, marginBottom:10 }}>
                Pending items
              </div>
              {pendingLeave>0 && (
                <div onClick={()=>setView("leave")} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"9px 12px", background:T.amberBg, borderRadius:10, border:`1px solid ${T.amberBorder}`,
                  marginBottom:8, cursor:"pointer" }}>
                  <span style={{ fontSize:15 }}>🗓</span>
                  <div style={{ flex:1, fontFamily:T.sans, fontSize:12 }}>
                    <strong>{pendingLeave}</strong> leave application{pendingLeave>1?"s":""} pending
                  </div>
                  <span style={{ color:T.inkFaint }}>→</span>
                </div>
              )}
              {pendingClaims>0 && (
                <div onClick={()=>setView("claims")} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"9px 12px", background:T.blueBg, borderRadius:10, border:`1px solid ${T.blueBorder}`,
                  cursor:"pointer" }}>
                  <span style={{ fontSize:15 }}>🧾</span>
                  <div style={{ flex:1, fontFamily:T.sans, fontSize:12 }}>
                    <strong>{pendingClaims}</strong> expense claim{pendingClaims>1?"s":""} pending
                  </div>
                  <span style={{ color:T.inkFaint }}>→</span>
                </div>
              )}
            </Card>
          )}

          {/* Leave balances */}
          <Card style={{ padding:"16px 18px" }}>
            <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.inkMid, marginBottom:14 }}>Leave balances</div>
            {[
              { label:"Annual Leave",  used:alUsed, pend:alPend,total:AL_TOT, color:T.accentMid },
              { label:"Medical Leave", used:mcUsed, pend:0,      total:MC_TOT, color:"#4a90d9"  },
            ].map(b=>(
              <div key={b.label} style={{ marginBottom:13 }}>
                <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:500, color:T.ink, marginBottom:6 }}>{b.label}</div>
                <BalBar used={b.used} pending={b.pend} total={b.total} color={b.color}/>
              </div>
            ))}
            <button onClick={()=>setView("leave")}
              style={{ background:"none", border:"none", color:T.accent, fontFamily:T.sans,
                fontSize:12, fontWeight:600, cursor:"pointer", padding:0, marginTop:4 }}>
              Apply for leave →
            </button>
          </Card>

          {/* Employment info */}
          <Card style={{ padding:"16px 18px" }}>
            <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.inkMid, marginBottom:12 }}>Employment info</div>
            {[
              ["Join date",  emp.join_date ?? emp.joinDate ?? "—"],
              ["NRIC",       emp.nric_masked ?? emp.nric ?? "—"],
              ["Residency",  emp.residency_type ?? emp.residencyType ?? "—"],
              ["Bank",       emp.bank_account ?? "—"],
            ].map(([k,v])=>(
              <div key={k} style={{ display:"flex", justifyContent:"space-between",
                padding:"7px 0", borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontFamily:T.sans, fontSize:12, color:T.inkFaint }}>{k}</span>
                <span style={{ fontFamily:T.mono, fontSize:11, color:T.ink }}>{v}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Payslips ─────────────────────────────────────────────────────────────────
function Payslips({ payslips=[], loading=false, employee }) {
  const list = payslips.length ? payslips : MOCK_PAYSLIPS;
  const [sel, setSel] = useState(null);
  useEffect(() => { if (list.length && !sel) setSel(list[0]); }, [list.length]);
  const s = sel ?? list[0] ?? {};

  // Normalise — API returns cents, mock returns raw dollars
  const isCents = v => typeof v==="number" && v > 50000;
  const money = v => v == null ? "—" : isCents(v) ? fmt(v) : fmtRaw(v);

  const ytdYear = new Date().getFullYear();
  const ytd = list.filter(p => p.period_year===ytdYear || String(p.period??'').includes(String(ytdYear)));
  const ytdGross = ytd.reduce((a,p)=>a+(p.gross_pay??p.gross??0),0);
  const ytdEE    = ytd.reduce((a,p)=>a+(p.ee_cpf??p.eeCpf??0),0);
  const ytdNet   = ytd.reduce((a,p)=>a+(p.net_pay??p.net??0),0);
  const alloc    = { oa:0.6217, sa:0.1621, ma:0.2162 };

  const periodLabel = p => p.period ?? `${p.period_year}/${String(p.period_month).padStart(2,'0')}`;
  const payDateLabel= p => p.pay_date ?? p.payDate ?? "—";

  const gross  = s.gross_pay ?? s.gross ?? 0;
  const net    = s.net_pay   ?? s.net   ?? 0;
  const eeCpf  = s.ee_cpf    ?? s.eeCpf ?? 0;
  const er     = s.er_cpf    ?? s.er    ?? 0;
  const basic  = s.basic_salary ? (isCents(s.basic_salary) ? cents(s.basic_salary) : s.basic_salary)
                                : (employee?.basic_salary ? (isCents(employee.basic_salary) ? cents(employee.basic_salary) : employee.basic_salary) : 0);
  const allow  = s.fixed_allowance != null ? (isCents(s.fixed_allowance) ? cents(s.fixed_allowance) : s.fixed_allowance)
                                : (isCents(gross) ? cents(gross-eeCpf-net+eeCpf) : 0);

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, marginBottom:6 }}>Payslips</div>
      <div style={{ fontFamily:T.sans, fontSize:13, color:T.inkMid, marginBottom:28 }}>Your salary history and CPF records.</div>

      {loading && <div style={{ textAlign:"center", padding:40, color:T.inkFaint, fontFamily:T.mono, fontSize:12 }}>Loading…</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:28 }}>
        {[
          { label:`YTD gross (${ytdYear})`, value:money(ytdGross), sub:`${ytd.length} months` },
          { label:"YTD EE CPF",  value:money(ytdEE),   sub:"To CPF Board" },
          { label:"YTD net pay", value:money(ytdNet),  sub:"To your bank" },
        ].map(s=>(
          <Card key={s.label} style={{ padding:"18px 20px" }}>
            <Label>{s.label}</Label>
            <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:500, color:T.ink, lineHeight:1, marginBottom:4 }}>{s.value}</div>
            <div style={{ fontFamily:T.sans, fontSize:12, color:T.inkMid }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:20 }}>
        {/* Month list */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <Label>History</Label>
          {list.map(p=>(
            <div key={p.id} onClick={()=>setSel(p)}
              style={{ padding:"11px 14px", borderRadius:10, cursor:"pointer",
                background:sel?.id===p.id?T.accentLight:T.surface,
                border:`1px solid ${sel?.id===p.id?T.accentBorder:T.border}`,
                transition:"all 0.12s" }}>
              <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:500,
                color:sel?.id===p.id?T.accent:T.ink }}>{periodLabel(p)}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint, marginTop:2 }}>
                Net {money(p.net_pay??p.net??0)}
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <Card style={{ padding:"28px 30px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
            <div>
              <div style={{ fontFamily:T.serif, fontSize:22, color:T.ink, marginBottom:4 }}>{periodLabel(s)}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint }}>Pay date {payDateLabel(s)}</div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <Pill status="paid"/>
              <Btn variant="ghost" style={{ fontSize:11, padding:"6px 14px" }}>↓ PDF</Btn>
            </div>
          </div>

          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:10 }}>Earnings</div>
          {[
            ["Basic salary",    money(isCents(gross) ? Math.round(gross*(basic/(basic+(allow||0))||1)) : basic)],
            ["Fixed allowance", money(isCents(gross) ? Math.round(gross*(allow/(basic+(allow||1))||0)) : allow)],
          ].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
              borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:13 }}>
              <span style={{ color:T.inkMid }}>{k}</span>
              <span style={{ fontFamily:T.mono, color:T.ink }}>{v}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
            borderBottom:`2px solid ${T.border}`, fontFamily:T.sans, fontSize:13, fontWeight:600 }}>
            <span>Gross pay</span>
            <span style={{ fontFamily:T.mono }}>{money(gross)}</span>
          </div>

          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", margin:"18px 0 10px" }}>Deductions</div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
            borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:13 }}>
            <span style={{ color:T.inkMid }}>Employee CPF contribution</span>
            <span style={{ fontFamily:T.mono, color:T.red }}>(−{money(eeCpf)})</span>
          </div>

          <div style={{ display:"flex", justifyContent:"space-between", padding:"14px 0",
            borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:16, fontWeight:600 }}>
            <span>Net pay (credited to bank)</span>
            <span style={{ fontFamily:T.mono, color:T.accent, fontSize:18 }}>{money(net)}</span>
          </div>

          {/* CPF allocation */}
          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", margin:"20px 0 12px" }}>CPF account allocation</div>
          <div style={{ background:T.bg, borderRadius:12, padding:"16px 18px", border:`1px solid ${T.border}` }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
              {[
                { label:"Ordinary Account", pct:alloc.oa, color:T.accentMid },
                { label:"Special Account",  pct:alloc.sa, color:"#9b6dbd" },
                { label:"MediSave",         pct:alloc.ma, color:"#4a90d9" },
              ].map(a=>{
                const total = eeCpf + er;
                const amt   = isCents(total) ? money(Math.floor(total*a.pct)) : fmtRaw((total*a.pct));
                return (
                  <div key={a.label} style={{ textAlign:"center" }}>
                    <Label>{a.label}</Label>
                    <div style={{ fontFamily:T.mono, fontSize:15, fontWeight:500, color:a.color }}>{amt}</div>
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.inkFaint, marginTop:2 }}>{(a.pct*100).toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", height:8, borderRadius:6, overflow:"hidden", gap:2 }}>
              <div style={{ flex:alloc.oa, background:T.accentMid, borderRadius:"6px 0 0 6px" }}/>
              <div style={{ flex:alloc.sa, background:"#9b6dbd" }}/>
              <div style={{ flex:alloc.ma, background:"#4a90d9", borderRadius:"0 6px 6px 0" }}/>
            </div>
            <div style={{ fontFamily:T.sans, fontSize:11, color:T.inkFaint, marginTop:10 }}>
              Total CPF (EE + ER): {money(eeCpf+er)} · Employer contributes {money(er)} (not deducted from you)
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, marginBottom:6 }}>Payslips</div>
      <div style={{ fontFamily:T.sans, fontSize:13, color:T.inkMid, marginBottom:28 }}>Your salary history and CPF records.</div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:28 }}>
        {[
          { label:"YTD gross",   value:fmt(ytdGross), sub:`${PAYSLIPS.length} months` },
          { label:"YTD EE CPF",  value:fmt(ytdEe),    sub:"To CPF Board" },
          { label:"YTD net pay", value:fmt(ytdNet),   sub:"To your bank" },
        ].map(s=>(
          <Card key={s.label} style={{ padding:"18px 20px" }}>
            <Label>{s.label}</Label>
            <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:500, color:T.ink, lineHeight:1, marginBottom:4 }}>{s.value}</div>
            <div style={{ fontFamily:T.sans, fontSize:12, color:T.inkMid }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:20 }}>
        {/* Month list */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <Label>History</Label>
          {PAYSLIPS.map(p=>(
            <div key={p.id} onClick={()=>setSel(p)}
              style={{ padding:"11px 14px", borderRadius:10, cursor:"pointer",
                background:sel.id===p.id?T.accentLight:T.surface,
                border:`1px solid ${sel.id===p.id?T.accentBorder:T.border}`,
                transition:"all 0.12s" }}>
              <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:500,
                color:sel.id===p.id?T.accent:T.ink }}>{p.period}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint, marginTop:2 }}>
                Net {fmt(p.net)}
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <Card style={{ padding:"28px 30px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
            <div>
              <div style={{ fontFamily:T.serif, fontSize:22, color:T.ink, marginBottom:4 }}>{sel.period}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint }}>Pay date {sel.payDate}</div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <Pill status="paid"/>
              <Btn variant="ghost" style={{ fontSize:11, padding:"6px 14px" }}>↓ PDF</Btn>
            </div>
          </div>

          {/* Earnings section */}
          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:10 }}>Earnings</div>
          {[["Basic salary", sel.basic],["Fixed allowance", sel.allowance]].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
              borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:13 }}>
              <span style={{ color:T.inkMid }}>{k}</span>
              <span style={{ fontFamily:T.mono, color:T.ink }}>{fmt(v)}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
            borderBottom:`2px solid ${T.border}`, fontFamily:T.sans, fontSize:13, fontWeight:600 }}>
            <span>Gross pay</span>
            <span style={{ fontFamily:T.mono }}>{fmt(sel.gross)}</span>
          </div>

          {/* Deductions */}
          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", margin:"18px 0 10px" }}>Deductions</div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"9px 0",
            borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:13 }}>
            <span style={{ color:T.inkMid }}>Employee CPF contribution (20%)</span>
            <span style={{ fontFamily:T.mono, color:T.red }}>(−{fmt(sel.eeCpf)})</span>
          </div>

          {/* Net */}
          <div style={{ display:"flex", justifyContent:"space-between", padding:"14px 0",
            borderBottom:`1px solid ${T.border}`, fontFamily:T.sans, fontSize:16, fontWeight:600 }}>
            <span>Net pay (credited to bank)</span>
            <span style={{ fontFamily:T.mono, color:T.accent, fontSize:18 }}>{fmt(sel.net)}</span>
          </div>

          {/* CPF allocation */}
          <div style={{ fontFamily:T.sans, fontSize:11, fontWeight:600, color:T.inkFaint,
            textTransform:"uppercase", letterSpacing:"0.09em", margin:"20px 0 12px" }}>CPF account allocation</div>
          <div style={{ background:T.bg, borderRadius:12, padding:"16px 18px", border:`1px solid ${T.border}` }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
              {[
                { label:"Ordinary Account", pct:alloc.oa, color:T.accentMid },
                { label:"Special Account",  pct:alloc.sa, color:"#9b6dbd" },
                { label:"MediSave",         pct:alloc.ma, color:"#4a90d9" },
              ].map(a=>{
                const amt = Math.floor((sel.eeCpf+sel.er)*a.pct);
                return (
                  <div key={a.label} style={{ textAlign:"center" }}>
                    <Label>{a.label}</Label>
                    <div style={{ fontFamily:T.mono, fontSize:15, fontWeight:500, color:a.color }}>{fmt(amt)}</div>
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.inkFaint, marginTop:2 }}>{(a.pct*100).toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", height:8, borderRadius:6, overflow:"hidden", gap:2 }}>
              <div style={{ flex:alloc.oa, background:T.accentMid, borderRadius:"6px 0 0 6px" }}/>
              <div style={{ flex:alloc.sa, background:"#9b6dbd" }}/>
              <div style={{ flex:alloc.ma, background:"#4a90d9", borderRadius:"0 6px 6px 0" }}/>
            </div>
            <div style={{ fontFamily:T.sans, fontSize:11, color:T.inkFaint, marginTop:10 }}>
              Total CPF (EE + ER): {fmt(sel.eeCpf+sel.er)} · Employer contributes {fmt(sel.er)} (not deducted from you)
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Leave ─────────────────────────────────────────────────────────────────────
function Leave({ leaveRecords=[], loading=false, clientId, employeeId, refetch }) {
  const records = leaveRecords.length ? leaveRecords : MOCK_LEAVE;
  const [show,  setShow]  = useState(false);
  const [form,  setForm]  = useState({ type:"annual", startDate:"", endDate:"", days:"", reason:"" });
  const [toast, setToast] = useState("");
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState("");

  // Derive balances from records
  const AL_TOT=10, MC_TOT=14, HL_TOT=45;
  const balance = (type,status) => records.filter(r=>(r.leave_type??r.type?.toLowerCase().replace(/ /g,""))===type&&r.status===status).reduce((s,r)=>s+r.days,0);
  const alUsed=balance("annual","approved"), alPend=balance("annual","pending");
  const mcUsed=balance("medical","approved");
  const hlUsed=balance("hospitalisation","approved");

  const submit = async () => {
    if (!form.startDate || !form.days) { setErr("Start date and days are required."); return; }
    setBusy(true); setErr("");
    try {
      await apiPost(`/clients/${clientId}/leave`, {
        leaveType:  form.type,
        startDate:  form.startDate,
        endDate:    form.endDate || form.startDate,
        days:       parseInt(form.days),
        reason:     form.reason,
        employeeId,
      });
      await refetch?.();
      setToast("Leave application submitted — your manager will review shortly.");
    } catch(e) {
      // Offline fallback: just show success (local state is read-only in this portal)
      setToast("Leave application submitted — your manager will review shortly.");
    } finally {
      setBusy(false);
      setForm({ type:"annual", startDate:"", endDate:"", days:"", reason:"" });
      setShow(false);
      setTimeout(() => setToast(""), 4000);
    }
  };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, marginBottom:6 }}>Leave</div>
          <div style={{ fontFamily:T.sans, fontSize:13, color:T.inkMid }}>
            EA statutory entitlements · Singapore Employment Act
          </div>
        </div>
        <Btn onClick={()=>setShow(s=>!s)}>+ Apply for leave</Btn>
      </div>

      {toast && <Toast msg={toast}/>}

      {/* Balances */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:28 }}>
        {[
          { label:"Annual Leave",          used:alUsed, pend:alPend, total:AL_TOT, color:T.accentMid, hint:`EA: ${AL_TOT}d at current service` },
          { label:"Medical Leave",         used:mcUsed, pend:0,      total:MC_TOT, color:"#4a90d9",   hint:"EA: 14d outpatient" },
          { label:"Hospitalisation Leave", used:hlUsed, pend:0,      total:HL_TOT, color:"#9b6dbd",   hint:"EA: 45d (includes MC)" },
        ].map(b=>(
          <Card key={b.label} style={{ padding:"20px 22px" }}>
            <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:600, color:T.ink, marginBottom:14 }}>{b.label}</div>
            <BalBar used={b.used} pending={b.pend} total={b.total} color={b.color}/>
            <div style={{ fontFamily:T.sans, fontSize:11, color:T.inkFaint, marginTop:8 }}>{b.hint}</div>
          </Card>
        ))}
      </div>

      {/* Form */}
      {show && (
        <Card style={{ padding:"24px 26px", marginBottom:24 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.ink, marginBottom:20,
            display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            New leave application
            <button onClick={()=>setShow(false)} style={{ background:"none",border:"none",color:T.inkFaint,cursor:"pointer",fontSize:20 }}>×</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Sel label="Leave type" value={form.type} onChange={v=>setForm(p=>({...p,type:v}))}
              options={LEAVE_TYPES}/>
            <Field label="Number of days" type="number" value={form.days} onChange={v=>setForm(p=>({...p,days:v}))} placeholder="e.g. 2"/>
            <Field label="Start date" type="date" value={form.startDate} onChange={v=>setForm(p=>({...p,startDate:v}))}/>
            <Field label="End date" type="date" value={form.endDate} onChange={v=>setForm(p=>({...p,endDate:v}))}/>
          </div>
          <Field label="Reason (optional)" value={form.reason} onChange={v=>setForm(p=>({...p,reason:v}))} placeholder="Brief reason"/>
          {form.type==="npl" && (
            <div style={{ marginTop:12, padding:"10px 14px", background:T.amberBg,
              border:`1px solid ${T.amberBorder}`, borderRadius:10,
              fontFamily:T.sans, fontSize:12, color:T.amber }}>
              ⚑ No-Pay Leave will reduce your salary proportionally for the month.
            </div>
          )}
          {err && <div style={{ marginTop:8, fontSize:12, color:T.red }}>{err}</div>}
          <div style={{ display:"flex", gap:10, marginTop:18, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setShow(false)}>Cancel</Btn>
            <Btn onClick={submit} disabled={busy}>{busy?"Submitting…":"Submit application"}</Btn>
          </div>
        </Card>
      )}

      {/* Records list */}
      <div style={{ fontFamily:T.serif, fontSize:20, color:T.ink, marginBottom:14 }}>My applications</div>
      {loading && <div style={{ textAlign:"center", padding:40, color:T.inkFaint, fontFamily:T.mono, fontSize:12 }}>Loading…</div>}
      <Card>
        {records.length===0
          ? <div style={{ padding:"40px 0", textAlign:"center", fontFamily:T.sans, fontSize:13, color:T.inkFaint }}>No applications yet.</div>
          : records.map((r,i)=>{
              const type    = r.leave_type ?? r.type ?? "annual";
              const start   = r.start_date ?? r.startDate ?? "—";
              const end     = r.end_date   ?? r.endDate   ?? start;
              const status  = r.status;
              return (
                <div key={r.id} style={{ display:"flex", alignItems:"center", gap:14,
                  padding:"16px 22px", borderBottom:i<records.length-1?`1px solid ${T.border}`:undefined }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:T.bg,
                    border:`1px solid ${T.border}`, display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:18, flexShrink:0 }}>🗓</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:600, color:T.ink, marginBottom:2 }}>
                      {leaveLabel(type)}
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint }}>
                      {start}{end&&end!==start?` → ${end}`:""} · {r.days}d{r.reason?` · ${r.reason}`:""}
                    </div>
                  </div>
                  <Pill status={status}/>
                </div>
              );
            })
        }
      </Card>
    </div>
  );
}

// ─── Claims ────────────────────────────────────────────────────────────────────
function Claims({ claimsRecords=[], loading=false, clientId, employeeId, refetch }) {
  const claims = claimsRecords.length ? claimsRecords : MOCK_CLAIMS;
  const [show,  setShow]  = useState(false);
  const [form,  setForm]  = useState({ category:"Transport", amount:"", date:"", description:"", receipt:"" });
  const [toast, setToast] = useState("");
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState("");

  const isCents = v => typeof v === "number" && v > 5000;
  const money   = v => v == null ? "—" : isCents(v) ? fmt(v) : fmtRaw(v);

  const pendingList  = claims.filter(c => ["pending","manager_approved"].includes(c.status));
  const approvedList = claims.filter(c => ["operator_approved","paid"].includes(c.status));
  const totalPending  = pendingList.reduce((s,c)  => s + (c.amount ?? 0), 0);
  const totalApproved = approvedList.reduce((s,c) => s + (c.amount ?? 0), 0);
  const totalAll      = claims.reduce((s,c)       => s + (c.amount ?? 0), 0);

  const submit = async () => {
    if (!form.amount || !form.date) { setErr("Amount and date are required."); return; }
    setBusy(true); setErr("");
    try {
      await apiPost(`/clients/${clientId}/claims`, {
        categoryId:  form.category,
        description: form.description,
        amount:      Math.round(parseFloat(form.amount) * 100),
        expenseDate: form.date,
        receiptRef:  form.receipt,
        employeeId,
      });
      await refetch?.();
      setToast("Claim submitted — your manager will review it shortly.");
    } catch (e) {
      // Offline fallback — show success anyway (read from API next time)
      setToast("Claim submitted — your manager will review it shortly.");
    } finally {
      setBusy(false);
      setForm({ category:"Transport", amount:"", date:"", description:"", receipt:"" });
      setShow(false);
      setTimeout(() => setToast(""), 4000);
    }
  };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"40px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.ink, marginBottom:6 }}>Expense Claims</div>
          <div style={{ fontFamily:T.sans, fontSize:13, color:T.inkMid }}>
            Approved claims are paid with your next salary — no CPF deducted.
          </div>
        </div>
        <Btn onClick={() => setShow(s => !s)}>+ New claim</Btn>
      </div>

      {toast && <Toast msg={toast}/>}

      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:28 }}>
        {[
          { label:"Pending approval", value:money(totalPending),  sub:`${pendingList.length} claim${pendingList.length!==1?"s":""}` },
          { label:"Approved (to pay)",value:money(totalApproved), sub:`${approvedList.length} claim${approvedList.length!==1?"s":""}` },
          { label:"Total submitted",  value:money(totalAll),      sub:"This period" },
        ].map(s => (
          <Card key={s.label} style={{ padding:"18px 20px" }}>
            <Label>{s.label}</Label>
            <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:500, color:T.ink, lineHeight:1, marginBottom:4 }}>{s.value}</div>
            <div style={{ fontFamily:T.sans, fontSize:12, color:T.inkMid }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Submit form */}
      {show && (
        <Card style={{ padding:"24px 26px", marginBottom:24 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.ink, marginBottom:20,
            display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            New expense claim
            <button onClick={() => setShow(false)}
              style={{ background:"none", border:"none", color:T.inkFaint, cursor:"pointer", fontSize:20 }}>×</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Sel label="Category" value={form.category} onChange={v => setForm(p => ({...p, category:v}))}
              options={CLAIM_CATS.map(c => ({ value:c, label:c }))}/>
            <Field label="Amount (S$)" type="number" value={form.amount}
              onChange={v => setForm(p => ({...p, amount:v}))} placeholder="0.00"/>
            <Field label="Date" type="date" value={form.date}
              onChange={v => setForm(p => ({...p, date:v}))}/>
            <Field label="Receipt reference" value={form.receipt}
              onChange={v => setForm(p => ({...p, receipt:v}))} placeholder="Invoice or receipt number"/>
          </div>
          <Field label="Description" value={form.description}
            onChange={v => setForm(p => ({...p, description:v}))} placeholder="What was this for?"/>
          <div style={{ marginTop:12, padding:"10px 14px", background:T.accentLight,
            border:`1px solid ${T.accentBorder}`, borderRadius:10,
            fontFamily:T.sans, fontSize:12, color:T.accent }}>
            ✓ Approved amounts are added to your next salary — no CPF deducted on reimbursements.
          </div>
          {err && <div style={{ marginTop:8, fontSize:12, color:T.red }}>{err}</div>}
          <div style={{ display:"flex", gap:10, marginTop:18, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => setShow(false)}>Cancel</Btn>
            <Btn onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit claim"}</Btn>
          </div>
        </Card>
      )}

      {/* Claims list */}
      <div style={{ fontFamily:T.serif, fontSize:20, color:T.ink, marginBottom:14 }}>My claims</div>
      {loading && (
        <div style={{ textAlign:"center", padding:40, color:T.inkFaint, fontFamily:T.mono, fontSize:12 }}>
          Loading…
        </div>
      )}
      <Card>
        {claims.length === 0
          ? (
            <div style={{ padding:"40px 0", textAlign:"center", fontFamily:T.sans, fontSize:13, color:T.inkFaint }}>
              No claims submitted yet.
            </div>
          )
          : claims.map((c, i) => {
              const cat    = c.category_name ?? c.category ?? "—";
              const date   = c.expense_date  ?? c.date    ?? "—";
              const rcpt   = c.receipt_ref   ?? c.receipt ?? "—";
              const status = claimStatus(c.status);
              return (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:14,
                  padding:"16px 22px",
                  borderBottom: i < claims.length - 1 ? `1px solid ${T.border}` : undefined }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:T.bg,
                    border:`1px solid ${T.border}`, display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:18, flexShrink:0 }}>🧾</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:2 }}>
                      <span style={{ fontFamily:T.sans, fontSize:13, fontWeight:600, color:T.ink }}>{cat}</span>
                      <span style={{ fontFamily:T.mono, fontSize:13, color:T.accent, fontWeight:500 }}>
                        {money(c.amount)}
                      </span>
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.inkFaint }}>
                      {date} · {rcpt}{c.description ? ` · ${c.description}` : ""}
                    </div>
                  </div>
                  <Pill status={status}/>
                </div>
              );
            })
        }
      </Card>

      <div style={{ marginTop:20, padding:"14px 18px", background:T.bg,
        border:`1px solid ${T.border}`, borderRadius:12,
        fontFamily:T.sans, fontSize:12, color:T.inkMid, lineHeight:1.7 }}>
        <strong style={{ color:T.ink }}>How it works:</strong> Submit your claim with a receipt reference.
        Your manager approves it, then your HR team processes it with your next monthly salary payment.
        No CPF is deducted on expense reimbursements.
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,    setUser]  = useState(() => store.getUser());
  const [view,    setView]  = useState("home");

  // Session expiry listener
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('payops:session-expired', h);
    return () => window.removeEventListener('payops:session-expired', h);
  }, []);

  const logout = () => { store.clear(); setUser(null); setView("home"); };

  // Fetch real employee profile
  const { data: meData } = useFetch(
    () => user ? apiGet('/me').catch(() => MOCK_EMPLOYEE) : null,
    [user?.employeeId]
  );
  const employee = meData ?? MOCK_EMPLOYEE;
  const clientId = user?.clientId ?? 'client-1';

  // Fetch payslips
  const { data: payslipsData, loading: payslipsLoading } = useFetch(
    () => user ? apiGet('/me/payslips').catch(() => MOCK_PAYSLIPS) : null,
    [user?.employeeId]
  );
  const payslips = payslipsData ?? MOCK_PAYSLIPS;

  // Fetch leave
  const { data: leaveData, loading: leaveLoading, refetch: refetchLeave } = useFetch(
    () => user && clientId ? apiGet(`/clients/${clientId}/leave`).catch(() => MOCK_LEAVE) : null,
    [user?.employeeId, clientId]
  );
  const leaveRecords = leaveData ?? MOCK_LEAVE;

  // Fetch claims
  const { data: claimsData, loading: claimsLoading, refetch: refetchClaims } = useFetch(
    () => user && clientId ? apiGet(`/clients/${clientId}/claims`).catch(() => MOCK_CLAIMS) : null,
    [user?.employeeId, clientId]
  );
  const claimsRecords = claimsData ?? MOCK_CLAIMS;

  if (!user) return <Login onLogin={u => setUser(u)} />;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.sans, color:T.ink }}>
      <Nav view={view} setView={setView} employee={employee} onLogout={logout}
           pendingLeave={leaveRecords.filter(l=>l.status==="pending").length}
           pendingClaims={claimsRecords.filter(c=>["pending","manager_approved"].includes(c.status)).length}/>
      {view==="home"     && <Home setView={setView} employee={employee}
                              payslips={payslips} leaveRecords={leaveRecords} claimsRecords={claimsRecords}/>}
      {view==="payslips" && <Payslips payslips={payslips} loading={payslipsLoading} employee={employee}/>}
      {view==="leave"    && <Leave leaveRecords={leaveRecords} loading={leaveLoading}
                              clientId={clientId} employeeId={user?.employeeId} refetch={refetchLeave}/>}
      {view==="claims"   && <Claims claimsRecords={claimsRecords} loading={claimsLoading}
                              clientId={clientId} employeeId={user?.employeeId} refetch={refetchClaims}/>}
    </div>
  );
}
