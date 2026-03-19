import { useState, useEffect, useCallback, useRef } from "react";

// ─── Inline API client (no separate file needed in single-JSX artifact) ───────
const BASE_URL = (typeof import !== 'undefined' && typeof process !== 'undefined')
  ? (process.env?.VITE_API_URL ?? 'http://localhost:4000/api')
  : 'http://localhost:4000/api';

const TOKEN_KEY = 'payops_token';
const USER_KEY  = 'payops_user';

const authStore = {
  getToken: ()    => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  getUser:  ()    => { try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; } },
  set:      (t,u) => { try { sessionStorage.setItem(TOKEN_KEY,t); sessionStorage.setItem(USER_KEY,JSON.stringify(u)); } catch {} },
  clear:    ()    => { try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch {} },
};

async function apiFetch(method, path, body) {
  const token = authStore.getToken();
  const headers = { 'Content-Type':'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    authStore.clear();
    window.dispatchEvent(new Event('payops:session-expired'));
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const apiGet  = (path)        => apiFetch('GET',   path);
const apiPost = (path, body)  => apiFetch('POST',  path, body);
const apiPatch= (path, body)  => apiFetch('PATCH', path, body);

// ─── Shared fetch hook ────────────────────────────────────────────────────────
function useFetch(fn, deps) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const run = useCallback(async () => {
    if (!fn) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(await fn()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, refetch: run, setData };
}

// ─── Money helpers ────────────────────────────────────────────────────────────
// API returns INTEGER CENTS — divide by 100 for display
const fromCents = n => n / 100;
const toCents   = n => Math.round(parseFloat(n) * 100);
// Override fmt to handle cents from API gracefully
// (mock data uses dollar values, API returns cents — detect by magnitude)
const isCents = n => typeof n === 'number' && n > 10000; // heuristic: > $100 stored value

// ─── Fonts ────────────────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap";
document.head.appendChild(fontLink);

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const T = {
  bg0:"#0d1117", bg1:"#161b22", bg2:"#1c2128", bg3:"#21262d",
  border:"#30363d", borderStrong:"#484f58",
  text0:"#e6edf3", text1:"#8b949e", text2:"#6e7681",
  accent:"#58a6ff", accentDim:"#1f3a5a",
  green:"#3fb950", greenDim:"#1b3a24",
  amber:"#d29922", amberDim:"#3a2a0a",
  red:"#f85149", redDim:"#3d1a19",
  purple:"#bc8cff", purpleDim:"#2e1f4a",
  teal:"#39d353",
  mono:"'DM Mono', monospace",
  sans:"'DM Sans', sans-serif",
  display:"'Syne', sans-serif",
};

// ─── CPF Engine (embedded) ────────────────────────────────────────────────────
const OW_CEILING        = 8000;
const AW_CEILING_ANNUAL = 102000;
const SDL_MAX           = 11.25;
const SDL_MIN           = 2.00;

const CPF_RATES_TABLE = {
  citizen: [
    { maxAge:35,       eeRate:0.20,  erRate:0.17   },
    { maxAge:45,       eeRate:0.20,  erRate:0.17   },
    { maxAge:50,       eeRate:0.20,  erRate:0.17   },
    { maxAge:55,       eeRate:0.15,  erRate:0.145  },
    { maxAge:60,       eeRate:0.18,  erRate:0.16   },  // updated Jan 2026
    { maxAge:65,       eeRate:0.125, erRate:0.115  },  // updated Jan 2026
    { maxAge:Infinity, eeRate:0.05,  erRate:0.075  },
  ],
  pr1: [{ maxAge:Infinity, eeRate:0.05, erRate:0.04 }],
  pr2: [
    { maxAge:35,       eeRate:0.15,  erRate:0.08   },
    { maxAge:50,       eeRate:0.15,  erRate:0.08   },
    { maxAge:55,       eeRate:0.12,  erRate:0.075  },
    { maxAge:60,       eeRate:0.075, erRate:0.075  },
    { maxAge:65,       eeRate:0.05,  erRate:0.065  },
    { maxAge:Infinity, eeRate:0.05,  erRate:0.065  },
  ],
};

const ALLOC_TABLE = [
  { maxAge:35,       oa:0.6217, sa:0.1621, ma:0.2162 },
  { maxAge:45,       oa:0.5677, sa:0.1891, ma:0.2432 },
  { maxAge:50,       oa:0.5136, sa:0.2162, ma:0.2702 },
  { maxAge:55,       oa:0.4055, sa:0.3108, ma:0.2837 },
  { maxAge:60,       oa:0.3108, sa:0.0811, ma:0.6081 },
  { maxAge:65,       oa:0.1216, sa:0.0405, ma:0.8379 },
  { maxAge:Infinity, oa:0.08,   sa:0.0,    ma:0.92   },
];

function getRateRow(type, age) {
  const key = type === "pr3" ? "citizen" : type;
  const tbl = CPF_RATES_TABLE[key] || CPF_RATES_TABLE.citizen;
  return tbl.find(r => age <= r.maxAge) || tbl[tbl.length - 1];
}
function getAlloc(age) {
  return ALLOC_TABLE.find(r => age <= r.maxAge) || ALLOC_TABLE[ALLOC_TABLE.length - 1];
}
function cpfFloor(n) { return Math.floor(n + 1e-9); }

function computeCPF({ residencyType, age, ordinaryWage, additionalWage = 0,
                       daysWorked = null, totalDaysInMonth = 30,
                       totalOWForYear = null, awCeilingUsed = 0 }) {
  const owWorked = daysWorked !== null
    ? Math.floor((ordinaryWage * daysWorked / totalDaysInMonth) * 100) / 100
    : ordinaryWage;
  const owCapped  = Math.min(owWorked, OW_CEILING);
  const annualOW  = totalOWForYear ?? owWorked;
  const awCeil    = Math.max(0, AW_CEILING_ANNUAL - annualOW);
  const awLiable  = Math.min(additionalWage, Math.max(0, awCeil - awCeilingUsed));
  const cpfBase   = owCapped + awLiable;
  const gross     = owWorked + additionalWage;
  const rr        = getRateRow(residencyType, age);
  let eeCPF, erCPF;
  if (gross < 500)      { eeCPF = 0; erCPF = cpfFloor(cpfBase * rr.erRate); }
  else if (gross < 750) { eeCPF = cpfFloor(rr.eeRate * (gross - 500)); erCPF = cpfFloor(cpfBase * rr.erRate); }
  else                  { eeCPF = cpfFloor(cpfBase * rr.eeRate); erCPF = cpfFloor(cpfBase * rr.erRate); }
  const sdl = Math.min(SDL_MAX, Math.max(SDL_MIN, Math.floor(gross * 0.0025 * 100) / 100));
  return {
    eeRate: rr.eeRate, erRate: rr.erRate,
    grossPay: gross, owCapped, awLiable,
    eeCPF, erCPF, cpfRemit: eeCPF + erCPF, sdl,
    netPay: gross - eeCPF,
    employerCost: gross + erCPF + sdl,
    owCeiled: ordinaryWage > OW_CEILING,
    graduated: gross < 750,
  };
}

function computePayrollRun(employees) {
  const results = employees.map(emp => ({
    ...emp,
    cpf: computeCPF({
      residencyType: emp.residencyType || "citizen",
      age: emp.age,
      ordinaryWage: emp.basicSalary + (emp.allowance || 0),
      additionalWage: emp.additionalWage || 0,
      daysWorked: emp.daysWorked || null,
    }),
  }));
  const z = { gross:0, net:0, ee:0, er:0, cpfRemit:0, sdl:0, employerCost:0 };
  const totals = results.reduce((a, r) => ({
    gross: a.gross + r.cpf.grossPay, net: a.net + r.cpf.netPay,
    ee: a.ee + r.cpf.eeCPF, er: a.er + r.cpf.erCPF,
    cpfRemit: a.cpfRemit + r.cpf.cpfRemit, sdl: a.sdl + r.cpf.sdl,
    employerCost: a.employerCost + r.cpf.employerCost,
  }), z);
  return { results, totals };
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const CLIENTS = [
  { id:1, name:"Vertex Solutions Pte Ltd",    uen:"202301234A", industry:"Technology", headcount:24, status:"active",  nextPayroll:"31 Mar 2026", ytdCpf:187420 },
  { id:2, name:"Harbour Logistics Pte Ltd",   uen:"201987654B", industry:"Logistics",  headcount:11, status:"active",  nextPayroll:"31 Mar 2026", ytdCpf:82310  },
  { id:3, name:"Meridian Consulting Pte Ltd", uen:"200544321C", industry:"Consulting", headcount:6,  status:"pending", nextPayroll:"30 Apr 2026", ytdCpf:41200  },
  { id:4, name:"SunBridge F&B Pte Ltd",       uen:"201123456D", industry:"F&B",        headcount:38, status:"active",  nextPayroll:"31 Mar 2026", ytdCpf:214900 },
];
const EMPLOYEES = [
  { id:1, nric:"S8801234A", name:"Tan Wei Ming",          residencyType:"citizen", age:38, designation:"Senior Engineer", basicSalary:7800,  allowance:500  },
  { id:2, nric:"S9204567B", name:"Priya Ramasamy",        residencyType:"citizen", age:33, designation:"Product Manager", basicSalary:9200,  allowance:800  },
  { id:3, nric:"S7703221C", name:"Lee Kian Huat",         residencyType:"citizen", age:48, designation:"Director",        basicSalary:14500, allowance:1500 },
  { id:4, nric:"G8912345D", name:"Zhang Wei",             residencyType:"pr2",     age:34, designation:"Designer",        basicSalary:5600,  allowance:300  },
  { id:5, nric:"S8556789E", name:"Nurul Huda bte Ismail", residencyType:"citizen", age:40, designation:"Finance Exec",    basicSalary:5200,  allowance:200  },
  { id:6, nric:"S9867432F", name:"Arjun Sharma",          residencyType:"citizen", age:27, designation:"Junior Dev",      basicSalary:3800,  allowance:0    },
];

// Claims mock data — shared mutable state via useState in App, passed as props
const CLAIM_CATEGORIES = [
  "Transport","Meals & Entertainment","Accommodation","Medical","Training & Development",
  "Client Gifts","Stationery & Supplies","Telecommunications","Other",
];
const INITIAL_CLAIMS = [
  { id:101, employeeId:1, employeeName:"Tan Wei Ming",          category:"Transport",             description:"Grab to client site (Raffles Place)", amount:28.50,  receiptRef:"RCP-001", submittedDate:"2026-03-04", status:"approved",  managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:102, employeeId:2, employeeName:"Priya Ramasamy",        category:"Meals & Entertainment", description:"Team lunch — product review",           amount:186.00, receiptRef:"RCP-002", submittedDate:"2026-03-06", status:"approved",  managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:103, employeeId:4, employeeName:"Zhang Wei",             category:"Training & Development",description:"Figma Advanced course",                 amount:320.00, receiptRef:"RCP-003", submittedDate:"2026-03-08", status:"pending",   managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:104, employeeId:5, employeeName:"Nurul Huda bte Ismail", category:"Medical",               description:"GP consultation & medication",          amount:45.00,  receiptRef:"RCP-004", submittedDate:"2026-03-10", status:"approved",  managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:105, employeeId:6, employeeName:"Arjun Sharma",          category:"Transport",             description:"MRT/bus monthly concession",            amount:90.00,  receiptRef:"RCP-005", submittedDate:"2026-03-11", status:"pending",   managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:106, employeeId:1, employeeName:"Tan Wei Ming",          category:"Telecommunications",    description:"Mobile data top-up (work SIM)",         amount:30.00,  receiptRef:"RCP-006", submittedDate:"2026-03-12", status:"rejected",  managerId:3, managerName:"Lee Kian Huat",  payrollRun:null, rejectReason:"Duplicate — already in allowance" },
  { id:107, employeeId:2, employeeName:"Priya Ramasamy",        category:"Stationery & Supplies", description:"Monitor stand & keyboard",              amount:142.00, receiptRef:"RCP-007", submittedDate:"2026-03-14", status:"pending",   managerId:3, managerName:"Lee Kian Huat",  payrollRun:null },
  { id:108, employeeId:3, employeeName:"Lee Kian Huat",         category:"Accommodation",         description:"Hotel — client offsite KL",             amount:580.00, receiptRef:"RCP-008", submittedDate:"2026-03-15", status:"approved",  managerId:null, managerName:"Self (Director)", payrollRun:null },
];

// ─── Leave statutory engine ───────────────────────────────────────────────────
// EA Part IV — Annual Leave entitlement by years of service (s.43)
function alEntitlement(yearsOfService) {
  if (yearsOfService < 1) return 7;   // prorated in first year, base = 7
  if (yearsOfService < 2) return 8;
  if (yearsOfService < 3) return 9;
  if (yearsOfService < 4) return 10;
  if (yearsOfService < 5) return 11;
  if (yearsOfService < 6) return 12;
  if (yearsOfService < 7) return 13;
  return 14;  // 8+ years
}
// EA s.89 — Outpatient sick leave by years of service
function mcOutpatientEntitlement(yearsOfService) {
  if (yearsOfService < 1) return 5;
  if (yearsOfService < 2) return 8;
  if (yearsOfService < 3) return 11;
  return 14;
}
// EA s.89 — Hospitalisation leave (includes outpatient quota)
function mcHospEntitlement(yearsOfService) {
  if (yearsOfService < 1) return 15;
  if (yearsOfService < 2) return 30;
  if (yearsOfService < 3) return 45;
  return 60;
}
// CDCA / EA — Government-paid maternity 16 wks, paternity 2 wks, childcare 6 days/yr
const GOVT_LEAVE = {
  maternity:  { days: 112, label: "Maternity Leave", color: "purple" },
  paternity:  { days: 14,  label: "Paternity Leave", color: "teal"   },
  childcare:  { days: 6,   label: "Childcare Leave", color: "blue"   },
};

// Employee service data (join dates → years of service as at Mar 2026)
const EMP_SERVICE = {
  1: { joinDate:"2020-01-15", yearsOfService:6.2 },
  2: { joinDate:"2022-07-01", yearsOfService:3.7 },
  3: { joinDate:"2015-03-01", yearsOfService:11.0},
  4: { joinDate:"2023-11-01", yearsOfService:1.3 },
  5: { joinDate:"2021-05-10", yearsOfService:4.9 },
  6: { joinDate:"2024-08-01", yearsOfService:0.6 },
};

function buildEntitlements() {
  return EMPLOYEES.map(e => {
    const svc = EMP_SERVICE[e.id];
    const yos = svc.yearsOfService;
    return {
      employeeId: e.id,
      name:       e.name,
      designation:e.designation,
      joinDate:   svc.joinDate,
      yearsOfService: yos,
      annual:     { total: alEntitlement(yos),                  used: 0, pending: 0 },
      medical:    { total: mcOutpatientEntitlement(yos),         used: 0, pending: 0 },
      hosp:       { total: mcHospEntitlement(yos),               used: 0, pending: 0 },
      childcare:  { total: GOVT_LEAVE.childcare.days,            used: 0, pending: 0 },
      maternity:  { total: GOVT_LEAVE.maternity.days,            used: 0, pending: 0 },
      paternity:  { total: GOVT_LEAVE.paternity.days,            used: 0, pending: 0 },
      npl:        { total: null /* unlimited */,                 used: 0, pending: 0 },
    };
  });
}

const LEAVE_TYPES = [
  { id:"annual",   label:"Annual Leave",            short:"AL",  color:"green",  paid:true,  affectsSalary:false },
  { id:"medical",  label:"Medical Leave (outpat.)", short:"MC",  color:"blue",   paid:true,  affectsSalary:false },
  { id:"hosp",     label:"Hospitalisation Leave",   short:"HL",  color:"purple", paid:true,  affectsSalary:false },
  { id:"childcare",label:"Childcare Leave",         short:"CCL", color:"teal",   paid:true,  affectsSalary:false },
  { id:"maternity",label:"Maternity Leave",         short:"ML",  color:"purple", paid:true,  affectsSalary:false },
  { id:"paternity",label:"Paternity Leave",         short:"PL",  color:"teal",   paid:true,  affectsSalary:false },
  { id:"npl",      label:"No-Pay Leave",            short:"NPL", color:"amber",  paid:false, affectsSalary:true  },
];

const INITIAL_LEAVE_RECORDS = [
  { id:201, employeeId:1, type:"annual",  days:2, startDate:"2026-03-02", endDate:"2026-03-03", reason:"Personal",              status:"approved", submittedBy:"employee" },
  { id:202, employeeId:2, type:"medical", days:1, startDate:"2026-03-05", endDate:"2026-03-05", reason:"GP visit",              status:"approved", submittedBy:"employee" },
  { id:203, employeeId:4, type:"annual",  days:3, startDate:"2026-03-16", endDate:"2026-03-18", reason:"Family holiday",        status:"pending",  submittedBy:"employee" },
  { id:204, employeeId:5, type:"npl",     days:2, startDate:"2026-03-09", endDate:"2026-03-10", reason:"Personal arrangement",  status:"approved", submittedBy:"admin"    },
  { id:205, employeeId:6, type:"medical", days:2, startDate:"2026-03-12", endDate:"2026-03-13", reason:"MC from doctor",        status:"approved", submittedBy:"employee" },
  { id:206, employeeId:3, type:"annual",  days:1, startDate:"2026-03-20", endDate:"2026-03-20", reason:"Appointment",          status:"pending",  submittedBy:"admin"    },
  { id:207, employeeId:1, type:"npl",     days:1, startDate:"2026-03-25", endDate:"2026-03-25", reason:"Childcare emergency",   status:"pending",  submittedBy:"employee" },
];

const fmt  = n => `S$${n.toLocaleString("en-SG",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK = n => `S$${(n/1000).toFixed(1)}k`;

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Badge({ color="gray", children }) {
  const C = {
    green:  {bg:T.greenDim,  text:T.green,  bd:"#2d5a35"},
    amber:  {bg:T.amberDim,  text:T.amber,  bd:"#5a3d10"},
    red:    {bg:T.redDim,    text:T.red,    bd:"#6b2220"},
    blue:   {bg:T.accentDim, text:T.accent, bd:"#1e4a7a"},
    purple: {bg:T.purpleDim, text:T.purple, bd:"#4a2e8a"},
    gray:   {bg:T.bg3,       text:T.text1,  bd:T.border },
  };
  const c = C[color]||C.gray;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",
      borderRadius:4,background:c.bg,color:c.text,border:`0.5px solid ${c.bd}`,
      fontSize:11,fontFamily:T.mono,fontWeight:500,whiteSpace:"nowrap"}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:c.text,flexShrink:0}}/>
      {children}
    </span>
  );
}
function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,
      padding:"16px 20px",borderTop:accent?`2px solid ${accent}`:undefined}}>
      <div style={{fontFamily:T.sans,fontSize:11,color:T.text1,textTransform:"uppercase",
        letterSpacing:"0.08em",marginBottom:8}}>{label}</div>
      <div style={{fontFamily:T.mono,fontSize:22,fontWeight:500,color:T.text0,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:T.sans,fontSize:12,color:T.text2,marginTop:6}}>{sub}</div>}
    </div>
  );
}
function SectionHeader({ title, action, onAction }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <h2 style={{fontFamily:T.display,fontSize:15,fontWeight:600,color:T.text0,margin:0,letterSpacing:"-0.01em"}}>{title}</h2>
      {action&&<button onClick={onAction} style={{fontFamily:T.mono,fontSize:12,color:T.accent,
        background:"transparent",border:`0.5px solid ${T.accentDim}`,borderRadius:5,
        padding:"4px 12px",cursor:"pointer"}}>{action}</button>}
    </div>
  );
}
const TH = ({children,right}) => (
  <th style={{padding:"9px 12px",textAlign:right?"right":"left",color:T.text2,
    fontFamily:T.mono,fontSize:10,fontWeight:500,letterSpacing:"0.06em",
    borderBottom:`0.5px solid ${T.border}`}}>{children}</th>
);
const TD = ({children,right,mono,color,bold,small}) => (
  <td style={{padding:"11px 12px",textAlign:right?"right":"left",
    fontFamily:mono?T.mono:T.sans,fontSize:small?11:13,
    color:color||T.text0,fontWeight:bold?500:400}}>{children}</td>
);
const GhostBtn = ({onClick,children,style={}}) => (
  <button onClick={onClick} style={{fontFamily:T.mono,fontSize:12,color:T.text1,
    background:"transparent",border:`0.5px solid ${T.border}`,borderRadius:5,
    padding:"7px 16px",cursor:"pointer",...style}}>{children}</button>
);
const PrimaryBtn = ({onClick,children,color,style={}}) => (
  <button onClick={onClick} style={{fontFamily:T.mono,fontSize:12,fontWeight:500,
    background:color||T.accent,color:T.bg0,border:"none",borderRadius:5,
    padding:"7px 18px",cursor:"pointer",...style}}>{children}</button>
);
function RowHover({children,style={}}) {
  const [hover,setHover]=useState(false);
  return (
    <tr style={{...style,background:hover?T.bg2:"transparent"}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      {children}
    </tr>
  );
}

// ─── Airwallex link builder ───────────────────────────────────────────────────
const awSalaryUrl = (ref, total) =>
  `https://www.airwallex.com/app/payments/batch-pay?ref=${ref}&currency=SGD&total=${total.toFixed(2)}`;
const awCpfUrl = (ref, amount, cpfRef) =>
  `https://www.airwallex.com/app/payments/pay?ref=${ref}&payee=CPF+Board&uen=T08GB0002B&currency=SGD&amount=${amount.toFixed(2)}&ref_note=${encodeURIComponent(cpfRef)}`;

// ─── PAGE: Dashboard ──────────────────────────────────────────────────────────
function Dashboard({ setView, setActiveClient, clients = [], clientsLoading, onAddClient }) {
  const pendingRuns = clients.filter(c => c.status==="active").length;
  return (
    <div>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:T.display,fontSize:26,fontWeight:700,color:T.text0,margin:"0 0 6px",letterSpacing:"-0.02em"}}>
          Good morning, operator.
        </h1>
        <p style={{fontFamily:T.sans,fontSize:14,color:T.text1,margin:0}}>
          {clients.length} active client{clients.length!==1?"s":""} · March 2026 payroll cycle
        </p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:32}}>
        <MetricCard label="Active clients"    value={clients.filter(c=>c.status==="active").length} sub={`${clients.length} total`} accent={T.accent}/>
        <MetricCard label="Total headcount"   value={clients.reduce((a,c)=>a+(c.headcount||0),0)} sub="across all clients" accent={T.green}/>
        <MetricCard label="YTD CPF submitted" value={fmtK(clients.reduce((a,c)=>a+(c.ytd_cpf||0),0))} sub="employer + employee" accent={T.amber}/>
        <MetricCard label="Runs pending"      value={pendingRuns} sub="this cycle" accent={T.red}/>
      </div>
      <SectionHeader title="Client portfolio" action="+ Onboard client" onAction={onAddClient}/>
      <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:T.bg2}}>
              <TH>Client</TH><TH>UEN</TH><TH>Industry</TH>
              <TH right>Headcount</TH><TH right>Next payroll</TH>
              <TH right>CPF (YTD)</TH><TH right>Status</TH><TH right></TH>
            </tr>
          </thead>
          <tbody>
            {clientsLoading && (
              <tr><td colSpan={8} style={{padding:"24px",textAlign:"center",
                fontFamily:T.mono,fontSize:11,color:T.text2}}>Loading clients…</td></tr>
            )}
            {clients.map((c,i) => (
              <RowHover key={c.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined,cursor:"pointer"}}>
                <td style={{padding:"12px 12px"}}>
                  <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{c.name}</div>
                </td>
                <TD mono small color={T.text1}>{c.uen}</TD>
                <TD color={T.text1}>{c.industry}</TD>
                <TD right mono>{c.headcount ?? "—"}</TD>
                <TD right mono small color={T.text1}>{c.next_payroll ?? "—"}</TD>
                <TD right mono bold>{c.ytd_cpf ? fmtK(c.ytd_cpf) : "—"}</TD>
                <td style={{padding:"11px 12px",textAlign:"right"}}>
                  <Badge color={c.status==="active"?"green":"amber"}>{c.status}</Badge>
                </td>
                <td style={{padding:"11px 12px",textAlign:"right"}}>
                  <button onClick={()=>{setActiveClient(c);setView("payroll");}}
                    style={{fontFamily:T.mono,fontSize:11,color:T.accent,background:"transparent",
                      border:`0.5px solid ${T.border}`,borderRadius:4,padding:"3px 10px",cursor:"pointer"}}>
                    Run payroll →
                  </button>
                </td>
              </RowHover>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PAGE: Payroll Run ────────────────────────────────────────────────────────
function PayrollRun({ client }) {
  const [step,setStep]           = useState(0);
  const [showAddEmp, setShowAddEmp] = useState(false);

  // Fetch real employees from API
  const { data: empData, loading: empLoading, refetch: refetchEmployees } = useFetch(
    () => client?.id ? apiGet(`/clients/${client.id}/employees`) : null,
    [client?.id]
  );
  // Fetch payroll periods
  const { data: periodsData, loading: periodsLoading, refetch: refetchPeriods } = useFetch(
    () => client?.id ? apiGet(`/clients/${client.id}/payroll`) : null,
    [client?.id]
  );

  const apiEmployees = empData ?? [];
  const periods = periodsData ?? [];

  // Fall back to mock employees if API not available / empty (dev mode)
  const employees = apiEmployees.length > 0 ? apiEmployees : EMPLOYEES;

  const [selected,setSelected] = useState(new Set());
  useEffect(() => {
    setSelected(new Set(employees.map(e=>e.id)));
  }, [employees.length]);

  const {results:allRows} = computePayrollRun(employees.map(e => ({
    ...e,
    // Normalise API field names (snake_case) to camelCase for CPF engine
    basicSalary:  e.basic_salary  ?? e.basicSalary  ?? 0,
    allowance:    e.fixed_allowance ?? e.allowance  ?? 0,
    residencyType: e.residency_type ?? e.residencyType ?? 'citizen',
    age: e.age ?? (e.date_of_birth
      ? Math.floor((Date.now() - new Date(e.date_of_birth)) / (365.25*24*3600*1000))
      : 35),
  })));

  const rows    = allRows.filter(r=>selected.has(r.id));
  const totals  = rows.reduce((a,r)=>({
    gross:a.gross+r.cpf.grossPay, net:a.net+r.cpf.netPay,
    ee:a.ee+r.cpf.eeCPF, er:a.er+r.cpf.erCPF,
    cpfRemit:a.cpfRemit+r.cpf.cpfRemit, sdl:a.sdl+r.cpf.sdl,
  },{gross:0,net:0,ee:0,er:0,cpfRemit:0,sdl:0}));
  const STEPS   = ["1. Review employees","2. Compute & verify","3. Generate files"];

  return (
    <div>
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:T.mono,fontSize:11,color:T.text2,marginBottom:4}}>PAYROLL RUN — MARCH 2026</div>
        <h1 style={{fontFamily:T.display,fontSize:22,fontWeight:700,color:T.text0,margin:"0 0 4px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{fontFamily:T.mono,fontSize:12,color:T.text1}}>UEN {client.uen} · {client.headcount} employees</div>
      </div>
      <div style={{display:"flex",marginBottom:28,background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        {STEPS.map((s,i)=>(
          <button key={i} onClick={()=>setStep(i)} style={{flex:1,padding:"10px 0",fontFamily:T.mono,fontSize:11,
            background:step===i?T.bg3:"transparent",color:step===i?T.text0:T.text2,
            border:"none",borderRight:i<2?`0.5px solid ${T.border}`:"none",cursor:"pointer",letterSpacing:"0.04em",
            borderBottom:step===i?`2px solid ${T.accent}`:"2px solid transparent"}}>{s}</button>
        ))}
      </div>

      {step===0&&(
        <div>
          {showAddEmp && (
            <AddEmployeeModal
              client={client}
              onClose={() => setShowAddEmp(false)}
              onCreated={() => { setShowAddEmp(false); refetchEmployees(); }}
            />
          )}
          <SectionHeader title="Employee selection"
            action="+ Add employee" onAction={() => setShowAddEmp(true)}/>
          <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:20}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:T.bg2}}>
                <TH/><TH>NRIC</TH><TH>Name</TH><TH>Type</TH><TH>Designation</TH>
                <TH right>Basic</TH><TH right>Allowance</TH><TH right>Gross</TH>
              </tr></thead>
              <tbody>
                {allRows.map((r,i)=>(
                  <tr key={r.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined,opacity:selected.has(r.id)?1:0.4}}>
                    <td style={{padding:"11px 12px"}}>
                      <input type="checkbox" checked={selected.has(r.id)} style={{accentColor:T.accent,cursor:"pointer"}}
                        onChange={()=>{const s=new Set(selected);s.has(r.id)?s.delete(r.id):s.add(r.id);setSelected(s);}}/>
                    </td>
                    <TD mono small color={T.text1}>{r.nric}</TD>
                    <td style={{padding:"11px 12px"}}><div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{r.name}</div></td>
                    <td style={{padding:"11px 12px"}}>
                      <Badge color={r.residencyType==="citizen"?"blue":r.residencyType==="pr2"?"purple":"gray"}>
                        {r.residencyType==="citizen"?"SC":r.residencyType.toUpperCase()}
                      </Badge>
                    </td>
                    <TD color={T.text1}>{r.designation}</TD>
                    <TD right mono>{fmt(r.basicSalary)}</TD>
                    <TD right mono color={T.text1}>{r.allowance>0?fmt(r.allowance):"—"}</TD>
                    <TD right mono bold>{fmt(r.cpf.grossPay)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:T.sans,fontSize:13,color:T.text1}}>{selected.size} of {allRows.length} selected</span>
            <PrimaryBtn onClick={()=>setStep(1)}>Compute payroll →</PrimaryBtn>
          </div>
        </div>
      )}

      {step===1&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:24}}>
            <MetricCard label="Total gross"  value={fmtK(totals.gross)}  accent={T.accent}/>
            <MetricCard label="Employee CPF" value={fmtK(totals.ee)}     accent={T.purple}/>
            <MetricCard label="Employer CPF" value={fmtK(totals.er)}     accent={T.teal}/>
            <MetricCard label="SDL"          value={fmt(totals.sdl)}     accent={T.amber}/>
            <MetricCard label="Net payable"  value={fmtK(totals.net)}    accent={T.green}/>
          </div>
          <SectionHeader title="CPF computation breakdown"/>
          <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:16}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:T.bg2}}>
                <TH>Name</TH><TH>Type</TH><TH right>Gross</TH>
                <TH right>OW (capped)</TH><TH right>EE CPF</TH>
                <TH right>ER CPF</TH><TH right>CPF total</TH><TH right>SDL</TH><TH right>Net salary</TH>
              </tr></thead>
              <tbody>
                {rows.map((r,i)=>(
                  <tr key={r.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined}}>
                    <td style={{padding:"10px 12px"}}>
                      <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{r.name}</div>
                      <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>EE {(r.cpf.eeRate*100).toFixed(1)}% / ER {(r.cpf.erRate*100).toFixed(1)}% · age {r.age}</div>
                    </td>
                    <td style={{padding:"10px 12px"}}>
                      <Badge color={r.residencyType==="citizen"?"blue":"purple"}>{r.residencyType==="citizen"?"SC":r.residencyType.toUpperCase()}</Badge>
                    </td>
                    <TD right mono>{fmt(r.cpf.grossPay)}</TD>
                    <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:11,color:r.cpf.owCeiled?T.amber:T.text1}}>
                      {fmt(r.cpf.owCapped)}{r.cpf.owCeiled?" ⚑":""}
                    </td>
                    <TD right mono bold color={T.purple}>{fmt(r.cpf.eeCPF)}</TD>
                    <TD right mono bold color={T.teal}>{fmt(r.cpf.erCPF)}</TD>
                    <TD right mono bold>{fmt(r.cpf.cpfRemit)}</TD>
                    <TD right mono small color={T.text2}>{fmt(r.cpf.sdl)}</TD>
                    <TD right mono bold color={T.green}>{fmt(r.cpf.netPay)}</TD>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{borderTop:`1px solid ${T.border}`,background:T.bg2}}>
                  <td colSpan={2} style={{padding:"10px 12px",fontFamily:T.mono,fontSize:10,color:T.text1,letterSpacing:"0.06em"}}>TOTALS</td>
                  <TD right mono bold>{fmt(totals.gross)}</TD><td/>
                  <TD right mono bold color={T.purple}>{fmt(totals.ee)}</TD>
                  <TD right mono bold color={T.teal}>{fmt(totals.er)}</TD>
                  <TD right mono bold>{fmt(totals.cpfRemit)}</TD>
                  <TD right mono small color={T.text2}>{fmt(totals.sdl)}</TD>
                  <TD right mono bold color={T.green}>{fmt(totals.net)}</TD>
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.some(r=>r.cpf.owCeiled)&&(
            <div style={{background:T.amberDim,border:`0.5px solid ${T.amber}`,borderRadius:6,
              padding:"10px 14px",marginBottom:16,fontFamily:T.sans,fontSize:12,color:T.amber}}>
              ⚑ Salary above OW ceiling S$8,000 — CPF computed on capped OW only.
            </div>
          )}
          <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
            <GhostBtn onClick={()=>setStep(0)}>← Back</GhostBtn>
            <PrimaryBtn onClick={()=>setStep(2)} color={T.green}>Generate files →</PrimaryBtn>
          </div>
        </div>
      )}

      {step===2&&(
        <div>
          <div style={{background:T.greenDim,border:`0.5px solid ${T.green}`,borderRadius:8,
            padding:"16px 20px",marginBottom:24,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontFamily:T.mono,fontSize:20,color:T.green}}>✓</span>
            <div>
              <div style={{fontFamily:T.sans,fontSize:14,color:T.green,fontWeight:500}}>Payroll computed successfully</div>
              <div style={{fontFamily:T.sans,fontSize:12,color:T.text1,marginTop:3}}>
                {selected.size} employees · March 2026 · Net payable: {fmt(totals.net)}
              </div>
            </div>
          </div>
          <SectionHeader title="Generated output files"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
            {[
              {label:"GIRO payment instruction",desc:"Upload to internet banking",ext:"TXT",color:T.accent,file:`GIRO_${client.uen}_MAR2026.txt`},
              {label:"CPF e-Submission file",   desc:"Upload to CPF Board portal", ext:"TXT",color:T.green, file:`CPF_${client.uen}_202603.txt`},
              {label:"Payslips — all employees",desc:`${selected.size} PDF payslips`,ext:"PDF",color:T.amber,file:`Payslips_MAR2026.pdf`},
              {label:"SDL payment instruction", desc:"Skills Development Levy",    ext:"TXT",color:T.purple,file:`SDL_${client.uen}_MAR2026.txt`},
            ].map((f,i)=>(
              <div key={i} style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,
                padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500,marginBottom:4}}>{f.label}</div>
                  <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginBottom:4}}>{f.file}</div>
                  <div style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>{f.desc}</div>
                </div>
                <button style={{fontFamily:T.mono,fontSize:11,color:f.color,background:"transparent",
                  border:`0.5px solid ${f.color}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",flexShrink:0,marginLeft:12}}>
                  ↓ {f.ext}
                </button>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <GhostBtn onClick={()=>setStep(1)}>← Back</GhostBtn>
            <PrimaryBtn>Mark as submitted ✓</PrimaryBtn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Payment Instructions ───────────────────────────────────────────────
function PaymentInstructions({ client }) {
  const [tab,setTab]           = useState("salary");
  const [salConf,setSalConf]   = useState(false);
  const [cpfConf,setCpfConf]   = useState(false);
  const {results:rows,totals}  = computePayrollRun(EMPLOYEES);
  const cpfTotal               = totals.ee + totals.er + totals.sdl;
  const period="March 2026", payDate="31 March 2026", cpfDue="14 April 2026";
  const refSal=`PI-SAL-202603-${client.uen}`, refCpf=`PI-CPF-202603-${client.uen}`;
  const cpfRefNo=`CPF/${client.uen}/202603`;

  const Box=({label,value,sub,accent})=>(
    <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,
      padding:"14px 18px",borderTop:`2px solid ${accent}`}}>
      <div style={{fontFamily:T.sans,fontSize:10,color:T.text2,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:7}}>{label}</div>
      <div style={{fontFamily:T.mono,fontSize:20,fontWeight:500,color:T.text0,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:T.sans,fontSize:11,color:T.text2,marginTop:5}}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:T.mono,fontSize:11,color:T.text2,marginBottom:4}}>PAYMENT INSTRUCTIONS — {period.toUpperCase()}</div>
        <h1 style={{fontFamily:T.display,fontSize:22,fontWeight:700,color:T.text0,margin:"0 0 4px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{fontFamily:T.mono,fontSize:12,color:T.text1}}>UEN {client.uen} · {EMPLOYEES.length} employees</div>
      </div>

      {/* Status banner */}
      <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,
        padding:"13px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:T.amber,boxShadow:`0 0 0 3px ${T.amberDim}`,flexShrink:0}}/>
        <div>
          <span style={{fontFamily:T.sans,fontSize:13,fontWeight:500}}>2 payment instructions pending</span>
          <span style={{fontFamily:T.sans,fontSize:12,color:T.text2,marginLeft:16}}>
            Salary due {payDate} · CPF due {cpfDue}
          </span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <GhostBtn style={{fontSize:11,padding:"5px 12px"}}>↗ Send to client</GhostBtn>
          <GhostBtn style={{fontSize:11,padding:"5px 12px"}}>↓ Download PDFs</GhostBtn>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`0.5px solid ${T.border}`,marginBottom:24}}>
        {[{id:"salary",label:"Salary Payment",amount:fmt(totals.net)},
          {id:"cpf",label:"CPF & SDL",amount:fmt(cpfTotal)}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 20px",
            fontFamily:T.mono,fontSize:12,background:"transparent",border:"none",cursor:"pointer",
            color:tab===t.id?T.text0:T.text2,
            borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent",marginBottom:-1}}>
            {t.label} &nbsp;<span style={{fontSize:11,opacity:0.6}}>{t.amount}</span>
          </button>
        ))}
      </div>

      {/* ── Salary tab ── */}
      {tab==="salary"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
            <Box label="Gross payroll"   value={fmt(totals.gross)} sub={`${rows.length} employees`} accent={T.accent}/>
            <Box label="EE CPF deducted" value={fmt(totals.ee)}    sub="Withheld from employees"    accent={T.purple}/>
            <Box label="Net salaries"    value={fmt(totals.net)}   sub="Amount to transfer"         accent={T.green}/>
            <Box label="Pay date"        value={payDate}           sub={`Ref: ${refSal}`}           accent={T.amber}/>
          </div>

          {/* Airwallex CTA */}
          <div style={{background:T.greenDim,border:`1px solid rgba(63,185,80,0.25)`,borderRadius:10,
            padding:"18px 22px",marginBottom:16,display:"flex",alignItems:"center",gap:20}}>
            <div style={{fontSize:26,flexShrink:0}}>💳</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,marginBottom:3}}>Pay salaries via Airwallex</div>
              <div style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>
                Batch payment of <strong style={{color:T.green}}>{fmt(totals.net)}</strong> to {rows.length} employees.
                Opens in your Airwallex account with amount pre-filled.
              </div>
            </div>
            <div style={{fontFamily:T.mono,fontSize:22,fontWeight:500,color:T.green,whiteSpace:"nowrap",marginRight:8}}>{fmt(totals.net)}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
              <a href={awSalaryUrl(refSal,totals.net)} target="_blank" rel="noreferrer" onClick={()=>setSalConf(true)}
                style={{fontFamily:T.mono,fontSize:12,fontWeight:500,background:T.green,color:T.bg0,border:"none",
                  borderRadius:5,padding:"8px 16px",cursor:"pointer",textDecoration:"none",display:"inline-block",textAlign:"center"}}>
                ↗ Open in Airwallex
              </a>
              <GhostBtn style={{fontSize:11,padding:"5px 12px",textAlign:"center"}}>↓ Download CSV</GhostBtn>
            </div>
          </div>

          {salConf&&(
            <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12,
              background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"12px 16px"}}>
              <span style={{background:T.greenDim,border:`1px solid rgba(63,185,80,0.3)`,color:T.green,
                fontFamily:T.mono,fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20}}>
                ✓ Airwallex opened
              </span>
              <span style={{fontFamily:T.sans,fontSize:12,color:T.text2}}>Mark as paid once Airwallex confirms the transfer.</span>
              <PrimaryBtn color={T.green} style={{marginLeft:"auto",fontSize:11,padding:"5px 14px"}}>
                Mark salary as paid ✓
              </PrimaryBtn>
            </div>
          )}

          <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:6,
            padding:"9px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:16,
            fontFamily:T.mono,fontSize:11,color:T.text1}}>
            <span style={{color:T.text2,fontSize:10}}>REF</span> {refSal}
            <span style={{color:T.text2,fontSize:10}}>CLIENT</span> {client.name}
            <span style={{color:T.text2,fontSize:10}}>PERIOD</span> {period}
          </div>

          <SectionHeader title="Salary payment list"/>
          <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:T.bg2}}>
                <TH>#</TH><TH>Employee</TH><TH>Type</TH>
                <TH right>Basic</TH><TH right>Allowance</TH><TH right>Gross</TH>
                <TH right>EE CPF</TH><TH right>Net pay</TH>
              </tr></thead>
              <tbody>
                {rows.map((r,i)=>(
                  <RowHover key={r.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined}}>
                    <TD mono small color={T.text2}>{i+1}</TD>
                    <td style={{padding:"10px 12px"}}>
                      <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{r.name}</div>
                      <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>{r.nric}</div>
                    </td>
                    <td style={{padding:"10px 12px"}}>
                      <Badge color={r.residencyType==="citizen"?"blue":"purple"}>
                        {r.residencyType==="citizen"?"SC":r.residencyType.toUpperCase()}
                      </Badge>
                    </td>
                    <TD right mono>{fmt(r.basicSalary)}</TD>
                    <TD right mono color={T.text1}>{r.allowance>0?fmt(r.allowance):"—"}</TD>
                    <TD right mono>{fmt(r.cpf.grossPay)}</TD>
                    <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:12,color:T.purple}}>({fmt(r.cpf.eeCPF)})</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:13,color:T.green,fontWeight:500}}>{fmt(r.cpf.netPay)}</td>
                  </RowHover>
                ))}
              </tbody>
              <tfoot>
                <tr style={{borderTop:`1px solid ${T.border}`,background:T.bg2}}>
                  <td colSpan={3} style={{padding:"10px 12px",fontFamily:T.mono,fontSize:10,color:T.text1,letterSpacing:"0.06em"}}>TOTALS</td>
                  <TD right mono bold>{fmt(rows.reduce((s,r)=>s+r.basicSalary,0))}</TD>
                  <TD right mono bold>{fmt(rows.reduce((s,r)=>s+r.allowance,0))}</TD>
                  <TD right mono bold>{fmt(totals.gross)}</TD>
                  <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:13,color:T.purple,fontWeight:500}}>({fmt(totals.ee)})</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:14,color:T.green,fontWeight:500}}>{fmt(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── CPF tab ── */}
      {tab==="cpf"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
            <Box label="Employee CPF"   value={fmt(totals.ee)}  sub="Deducted from salaries"    accent={T.purple}/>
            <Box label="Employer CPF"   value={fmt(totals.er)}  sub="Additional company cost"   accent={T.teal}/>
            <Box label="SDL"            value={fmt(totals.sdl)} sub="Skills Dev. Levy"           accent={T.amber}/>
            <Box label="Total to remit" value={fmt(cpfTotal)}   sub={`Due ${cpfDue}`}           accent={T.green}/>
          </div>

          {/* Airwallex CTA */}
          <div style={{background:T.amberDim,border:`1px solid rgba(210,153,34,0.3)`,borderRadius:10,
            padding:"18px 22px",marginBottom:16,display:"flex",alignItems:"center",gap:20}}>
            <div style={{fontSize:26,flexShrink:0}}>🏦</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,marginBottom:3}}>Pay CPF Board via Airwallex</div>
              <div style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>
                Single payment of <strong style={{color:T.amber}}>{fmt(cpfTotal)}</strong> to CPF Board
                (PayNow UEN T08GB0002B). Ref <strong>{cpfRefNo}</strong> pre-filled. Due by <strong>{cpfDue}</strong>.
              </div>
            </div>
            <div style={{fontFamily:T.mono,fontSize:22,fontWeight:500,color:T.amber,whiteSpace:"nowrap",marginRight:8}}>{fmt(cpfTotal)}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
              <a href={awCpfUrl(refCpf,cpfTotal,cpfRefNo)} target="_blank" rel="noreferrer" onClick={()=>setCpfConf(true)}
                style={{fontFamily:T.mono,fontSize:12,fontWeight:500,background:T.amber,color:T.bg0,border:"none",
                  borderRadius:5,padding:"8px 16px",cursor:"pointer",textDecoration:"none",display:"inline-block",textAlign:"center"}}>
                ↗ Open in Airwallex
              </a>
              <GhostBtn style={{fontSize:11,padding:"5px 12px",textAlign:"center"}}>↓ PDF Instruction</GhostBtn>
            </div>
          </div>

          {cpfConf&&(
            <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12,
              background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,padding:"12px 16px"}}>
              <span style={{background:T.amberDim,border:`1px solid rgba(210,153,34,0.3)`,color:T.amber,
                fontFamily:T.mono,fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20}}>
                ✓ Airwallex opened
              </span>
              <span style={{fontFamily:T.sans,fontSize:12,color:T.text2}}>Mark CPF as paid once Airwallex confirms.</span>
              <PrimaryBtn color={T.amber} style={{marginLeft:"auto",fontSize:11,padding:"5px 14px"}}>Mark CPF as paid ✓</PrimaryBtn>
            </div>
          )}

          <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:8,
            padding:"16px 18px",marginBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[["Payee","CPF Board"],["PayNow UEN","T08GB0002B"],["Payment reference",cpfRefNo],
              ["Contribution month",period],["Due date",cpfDue+" (late = interest)"],["Employees",EMPLOYEES.length]
            ].map(([k,v])=>(
              <div key={k} style={{borderBottom:`0.5px solid ${T.border}`,paddingBottom:10}}>
                <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.07em"}}>{k}</div>
                <div style={{fontFamily:["Payment reference","PayNow UEN"].includes(k)?T.mono:T.sans,fontSize:13,fontWeight:500}}>{v}</div>
              </div>
            ))}
          </div>

          <SectionHeader title="CPF contribution breakdown"/>
          <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:T.bg2}}>
                <TH>#</TH><TH>Employee</TH><TH>Type / Rates</TH>
                <TH right>OW (capped)</TH><TH right>EE CPF</TH>
                <TH right>ER CPF</TH><TH right>SDL</TH><TH right>Total remit</TH>
              </tr></thead>
              <tbody>
                {rows.map((r,i)=>{
                  const alloc=getAlloc(r.age);
                  return (
                    <RowHover key={r.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined}}>
                      <TD mono small color={T.text2}>{i+1}</TD>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{r.name}</div>
                        <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>
                          OA {(alloc.oa*100).toFixed(0)}% · SA {(alloc.sa*100).toFixed(0)}% · MA {(alloc.ma*100).toFixed(0)}%
                        </div>
                      </td>
                      <td style={{padding:"10px 12px"}}>
                        <Badge color={r.residencyType==="citizen"?"blue":"purple"}>
                          {r.residencyType==="citizen"?"SC":r.residencyType.toUpperCase()}
                        </Badge>
                        <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginTop:3}}>
                          EE {(r.cpf.eeRate*100).toFixed(1)}% / ER {(r.cpf.erRate*100).toFixed(1)}%
                        </div>
                      </td>
                      <TD right mono color={r.cpf.owCeiled?T.amber:T.text1}>{fmt(r.cpf.owCapped)}</TD>
                      <TD right mono bold color={T.purple}>{fmt(r.cpf.eeCPF)}</TD>
                      <TD right mono bold color={T.teal}>{fmt(r.cpf.erCPF)}</TD>
                      <TD right mono small color={T.text2}>{fmt(r.cpf.sdl)}</TD>
                      <TD right mono bold color={T.green}>{fmt(r.cpf.eeCPF+r.cpf.erCPF+r.cpf.sdl)}</TD>
                    </RowHover>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:`1px solid ${T.border}`,background:T.bg2}}>
                  <td colSpan={3} style={{padding:"10px 12px",fontFamily:T.mono,fontSize:10,color:T.text1,letterSpacing:"0.06em"}}>TOTALS</td>
                  <td/>
                  <TD right mono bold color={T.purple}>{fmt(totals.ee)}</TD>
                  <TD right mono bold color={T.teal}>{fmt(totals.er)}</TD>
                  <TD right mono small color={T.text2}>{fmt(totals.sdl)}</TD>
                  <TD right mono bold color={T.green}>{fmt(cpfTotal)}</TD>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{marginTop:10,fontFamily:T.mono,fontSize:10,color:T.text2,display:"flex",gap:20}}>
            <span>SDL = 0.25% of gross, min S$2.00, max S$11.25</span>
            <span>CPF due 14th of following month</span>
            <span>OW ceiling S$8,000/month (Jan 2026)</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Reports & IR8A ─────────────────────────────────────────────────────
function ReportsPage({ client }) {
  const [tab,      setTab]      = useState("ir8a");
  const [ir8aYear, setIr8aYear] = useState(2026);
  const [selEmp,   setSelEmp]   = useState(null);

  // Fetch payroll lines from API (fall back to computed mock data)
  const { data: linesData } = useFetch(
    () => client?.id ? apiGet(`/clients/${client.id}/payroll`).catch(() => null) : null,
    [client?.id]
  );
  const { data: empData } = useFetch(
    () => client?.id ? apiGet(`/clients/${client.id}/employees`).catch(() => null) : null,
    [client?.id]
  );

  // Build mock payroll data for display when API unavailable
  const employees = (empData ?? EMPLOYEES).map(e => ({
    ...e,
    name:          e.full_name      ?? e.name,
    residencyType: e.residency_type ?? e.residencyType ?? "citizen",
    basicSalary:   e.basic_salary   ?? e.basicSalary   ?? 0,
    allowance:     e.fixed_allowance ?? e.allowance    ?? 0,
    age:           e.age ?? (e.date_of_birth
      ? Math.floor((Date.now() - new Date(e.date_of_birth)) / (365.25*24*3600*1000))
      : 35),
  }));

  // Build YTD figures per employee (12 months × their CPF-computed values)
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const ytdData = employees.map(emp => {
    const { cpf } = computePayrollRun([emp]).results[0];
    const months = 3; // Q1 2026 completed for demo
    return {
      ...emp,
      ytdGross:  cpf.grossPay   * months,
      ytdEE:     cpf.eeCPF      * months,
      ytdER:     cpf.erCPF      * months,
      ytdSDL:    cpf.sdl        * months,
      ytdNet:    cpf.netPay     * months,
      ytdCPF:    cpf.cpfRemit   * months,
      monthly:   cpf,
      eeRate:    cpf.eeRate,
      erRate:    cpf.erRate,
    };
  });

  const totals = ytdData.reduce((a, r) => ({
    gross: a.gross + r.ytdGross,
    ee:    a.ee    + r.ytdEE,
    er:    a.er    + r.ytdER,
    sdl:   a.sdl   + r.ytdSDL,
    net:   a.net   + r.ytdNet,
    cpf:   a.cpf   + r.ytdCPF,
  }), { gross:0, ee:0, er:0, sdl:0, net:0, cpf:0 });

  // ── IR8A computation per employee ──────────────────────────────────────────
  // IRAS Form IR8A fields (YA 2027 for income year 2026)
  function buildIR8A(emp) {
    const d = ytdData.find(r => r.id === emp.id) ?? ytdData[0];
    if (!d) return null;
    const gross       = d.ytdGross;
    const basic       = (d.basicSalary + (d.allowance ?? 0)) * 3;  // Q1 only
    const transport   = 0;   // no transport allowance in mock
    const entertainment = 0;
    const others      = 0;
    const totalEmp    = basic + transport + entertainment + others;
    const eeCPF       = d.ytdEE;
    const erCPF       = d.ytdER;
    const chargeableIncome = gross - eeCPF;   // simplified; no other deductions
    return {
      // Employee details
      name:          d.name,
      nric:          d.nric_masked ?? d.nric ?? "S****000A",
      designation:   d.designation ?? "—",
      period:        `1 Jan ${ir8aYear} – 31 Mar ${ir8aYear}`,  // Q1 demo
      // Box A — Gross salary, fees, commissions, bonuses, allowances
      grossSalary:   basic,
      grossTotal:    gross,
      // Box B — CPF contributions
      eeCPF,
      erCPF,
      totalCPF:      eeCPF + erCPF,
      // Box C — Benefits-in-kind (none in this demo)
      benefitsInKind: 0,
      // Box D — Exempt income (NS claims, etc.)
      exemptIncome:  0,
      // Box E — Chargeable income estimate
      chargeableIncome,
      // Residency & rates
      residencyType: d.residencyType,
      eeRate:        d.eeRate,
      erRate:        d.erRate,
      sdl:           d.ytdSDL,
    };
  }

  // ── CSV download helper ──────────────────────────────────────────────────
  function downloadCSV(rows, headers, filename) {
    const csv = [
      headers.join(","),
      ...rows.map(r => headers.map(h => {
        const v = r[h] ?? "";
        return typeof v === "string" && v.includes(",") ? `"${v}"` : v;
      }).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const downloadIR8AcsV = () => {
    const rows = ytdData.map(emp => {
      const ir8a = buildIR8A(emp);
      return {
        "Name":               ir8a.name,
        "NRIC":               ir8a.nric,
        "Designation":        ir8a.designation,
        "Gross Salary (S$)":  (ir8a.grossSalary/100).toFixed(2),
        "Gross Total (S$)":   (ir8a.grossTotal/100).toFixed(2),
        "EE CPF (S$)":        (ir8a.eeCPF/100).toFixed(2),
        "ER CPF (S$)":        (ir8a.erCPF/100).toFixed(2),
        "Total CPF (S$)":     (ir8a.totalCPF/100).toFixed(2),
        "Chargeable Income":  (ir8a.chargeableIncome/100).toFixed(2),
      };
    });
    downloadCSV(rows,
      ["Name","NRIC","Designation","Gross Salary (S$)","Gross Total (S$)","EE CPF (S$)","ER CPF (S$)","Total CPF (S$)","Chargeable Income"],
      `IR8A_${client?.uen ?? "client"}_YA${ir8aYear+1}.csv`
    );
  };

  const downloadPayrollCSV = () => {
    const rows = ytdData.map(d => ({
      "Name":         d.name,
      "NRIC":         d.nric_masked ?? d.nric ?? "—",
      "Type":         d.residencyType,
      "Basic (S$)":   (d.basicSalary/100).toFixed(2),
      "Allowance (S$)":(d.allowance/100).toFixed(2),
      "Gross YTD (S$)":(d.ytdGross/100).toFixed(2),
      "EE CPF YTD (S$)":(d.ytdEE/100).toFixed(2),
      "ER CPF YTD (S$)":(d.ytdER/100).toFixed(2),
      "SDL YTD (S$)": (d.ytdSDL/100).toFixed(2),
      "Net YTD (S$)": (d.ytdNet/100).toFixed(2),
    }));
    downloadCSV(rows,
      ["Name","NRIC","Type","Basic (S$)","Allowance (S$)","Gross YTD (S$)","EE CPF YTD (S$)","ER CPF YTD (S$)","SDL YTD (S$)","Net YTD (S$)"],
      `PayrollYTD_${client?.uen ?? "client"}_${ir8aYear}.csv`
    );
  };

  // ── Sub-components ──────────────────────────────────────────────────────
  const IR8ACard = ({ emp }) => {
    const ir8a = buildIR8A(emp);
    if (!ir8a) return null;
    const isOpen = selEmp === emp.id;

    const Field2 = ({ label, value, note, highlight }) => (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"9px 0", borderBottom:`0.5px solid ${T.border}` }}>
        <div>
          <div style={{ fontFamily:T.sans, fontSize:12, color:T.text1 }}>{label}</div>
          {note && <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2 }}>{note}</div>}
        </div>
        <div style={{ fontFamily:T.mono, fontSize:13,
          color: highlight === "green" ? T.green
               : highlight === "red"   ? T.red
               : highlight === "amber" ? T.amber
               : T.text0,
          fontWeight: highlight ? 500 : 400 }}>
          {value}
        </div>
      </div>
    );

    return (
      <div style={{ background:T.bg1, border:`0.5px solid ${T.border}`, borderRadius:10,
        overflow:"hidden", marginBottom:10 }}>
        {/* Header row — click to expand */}
        <div onClick={() => setSelEmp(isOpen ? null : emp.id)}
          style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px",
            cursor:"pointer", transition:"background .12s" }}
          onMouseEnter={e => e.currentTarget.style.background=T.bg2}
          onMouseLeave={e => e.currentTarget.style.background="transparent"}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:500, color:T.text0 }}>
              {ir8a.name}
            </div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:2 }}>
              {ir8a.nric} · {ir8a.designation} · {emp.residencyType?.toUpperCase()}
            </div>
          </div>
          {/* Quick summary */}
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            {[
              { label:"Gross income", value:fmt(ir8a.grossTotal), color:T.text0 },
              { label:"EE CPF",       value:fmt(ir8a.eeCPF),      color:T.purple },
              { label:"ER CPF",       value:fmt(ir8a.erCPF),      color:T.teal   },
              { label:"Chargeable",   value:fmt(ir8a.chargeableIncome), color:T.amber },
            ].map(f => (
              <div key={f.label} style={{ textAlign:"right" }}>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2 }}>{f.label}</div>
                <div style={{ fontFamily:T.mono, fontSize:13, fontWeight:500, color:f.color }}>
                  {f.value}
                </div>
              </div>
            ))}
            <span style={{ color:T.text2, fontSize:14, marginLeft:4 }}>{isOpen?"▲":"▼"}</span>
          </div>
        </div>

        {/* Expanded IR8A detail */}
        {isOpen && (
          <div style={{ padding:"0 18px 18px", borderTop:`0.5px solid ${T.border}` }}>
            {/* IRAS Form Header */}
            <div style={{ background:T.bg2, borderRadius:8, padding:"14px 16px", margin:"16px 0 14px",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.text0 }}>
                  Form IR8A — Return of Employee's Remuneration
                </div>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:3 }}>
                  Year of Assessment {ir8aYear + 1} · Income year {ir8aYear} · {ir8a.period}
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2 }}>Employer UEN</div>
                  <div style={{ fontFamily:T.mono, fontSize:12, color:T.text0 }}>{client?.uen ?? "—"}</div>
                </div>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {/* Box A — Employment income */}
              <div>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, letterSpacing:"0.08em",
                  textTransform:"uppercase", marginBottom:8 }}>A — Employment Income</div>
                <Field2 label="Salary, wages, leave pay" value={fmt(ir8a.grossSalary)}
                  note="Basic + fixed allowance"/>
                <Field2 label="Bonuses" value={fmt(0)} note="Not declared this period"/>
                <Field2 label="Director's fees" value={fmt(0)}/>
                <Field2 label="Commission" value={fmt(0)}/>
                <Field2 label="Other allowances" value={fmt(0)}/>
                <Field2 label="Benefits-in-kind" value={fmt(ir8a.benefitsInKind)}/>
                <Field2 label="Gross total (Box A)" value={fmt(ir8a.grossTotal)}
                  note="Sum of all employment income" highlight="amber"/>
              </div>

              {/* Box B — CPF & deductions */}
              <div>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, letterSpacing:"0.08em",
                  textTransform:"uppercase", marginBottom:8 }}>B — CPF Contributions</div>
                <Field2 label={`Employee CPF (${(ir8a.eeRate*100).toFixed(1)}%)`}
                  value={fmt(ir8a.eeCPF)} highlight="red"
                  note="Deducted from employee's salary"/>
                <Field2 label={`Employer CPF (${(ir8a.erRate*100).toFixed(1)}%)`}
                  value={fmt(ir8a.erCPF)} highlight="green"
                  note="Company contribution (not deducted from employee)"/>
                <Field2 label="Total CPF remittance" value={fmt(ir8a.totalCPF)} highlight="amber"/>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, letterSpacing:"0.08em",
                  textTransform:"uppercase", margin:"14px 0 8px" }}>C — Exempt / Others</div>
                <Field2 label="Exempt income (NS, etc.)" value={fmt(ir8a.exemptIncome)}/>
                <Field2 label="SDL" value={fmt(ir8a.sdl)} note="Skills Dev. Levy (employer-borne)"/>
                <div style={{ marginTop:14, padding:"12px 14px", background:T.amberDim,
                  border:`0.5px solid ${T.amber}`, borderRadius:7 }}>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.amber, marginBottom:4 }}>
                    CHARGEABLE INCOME (INDICATIVE)
                  </div>
                  <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:500, color:T.amber }}>
                    {fmt(ir8a.chargeableIncome)}
                  </div>
                  <div style={{ fontFamily:T.sans, fontSize:10, color:T.text2, marginTop:4 }}>
                    Gross − EE CPF. Excludes personal reliefs — IRAS computes final tax.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop:16, padding:"10px 14px", background:T.bg2, borderRadius:7,
              fontFamily:T.sans, fontSize:11, color:T.text2 }}>
              ⚠ This is a working IR8A summary. Final submission must be made via IRAS Auto-Inclusion Scheme (AIS)
              at mytax.iras.gov.sg by 1 March {ir8aYear + 1}. Verify all figures before submission.
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Monthly summary table ────────────────────────────────────────────────
  const MonthlySummary = () => {
    const completedMonths = [
      { month:"January 2026",  period:"2026-01", gross:totals.gross/3, ee:totals.ee/3, er:totals.er/3, sdl:totals.sdl/3, net:totals.net/3, status:"paid" },
      { month:"February 2026", period:"2026-02", gross:totals.gross/3, ee:totals.ee/3, er:totals.er/3, sdl:totals.sdl/3, net:totals.net/3, status:"paid" },
      { month:"March 2026",    period:"2026-03", gross:totals.gross/3, ee:totals.ee/3, er:totals.er/3, sdl:totals.sdl/3, net:totals.net/3, status:"pending" },
    ];
    return (
      <div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
          {[
            { label:"YTD gross",    value:fmt(totals.gross), accent:T.accent },
            { label:"YTD net paid", value:fmt(totals.net),   accent:T.green  },
            { label:"YTD CPF",      value:fmt(totals.cpf),   accent:T.amber  },
            { label:"YTD SDL",      value:fmt(totals.sdl),   accent:T.purple },
          ].map(c => (
            <MetricCard key={c.label} label={c.label} value={c.value} accent={c.accent}/>
          ))}
        </div>
        <div style={{ border:`0.5px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.bg2 }}>
                <TH>Period</TH>
                <TH right>Employees</TH>
                <TH right>Gross payroll</TH>
                <TH right>EE CPF</TH>
                <TH right>ER CPF</TH>
                <TH right>SDL</TH>
                <TH right>Net salaries</TH>
                <TH right>Status</TH>
              </tr>
            </thead>
            <tbody>
              {completedMonths.map((m, i) => (
                <tr key={m.period} style={{ borderTop:i>0?`0.5px solid ${T.border}`:undefined }}>
                  <TD>{m.month}</TD>
                  <TD right mono>{employees.length}</TD>
                  <TD right mono>{fmt(m.gross)}</TD>
                  <TD right mono color={T.purple}>{fmt(m.ee)}</TD>
                  <TD right mono color={T.teal}>{fmt(m.er)}</TD>
                  <TD right mono color={T.text2} small>{fmt(m.sdl)}</TD>
                  <TD right mono bold color={T.green}>{fmt(m.net)}</TD>
                  <td style={{ padding:"11px 12px", textAlign:"right" }}>
                    <Badge color={m.status==="paid"?"green":"amber"}>{m.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:`1px solid ${T.border}`, background:T.bg2 }}>
                <td colSpan={2} style={{ padding:"10px 12px", fontFamily:T.mono,
                  fontSize:10, color:T.text1, letterSpacing:"0.06em" }}>YTD TOTALS</td>
                <TD right mono bold>{fmt(totals.gross)}</TD>
                <TD right mono bold color={T.purple}>{fmt(totals.ee)}</TD>
                <TD right mono bold color={T.teal}>{fmt(totals.er)}</TD>
                <TD right mono small color={T.text2}>{fmt(totals.sdl)}</TD>
                <TD right mono bold color={T.green}>{fmt(totals.net)}</TD>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  // ── CPF e-Submission preview ──────────────────────────────────────────────
  const CPFSubmission = () => (
    <div>
      <div style={{ background:T.greenDim, border:`0.5px solid ${T.green}`, borderRadius:8,
        padding:"14px 18px", marginBottom:18, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:500, color:T.green }}>
            CPF e-Submission file — March 2026
          </div>
          <div style={{ fontFamily:T.sans, fontSize:11, color:T.text1, marginTop:3 }}>
            Upload to CPF Board portal by 14 April 2026 ·
            Ref: CPF/{client?.uen ?? "202301234A"}/202603
          </div>
        </div>
        <GhostBtn style={{ fontSize:11, padding:"5px 14px" }}>
          ↓ Download .TXT
        </GhostBtn>
      </div>

      <div style={{ border:`0.5px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.bg2 }}>
              <TH>Employee</TH><TH>NRIC</TH><TH>Type</TH>
              <TH right>OW (capped)</TH>
              <TH right>EE CPF</TH><TH right>ER CPF</TH>
              <TH right>Total remit</TH><TH right>SDL</TH>
            </tr>
          </thead>
          <tbody>
            {ytdData.map((d, i) => {
              const ow     = d.monthly.owCapped;
              const ee     = d.monthly.eeCPF;
              const er     = d.monthly.erCPF;
              const sdl    = d.monthly.sdl;
              return (
                <tr key={d.id} style={{ borderTop:i>0?`0.5px solid ${T.border}`:undefined }}>
                  <td style={{ padding:"10px 12px" }}>
                    <div style={{ fontFamily:T.sans, fontSize:13, color:T.text0, fontWeight:500 }}>{d.name}</div>
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:1 }}>
                      EE {(d.eeRate*100).toFixed(1)}% / ER {(d.erRate*100).toFixed(1)}%
                    </div>
                  </td>
                  <TD mono small color={T.text1}>{d.nric_masked ?? d.nric ?? "—"}</TD>
                  <td style={{ padding:"10px 12px" }}>
                    <Badge color={d.residencyType==="citizen"?"blue":"purple"}>
                      {d.residencyType==="citizen"?"SC":d.residencyType?.toUpperCase()}
                    </Badge>
                  </td>
                  <TD right mono color={d.monthly.owCeiled?T.amber:T.text1}>{fmt(ow)}</TD>
                  <TD right mono bold color={T.purple}>{fmt(ee)}</TD>
                  <TD right mono bold color={T.teal}>{fmt(er)}</TD>
                  <TD right mono bold color={T.green}>{fmt(ee+er)}</TD>
                  <TD right mono small color={T.text2}>{fmt(sdl)}</TD>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop:`1px solid ${T.border}`, background:T.bg2 }}>
              <td colSpan={4} style={{ padding:"10px 12px", fontFamily:T.mono,
                fontSize:10, color:T.text1, letterSpacing:"0.06em" }}>MONTHLY TOTALS</td>
              <TD right mono bold color={T.purple}>{fmt(ytdData.reduce((s,d)=>s+d.monthly.eeCPF,0))}</TD>
              <TD right mono bold color={T.teal}>{fmt(ytdData.reduce((s,d)=>s+d.monthly.erCPF,0))}</TD>
              <TD right mono bold color={T.green}>{fmt(ytdData.reduce((s,d)=>s+d.monthly.cpfRemit,0))}</TD>
              <TD right mono small color={T.text2}>{fmt(ytdData.reduce((s,d)=>s+d.monthly.sdl,0))}</TD>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop:12, fontFamily:T.mono, fontSize:10, color:T.text2, display:"flex", gap:20 }}>
        <span>OW ceiling: S$8,000/month</span>
        <span>AW ceiling: S$102,000 − annual OW</span>
        <span>SDL: 0.25% of gross, min S$2.00</span>
        <span>CPF due: 14th of following month</span>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <div style={{ fontFamily:T.mono, fontSize:11, color:T.text2, marginBottom:4 }}>
          REPORTS & COMPLIANCE — {ir8aYear}
        </div>
        <h1 style={{ fontFamily:T.display, fontSize:22, fontWeight:700, color:T.text0,
          margin:"0 0 4px", letterSpacing:"-0.02em" }}>{client?.name ?? "—"}</h1>
        <div style={{ fontFamily:T.mono, fontSize:12, color:T.text1 }}>
          UEN {client?.uen ?? "—"} · {employees.length} employees
        </div>
      </div>

      {/* Tab bar + actions */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        borderBottom:`0.5px solid ${T.border}`, marginBottom:24 }}>
        <div style={{ display:"flex" }}>
          {[
            { id:"ir8a",     label:"IR8A / IRAS" },
            { id:"monthly",  label:"Monthly summary" },
            { id:"cpfsub",   label:"CPF e-Submission" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:"10px 18px", fontFamily:T.mono, fontSize:12,
              background:"transparent", border:"none", cursor:"pointer",
              color:tab===t.id?T.text0:T.text2,
              borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent",
              marginBottom:-1 }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, paddingBottom:2 }}>
          {tab==="ir8a" && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:T.mono, fontSize:10, color:T.text2 }}>YA</span>
                <select value={ir8aYear+1} onChange={e => setIr8aYear(parseInt(e.target.value)-1)}
                  style={{ background:T.bg2, color:T.text0, border:`0.5px solid ${T.border}`,
                    borderRadius:5, padding:"4px 8px", fontFamily:T.mono, fontSize:11, cursor:"pointer" }}>
                  {[2025,2026,2027].map(y => <option key={y} value={y}>YA {y}</option>)}
                </select>
              </div>
              <GhostBtn onClick={downloadIR8AcsV} style={{ fontSize:11, padding:"5px 14px" }}>
                ↓ CSV (all employees)
              </GhostBtn>
              <PrimaryBtn style={{ fontSize:11, padding:"5px 14px" }}>
                Submit to IRAS AIS
              </PrimaryBtn>
            </>
          )}
          {tab==="monthly" && (
            <GhostBtn onClick={downloadPayrollCSV} style={{ fontSize:11, padding:"5px 14px" }}>
              ↓ CSV export
            </GhostBtn>
          )}
          {tab==="cpfsub" && (
            <GhostBtn style={{ fontSize:11, padding:"5px 14px" }}>
              ↓ CPF .TXT file
            </GhostBtn>
          )}
        </div>
      </div>

      {/* IR8A tab */}
      {tab==="ir8a" && (
        <div>
          <div style={{ background:T.amberDim, border:`0.5px solid ${T.amber}`, borderRadius:8,
            padding:"12px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:16 }}>⚠</span>
            <div style={{ fontFamily:T.sans, fontSize:12, color:T.amber }}>
              <strong>IRAS Auto-Inclusion Scheme (AIS)</strong> — Submit IR8A data by
              <strong> 1 March {ir8aYear + 1}</strong>. Employers with 5+ employees must submit electronically.
              Verify all figures before uploading to mytax.iras.gov.sg.
            </div>
          </div>
          <SectionHeader title={`IR8A Summary — Year of Assessment ${ir8aYear + 1}`}/>
          {employees.map(emp => <IR8ACard key={emp.id} emp={emp}/>)}

          {/* YTD totals strip */}
          <div style={{ marginTop:16, background:T.bg2, border:`0.5px solid ${T.border}`,
            borderRadius:8, padding:"14px 18px", display:"grid",
            gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
            {[
              { label:"Total gross income", value:fmt(totals.gross), color:T.text0  },
              { label:"Total EE CPF",       value:fmt(totals.ee),    color:T.purple },
              { label:"Total ER CPF",       value:fmt(totals.er),    color:T.teal   },
              { label:"Total CPF remit",    value:fmt(totals.cpf),   color:T.accent },
              { label:"Total SDL",          value:fmt(totals.sdl),   color:T.amber  },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.text2, letterSpacing:"0.08em",
                  textTransform:"uppercase", marginBottom:5 }}>{f.label}</div>
                <div style={{ fontFamily:T.mono, fontSize:15, fontWeight:500, color:f.color }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly summary tab */}
      {tab==="monthly" && <MonthlySummary/>}

      {/* CPF e-Submission tab */}
      {tab==="cpfsub" && <CPFSubmission/>}
    </div>
  );
}

// ─── PAGE: CPF Reference ──────────────────────────────────────────────────────
function CPFView({ client }) {
  const {results:rows,totals} = computePayrollRun(EMPLOYEES);
  return (
    <div>
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:T.mono,fontSize:11,color:T.text2,marginBottom:4}}>CPF CONTRIBUTIONS — MARCH 2026</div>
        <h1 style={{fontFamily:T.display,fontSize:22,fontWeight:700,color:T.text0,margin:"0 0 4px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>OW ceiling: S$8,000/month · Rates as at Jan 2026</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:28}}>
        <MetricCard label="Employee contributions" value={fmt(totals.ee)}            sub="deducted from payroll" accent={T.purple}/>
        <MetricCard label="Employer contributions" value={fmt(totals.er)}            sub="company liability"     accent={T.teal}/>
        <MetricCard label="Total CPF payable"      value={fmt(totals.ee+totals.er)}  sub="to CPF Board"         accent={T.accent}/>
        <MetricCard label="SDL payable"            value={fmt(totals.sdl)}           sub="to CPF Board"         accent={T.amber}/>
      </div>
      <SectionHeader title="CPF rate reference (Jan 2026)"/>
      <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:24}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:T.bg2}}>
            <TH>Age bracket</TH><TH>Residency</TH>
            <TH right>EE rate</TH><TH right>ER rate</TH><TH right>Total</TH>
            <TH right>OA alloc</TH><TH right>SA alloc</TH><TH right>MA alloc</TH>
          </tr></thead>
          <tbody>
            {CPF_RATES_TABLE.citizen.map((r,i)=>{
              const ages=["≤35","36–45","46–50","51–55","56–60","61–65",">65"];
              const al=ALLOC_TABLE[i];
              return (
                <tr key={i} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined}}>
                  <TD mono>{ages[i]}</TD>
                  <td style={{padding:"10px 12px"}}><Badge color="blue">Citizen / PR3</Badge></td>
                  <TD right mono color={T.purple}>{(r.eeRate*100).toFixed(1)}%</TD>
                  <TD right mono color={T.teal}>{(r.erRate*100).toFixed(1)}%</TD>
                  <TD right mono bold>{((r.eeRate+r.erRate)*100).toFixed(1)}%</TD>
                  <TD right mono small color={T.text1}>{(al.oa*100).toFixed(2)}%</TD>
                  <TD right mono small color={T.text1}>{(al.sa*100).toFixed(2)}%</TD>
                  <TD right mono small color={T.text1}>{(al.ma*100).toFixed(2)}%</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SectionHeader title="Employee CPF summary"/>
      <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:T.bg2}}>
            <TH>Name</TH><TH>NRIC</TH><TH>Type</TH><TH right>Age</TH>
            <TH right>Gross</TH><TH right>OW (capped)</TH>
            <TH right>EE CPF</TH><TH right>ER CPF</TH><TH right>SDL</TH>
          </tr></thead>
          <tbody>
            {rows.map((r,i)=>(
              <tr key={r.id} style={{borderTop:i>0?`0.5px solid ${T.border}`:undefined}}>
                <td style={{padding:"10px 12px"}}><div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{r.name}</div></td>
                <TD mono small color={T.text1}>{r.nric}</TD>
                <td style={{padding:"10px 12px"}}>
                  <Badge color={r.residencyType==="citizen"?"blue":"purple"}>
                    {r.residencyType==="citizen"?"SC":r.residencyType.toUpperCase()}
                  </Badge>
                </td>
                <TD right mono small color={T.text1}>{r.age}</TD>
                <TD right mono>{fmt(r.cpf.grossPay)}</TD>
                <TD right mono small color={r.cpf.owCeiled?T.amber:T.text1}>{fmt(r.cpf.owCapped)}</TD>
                <TD right mono bold color={T.purple}>{fmt(r.cpf.eeCPF)}</TD>
                <TD right mono bold color={T.teal}>{fmt(r.cpf.erCPF)}</TD>
                <TD right mono small color={T.text2}>{fmt(r.cpf.sdl)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PAGE: Expense Claims ─────────────────────────────────────────────────────
function ClaimsPage({ client, claims, setClaims }) {
  const [tab, setTab]           = useState("queue");       // queue | all | new | payroll
  const [selected, setSelected] = useState(new Set());     // claim ids selected for payroll lock
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ employeeId:"", category:"", description:"", amount:"", receiptRef:"" });
  const [rejectId, setRejectId] = useState(null);
  const [rejectText, setRejectText] = useState("");

  // ── Derived lists ──────────────────────────────────────────────────────────
  const pending  = claims.filter(c => c.status === "pending");
  const approved = claims.filter(c => c.status === "approved" && !c.payrollRun);
  const locked   = claims.filter(c => c.payrollRun);
  const rejected = claims.filter(c => c.status === "rejected");

  const approvedTotal  = approved.reduce((s,c) => s+c.amount, 0);
  const pendingTotal   = pending.reduce((s,c) => s+c.amount, 0);
  const selectedClaims = approved.filter(c => selected.has(c.id));
  const selectedTotal  = selectedClaims.reduce((s,c) => s+c.amount, 0);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const approve = async id => {
    // Optimistic update
    setClaims(async () => { try { await apiPost(`/clients/${client.id}/claims/${id}/approve`); } catch(e) { console.warn('API unavailable, using local state', e.message); } });
    setClaims(cs => typeof cs === 'function' ? cs : cs.map(c => c.id===id ? {...c, status:"approved"} : c));
    // Prefer local state mutation (works even without API)
    if (typeof setClaims === 'function') {
      setClaims(cs => Array.isArray(cs) ? cs.map(c => c.id===id ? {...c, status:"approved"} : c) : cs);
    }
  };
  const startReject = id => { setRejectId(id); setRejectText(""); };
  const confirmReject = async () => {
    try { await apiPost(`/clients/${client.id}/claims/${rejectId}/reject`, { reason: rejectText||"Rejected" }); }
    catch(e) { console.warn('API unavailable', e.message); }
    setClaims(cs => Array.isArray(cs) ? cs.map(c => c.id===rejectId
      ? {...c, status:"rejected", rejectReason: rejectText||"Rejected by operator"}
      : c) : cs);
    setRejectId(null);
  };
  const lockToPayroll = async () => {
    if (!selectedClaims.length) return;
    try {
      const ids = selectedClaims.map(c => c.id);
      await apiPost(`/clients/${client.id}/claims/lock-to-payroll`, {
        claimIds: ids, payrollPeriodId: "current"
      });
    } catch(e) { console.warn('API unavailable', e.message); }
    setClaims(cs => Array.isArray(cs) ? cs.map(c =>
      selected.has(c.id) ? {...c, payrollRun:"MAR-2026"} : c
    ) : cs);
    setSelected(new Set());
    setTab("payroll");
  };
  const submitNew = async () => {
    if (!form.employeeId || !form.category || !form.amount) return;
    const emp = EMPLOYEES.find(e => e.id === parseInt(form.employeeId));
    const newClaim = {
      id: Date.now(),
      employeeId: parseInt(form.employeeId),
      employeeName: emp?.name || "Unknown",
      category: form.category,
      description: form.description,
      amount: parseFloat(form.amount),
      receiptRef: form.receiptRef || `RCP-${String(Date.now()).slice(-4)}`,
      submittedDate: new Date().toISOString().slice(0,10),
      status: "pending",
      managerId: null,
      managerName: "Admin submission",
      payrollRun: null,
    };
    try {
      await apiPost(`/clients/${client.id}/claims`, {
        categoryId: form.category,
        description: form.description,
        amount: toCents(form.amount),
        expenseDate: new Date().toISOString().slice(0,10),
        receiptRef: form.receiptRef,
        employeeId: form.employeeId,
      });
    } catch(e) { console.warn('API unavailable, adding locally', e.message); }
    setClaims(cs => Array.isArray(cs) ? [newClaim, ...cs] : [newClaim]);
    setForm({ employeeId:"", category:"", description:"", amount:"", receiptRef:"" });
    setShowForm(false);
    setTab("queue");
  };

  // ── Colours ────────────────────────────────────────────────────────────────
  const statusColour = s => ({pending:"amber", approved:"green", rejected:"red", locked:"blue"})[s] || "gray";
  const statusLabel  = s => ({pending:"Pending approval", approved:"Approved", rejected:"Rejected", locked:"Locked to payroll"})[s] || s;

  // ── Sub-components ─────────────────────────────────────────────────────────
  const ClaimRow = ({ c, showActions=false, showSelect=false }) => {
    const canSelect = c.status==="approved" && !c.payrollRun;
    return (
      <RowHover style={{ borderTop:`0.5px solid ${T.border}` }}>
        {showSelect && (
          <td style={{padding:"10px 12px"}}>
            {canSelect && (
              <input type="checkbox" checked={selected.has(c.id)}
                style={{accentColor:T.accent, cursor:"pointer"}}
                onChange={() => {
                  const s = new Set(selected);
                  s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                  setSelected(s);
                }}/>
            )}
          </td>
        )}
        <td style={{padding:"10px 12px"}}>
          <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{c.employeeName}</div>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>{c.submittedDate}</div>
        </td>
        <TD color={T.text1}>{c.category}</TD>
        <td style={{padding:"10px 12px",maxWidth:200}}>
          <div style={{fontFamily:T.sans,fontSize:12,color:T.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.description}</div>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginTop:2}}>{c.receiptRef}</div>
        </td>
        <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,fontSize:13,color:T.text0,fontWeight:500}}>
          {fmt(c.amount)}
        </td>
        <TD color={T.text1} small>{c.managerName}</TD>
        <td style={{padding:"10px 12px"}}>
          <Badge color={statusColour(c.payrollRun?"locked":c.status)}>
            {c.payrollRun ? `Payroll ${c.payrollRun}` : statusLabel(c.status)}
          </Badge>
          {c.rejectReason && (
            <div style={{fontFamily:T.sans,fontSize:10,color:T.red,marginTop:3,maxWidth:160,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
              title={c.rejectReason}>↳ {c.rejectReason}</div>
          )}
        </td>
        {showActions && (
          <td style={{padding:"10px 12px",textAlign:"right"}}>
            <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
              {c.status==="pending" && (
                <>
                  <button onClick={()=>approve(c.id)}
                    style={{fontFamily:T.mono,fontSize:10,color:T.green,background:"transparent",
                      border:`0.5px solid ${T.green}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
                    ✓ Approve
                  </button>
                  <button onClick={()=>startReject(c.id)}
                    style={{fontFamily:T.mono,fontSize:10,color:T.red,background:"transparent",
                      border:`0.5px solid ${T.red}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
                    ✗ Reject
                  </button>
                </>
              )}
              {c.status==="approved" && !c.payrollRun && (
                <span style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>Ready for payroll</span>
              )}
            </div>
          </td>
        )}
      </RowHover>
    );
  };

  const TableHead = ({ showSelect=false, showActions=false }) => (
    <thead>
      <tr style={{background:T.bg2}}>
        {showSelect && <TH/>}
        <TH>Employee</TH><TH>Category</TH><TH>Description</TH>
        <TH right>Amount</TH><TH>Submitted by</TH><TH>Status</TH>
        {showActions && <TH right>Actions</TH>}
      </tr>
    </thead>
  );

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:T.mono,fontSize:11,color:T.text2,marginBottom:4}}>EXPENSE CLAIMS — MARCH 2026</div>
        <h1 style={{fontFamily:T.display,fontSize:22,fontWeight:700,color:T.text0,margin:"0 0 4px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{fontFamily:T.mono,fontSize:12,color:T.text1}}>UEN {client.uen} · {EMPLOYEES.length} employees</div>
      </div>

      {/* Summary metrics */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <MetricCard label="Pending approval" value={pending.length}  sub={fmt(pendingTotal)+" pending"}  accent={T.amber}/>
        <MetricCard label="Approved"         value={approved.length} sub={fmt(approvedTotal)+" to pay"}  accent={T.green}/>
        <MetricCard label="Locked to payroll"value={locked.length}   sub="In next salary run"            accent={T.accent}/>
        <MetricCard label="Rejected"         value={rejected.length} sub="This period"                   accent={T.red}/>
      </div>

      {/* Reject modal */}
      {rejectId && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:10,
            padding:28,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
            <div style={{fontFamily:T.display,fontSize:16,fontWeight:600,marginBottom:16}}>Reject claim</div>
            <div style={{fontFamily:T.sans,fontSize:13,color:T.text1,marginBottom:12}}>
              Claim: <strong style={{color:T.text0}}>{claims.find(c=>c.id===rejectId)?.description}</strong>
            </div>
            <div style={{fontFamily:T.sans,fontSize:12,color:T.text2,marginBottom:6}}>Reason (shown to employee)</div>
            <input value={rejectText} onChange={e=>setRejectText(e.target.value)}
              placeholder="e.g. Receipt not attached, Out of policy..."
              style={{width:"100%",background:T.bg2,border:`0.5px solid ${T.borderStrong}`,
                borderRadius:6,padding:"8px 12px",color:T.text0,fontFamily:T.sans,
                fontSize:13,outline:"none",marginBottom:20}}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
              <GhostBtn onClick={()=>setRejectId(null)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={confirmReject} color={T.red}>Confirm reject</PrimaryBtn>
            </div>
          </div>
        </div>
      )}

      {/* New claim form */}
      {showForm && (
        <div style={{background:T.bg2,border:`0.5px solid ${T.borderStrong}`,borderRadius:10,
          padding:"20px 24px",marginBottom:24}}>
          <div style={{fontFamily:T.display,fontSize:14,fontWeight:600,marginBottom:16,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            Submit claim on behalf of employee
            <button onClick={()=>setShowForm(false)}
              style={{background:"transparent",border:"none",color:T.text2,cursor:"pointer",fontSize:18}}>×</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[
              { label:"Employee", key:"employeeId", type:"select",
                options:[{value:"",label:"Select employee…"},...EMPLOYEES.map(e=>({value:e.id,label:e.name}))] },
              { label:"Category", key:"category", type:"select",
                options:[{value:"",label:"Select category…"},...CLAIM_CATEGORIES.map(c=>({value:c,label:c}))] },
              { label:"Description", key:"description", type:"text", placeholder:"Brief description of expense" },
              { label:"Amount (S$)",  key:"amount",      type:"number", placeholder:"0.00" },
              { label:"Receipt ref",  key:"receiptRef",  type:"text", placeholder:"e.g. RCP-009 (optional)" },
            ].map(f => (
              <div key={f.key} style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontFamily:T.sans,fontSize:11,color:T.text2,textTransform:"uppercase",letterSpacing:"0.07em"}}>{f.label}</label>
                {f.type==="select" ? (
                  <select value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:6,
                      padding:"8px 10px",color:f.key==="employeeId"&&!form.employeeId?T.text2:T.text0,
                      fontFamily:T.sans,fontSize:13,outline:"none",cursor:"pointer"}}>
                    {f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type={f.type} value={form[f.key]} placeholder={f.placeholder}
                    onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:6,
                      padding:"8px 10px",color:T.text0,fontFamily:T.sans,fontSize:13,outline:"none"}}/>
                )}
              </div>
            ))}
          </div>
          <div style={{marginTop:18,display:"flex",gap:10,justifyContent:"flex-end"}}>
            <GhostBtn onClick={()=>setShowForm(false)}>Cancel</GhostBtn>
            <PrimaryBtn onClick={submitNew} color={T.green}>Submit claim</PrimaryBtn>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:`0.5px solid ${T.border}`,marginBottom:20}}>
        <div style={{display:"flex"}}>
          {[
            {id:"queue",   label:"Approval queue",  count:pending.length,  countColor:T.amber},
            {id:"all",     label:"All claims",       count:claims.length},
            {id:"payroll", label:"Locked to payroll",count:locked.length,  countColor:T.accent},
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"10px 18px",fontFamily:T.mono,fontSize:12,
              background:"transparent",border:"none",cursor:"pointer",
              color:tab===t.id?T.text0:T.text2,
              borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent",
              marginBottom:-1,display:"flex",alignItems:"center",gap:7}}>
              {t.label}
              {t.count>0&&(
                <span style={{background:t.countColor?`${t.countColor}22`:T.bg3,
                  color:t.countColor||T.text2,fontFamily:T.mono,fontSize:9,fontWeight:500,
                  padding:"1px 6px",borderRadius:10,border:`0.5px solid ${t.countColor||T.border}`}}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={()=>setShowForm(s=>!s)}
          style={{fontFamily:T.mono,fontSize:11,color:T.green,background:"transparent",
            border:`0.5px solid ${T.green}`,borderRadius:5,padding:"5px 14px",cursor:"pointer"}}>
          + Submit claim
        </button>
      </div>

      {/* ── Queue tab: pending approval ── */}
      {tab==="queue"&&(
        <div>
          {pending.length===0 ? (
            <div style={{textAlign:"center",padding:"48px 0",color:T.text2,fontFamily:T.sans,fontSize:14}}>
              No claims pending approval ✓
            </div>
          ) : (
            <>
              <div style={{fontFamily:T.sans,fontSize:12,color:T.text2,marginBottom:12}}>
                {pending.length} claim{pending.length!==1?"s":""} awaiting manager → operator approval.
                Manager has approved these in their system; you are the final processor.
              </div>
              <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <TableHead showActions/>
                  <tbody>{pending.map(c=><ClaimRow key={c.id} c={c} showActions/>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── All tab ── */}
      {tab==="all"&&(
        <div>
          {/* Payroll lock panel — shown when approved claims exist */}
          {approved.length>0&&(
            <div style={{background:T.greenDim,border:`1px solid rgba(63,185,80,0.25)`,borderRadius:10,
              padding:"16px 20px",marginBottom:18,display:"flex",alignItems:"center",gap:16}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,marginBottom:3}}>
                  {approved.length} approved claim{approved.length!==1?"s":""} ready to lock into payroll
                </div>
                <div style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>
                  Total: <strong style={{color:T.green}}>{fmt(approvedTotal)}</strong> · Will be added as a line in the March 2026 salary payment instruction.
                </div>
              </div>
              <div style={{fontFamily:T.mono,fontSize:11,color:T.text2}}>
                {selectedClaims.length>0 && <span style={{color:T.green}}>{selectedClaims.length} selected · {fmt(selectedTotal)}</span>}
              </div>
              <PrimaryBtn onClick={lockToPayroll} color={T.green}
                style={{opacity:selectedClaims.length>0?1:0.5}}>
                Lock {selectedClaims.length>0?selectedClaims.length:approved.length} to payroll →
              </PrimaryBtn>
            </div>
          )}
          <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <TableHead showSelect showActions/>
              <tbody>{claims.map(c=><ClaimRow key={c.id} c={c} showSelect showActions/>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Payroll tab: locked claims ── */}
      {tab==="payroll"&&(
        <div>
          {locked.length===0 ? (
            <div style={{textAlign:"center",padding:"48px 0",color:T.text2,fontFamily:T.sans,fontSize:14}}>
              No claims locked to payroll yet. Approve and lock claims from the All Claims tab.
            </div>
          ) : (
            <>
              {/* Summary by employee — for payroll run integration */}
              <div style={{background:T.bg2,border:`0.5px solid ${T.border}`,borderRadius:10,
                padding:"16px 20px",marginBottom:20}}>
                <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,marginBottom:14}}>
                  Claims payout summary — added to March 2026 salary run
                </div>
                <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr style={{background:T.bg3}}>
                      <TH>Employee</TH><TH right>No. of claims</TH>
                      <TH right>Total reimbursement</TH><TH right>Payroll run</TH>
                    </tr></thead>
                    <tbody>
                      {Object.values(
                        locked.reduce((acc,c)=>{
                          if(!acc[c.employeeId]) acc[c.employeeId]={name:c.employeeName,count:0,total:0,run:c.payrollRun};
                          acc[c.employeeId].count++;
                          acc[c.employeeId].total+=c.amount;
                          return acc;
                        },{})
                      ).map((e,i)=>(
                        <tr key={i} style={{borderTop:`0.5px solid ${T.border}`}}>
                          <TD>{e.name}</TD>
                          <TD right mono>{e.count}</TD>
                          <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,
                            fontSize:13,color:T.green,fontWeight:500}}>{fmt(e.total)}</td>
                          <td style={{padding:"10px 12px",textAlign:"right"}}>
                            <Badge color="blue">{e.run}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:`1px solid ${T.border}`,background:T.bg3}}>
                        <td colSpan={2} style={{padding:"10px 12px",fontFamily:T.mono,fontSize:10,
                          color:T.text1,letterSpacing:"0.06em"}}>TOTAL REIMBURSEMENT</td>
                        <td style={{padding:"10px 12px",textAlign:"right",fontFamily:T.mono,
                          fontSize:14,color:T.green,fontWeight:500}}>
                          {fmt(locked.reduce((s,c)=>s+c.amount,0))}
                        </td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style={{marginTop:12,fontFamily:T.sans,fontSize:12,color:T.text2}}>
                  These amounts will appear as a separate "Expense reimbursement" line in the salary payment instruction.
                  No CPF is deducted on reimbursements.
                </div>
              </div>

              {/* Full detail */}
              <SectionHeader title="Locked claim detail"/>
              <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <TableHead/>
                  <tbody>{locked.map(c=><ClaimRow key={c.id} c={c}/>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Leave Management ───────────────────────────────────────────────────
function LeavePage({ client, leaveRecords, setLeaveRecords }) {
  const [tab, setTab]       = useState("queue");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]     = useState({ employeeId:"", type:"annual", startDate:"", endDate:"", days:"", reason:"", submittedBy:"admin" });
  const [rejectId, setRejectId] = useState(null);
  const [rejectText, setRejectText] = useState("");
  const [expandedEmp, setExpandedEmp] = useState(null);

  // Build live entitlements by applying approved records
  const entitlements = buildEntitlements().map(ent => {
    const empRecs = leaveRecords.filter(r => r.employeeId === ent.employeeId);
    const apply = (type, field) => ({
      ...ent[type],
      used:    empRecs.filter(r => r.type===type && r.status==="approved").reduce((s,r)=>s+r.days,0),
      pending: empRecs.filter(r => r.type===type && r.status==="pending").reduce((s,r)=>s+r.days,0),
    });
    return {
      ...ent,
      annual:    apply("annual","annual"),
      medical:   apply("medical","medical"),
      hosp:      apply("hosp","hosp"),
      childcare: apply("childcare","childcare"),
      maternity: apply("maternity","maternity"),
      paternity: apply("paternity","paternity"),
      npl:       apply("npl","npl"),
    };
  });

  const pending  = leaveRecords.filter(r => r.status==="pending");
  const approved = leaveRecords.filter(r => r.status==="approved");
  const rejected = leaveRecords.filter(r => r.status==="rejected");
  const nplApproved = approved.filter(r => r.type==="npl");

  // NPL payroll impact — days per employee
  const nplImpact = EMPLOYEES.map(e => {
    const nplDays = nplApproved.filter(r => r.employeeId===e.id).reduce((s,r)=>s+r.days,0);
    if (!nplDays) return null;
    const totalDays = 31; // March 2026
    const workedDays = totalDays - nplDays;
    const gross = e.basicSalary + (e.allowance||0);
    const proratedGross = Math.floor(gross * workedDays / totalDays * 100) / 100;
    const salaryDeduction = gross - proratedGross;
    return { employeeId:e.id, name:e.name, nplDays, workedDays, totalDays, gross, proratedGross, salaryDeduction };
  }).filter(Boolean);

  const handlers = {
    approve: async id => {
      // Optimistic local update
      setLeaveRecords(rs => Array.isArray(rs) ? rs.map(r => r.id===id ? {...r,status:"approved"} : r) : rs);
      try { await apiPost(`/clients/${client.id}/leave/${id}/approve`); }
      catch(e) { console.warn('Leave approve API unavailable:', e.message); }
      await setLeaveRecords(async () => {}); // trigger parent refetch if connected
    },
    startReject: id => { setRejectId(id); setRejectText(""); },
    confirmReject: async () => {
      setLeaveRecords(rs => Array.isArray(rs)
        ? rs.map(r => r.id===rejectId ? {...r,status:"rejected",rejectReason:rejectText||"Rejected"} : r)
        : rs);
      try { await apiPost(`/clients/${client.id}/leave/${rejectId}/reject`, { reason: rejectText||"Rejected" }); }
      catch(e) { console.warn('Leave reject API unavailable:', e.message); }
      setRejectId(null);
    },
    submit: async () => {
      if (!form.employeeId || !form.days || !form.startDate) return;
      const newRecord = {
        id: Date.now(),
        employeeId: parseInt(form.employeeId),
        type: form.type,
        days: parseInt(form.days),
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        reason: form.reason,
        status: "pending",
        submittedBy: form.submittedBy,
      };
      try {
        await apiPost(`/clients/${client.id}/leave`, {
          leaveType:  form.type,
          startDate:  form.startDate,
          endDate:    form.endDate || form.startDate,
          days:       parseInt(form.days),
          reason:     form.reason,
          employeeId: form.employeeId,
        });
      } catch(e) { console.warn('Leave submit API unavailable:', e.message); }
      setLeaveRecords(rs => Array.isArray(rs) ? [newRecord, ...rs] : [newRecord]);
      setForm({ employeeId:"", type:"annual", startDate:"", endDate:"", days:"", reason:"", submittedBy:"admin" });
      setShowForm(false);
      setTab("queue");
    },
  };

  const typeInfo = id => LEAVE_TYPES.find(t => t.id===id) || LEAVE_TYPES[0];
  const empName  = id => EMPLOYEES.find(e => e.id===id)?.name || "—";

  const LeaveRow = ({ r, showActions=false }) => {
    const ti = typeInfo(r.type);
    return (
      <RowHover style={{borderTop:`0.5px solid ${T.border}`}}>
        <td style={{padding:"10px 12px"}}>
          <div style={{fontFamily:T.sans,fontSize:13,color:T.text0,fontWeight:500}}>{empName(r.employeeId)}</div>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>
            {r.startDate}{r.endDate!==r.startDate?` → ${r.endDate}`:""}
          </div>
        </td>
        <td style={{padding:"10px 12px"}}>
          <Badge color={ti.color}>{ti.short}</Badge>
          <div style={{fontFamily:T.sans,fontSize:10,color:T.text2,marginTop:3}}>{ti.label}</div>
        </td>
        <td style={{padding:"10px 12px",textAlign:"center",fontFamily:T.mono,fontSize:14,
          color:r.type==="npl"?T.amber:T.text0,fontWeight:500}}>{r.days}d</td>
        <TD color={T.text1}>{r.reason||"—"}</TD>
        <td style={{padding:"10px 12px"}}>
          <span style={{fontFamily:T.mono,fontSize:10,color:T.text2,
            background:r.submittedBy==="admin"?T.bg3:T.accentDim,
            padding:"2px 8px",borderRadius:10,border:`0.5px solid ${r.submittedBy==="admin"?T.border:T.accentDim}`}}>
            {r.submittedBy}
          </span>
        </td>
        <td style={{padding:"10px 12px"}}>
          <Badge color={r.status==="approved"?"green":r.status==="rejected"?"red":"amber"}>
            {r.status}
          </Badge>
          {r.rejectReason&&<div style={{fontSize:10,color:T.red,marginTop:2}}>{r.rejectReason}</div>}
        </td>
        {showActions&&(
          <td style={{padding:"10px 12px",textAlign:"right"}}>
            {r.status==="pending"&&(
              <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={()=>handlers.approve(r.id)}
                  style={{fontFamily:T.mono,fontSize:10,color:T.green,background:"transparent",
                    border:`0.5px solid ${T.green}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
                  ✓ Approve
                </button>
                <button onClick={()=>handlers.startReject(r.id)}
                  style={{fontFamily:T.mono,fontSize:10,color:T.red,background:"transparent",
                    border:`0.5px solid ${T.red}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
                  ✗ Reject
                </button>
              </div>
            )}
          </td>
        )}
      </RowHover>
    );
  };

  const TableHead = ({showActions=false}) => (
    <thead><tr style={{background:T.bg2}}>
      <TH>Employee</TH><TH>Type</TH><TH right>Days</TH>
      <TH>Reason</TH><TH>Submitted by</TH><TH>Status</TH>
      {showActions&&<TH right>Actions</TH>}
    </tr></thead>
  );

  // Balance bar component
  const BalBar = ({used,pending:pend,total,color}) => {
    if (total===null) return <span style={{fontFamily:T.mono,fontSize:11,color:T.text2}}>Unlimited</span>;
    const usedPct  = Math.min(100, (used/total)*100);
    const pendPct  = Math.min(100-usedPct, (pend/total)*100);
    const remaining = Math.max(0, total - used - pend);
    const clr = T[color]||T.green;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:T.mono,color:T.text2}}>
          <span style={{color:clr}}>{used}d used{pend>0?` + ${pend}d pending`:""}</span>
          <span>{remaining}d left / {total}d</span>
        </div>
        <div style={{height:5,background:T.bg3,borderRadius:3,overflow:"hidden",display:"flex"}}>
          <div style={{width:`${usedPct}%`,background:clr,borderRadius:"3px 0 0 3px"}}/>
          {pendPct>0&&<div style={{width:`${pendPct}%`,background:clr,opacity:0.35}}/>}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:T.mono,fontSize:11,color:T.text2,marginBottom:4}}>LEAVE MANAGEMENT — MARCH 2026</div>
        <h1 style={{fontFamily:T.display,fontSize:22,fontWeight:700,color:T.text0,margin:"0 0 4px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{fontFamily:T.mono,fontSize:12,color:T.text1}}>UEN {client.uen} · EA statutory entitlements · {EMPLOYEES.length} employees</div>
      </div>

      {/* Summary metrics */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <MetricCard label="Pending approval" value={pending.length}   sub={`${pending.reduce((s,r)=>s+r.days,0)} days pending`}    accent={T.amber}/>
        <MetricCard label="Approved (Mar)"   value={approved.length}  sub={`${approved.reduce((s,r)=>s+r.days,0)} days taken`}      accent={T.green}/>
        <MetricCard label="NPL this month"   value={`${nplApproved.reduce((s,r)=>s+r.days,0)}d`} sub={`${nplImpact.length} employees affected`} accent={T.amber}/>
        <MetricCard label="Payroll impact"   value={nplImpact.length?fmt(nplImpact.reduce((s,r)=>s+r.salaryDeduction,0)):"S$0.00"} sub="Salary deduction (NPL)" accent={T.red}/>
      </div>

      {/* NPL payroll impact banner */}
      {nplImpact.length>0&&(
        <div style={{background:T.amberDim,border:`1px solid rgba(210,153,34,0.3)`,borderRadius:10,
          padding:"16px 20px",marginBottom:20}}>
          <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,marginBottom:10}}>
            ⚑ NPL salary proration — automatically applied to March 2026 payroll run
          </div>
          <div style={{border:`0.5px solid rgba(210,153,34,0.25)`,borderRadius:8,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"rgba(210,153,34,0.08)"}}>
                <TH>Employee</TH><TH right>NPL days</TH><TH right>Working days</TH>
                <TH right>Full gross</TH><TH right>Prorated gross</TH><TH right>Deduction</TH>
              </tr></thead>
              <tbody>
                {nplImpact.map((n,i)=>(
                  <tr key={n.employeeId} style={{borderTop:i>0?`0.5px solid rgba(210,153,34,0.15)`:undefined}}>
                    <TD>{n.name}</TD>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:T.mono,fontSize:12,color:T.amber,fontWeight:500}}>{n.nplDays}d</td>
                    <TD right mono>{n.workedDays}/{n.totalDays}</TD>
                    <TD right mono>{fmt(n.gross)}</TD>
                    <TD right mono color={T.green}>{fmt(n.proratedGross)}</TD>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:T.mono,fontSize:12,color:T.red,fontWeight:500}}>−{fmt(n.salaryDeduction)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{fontFamily:T.sans,fontSize:11,color:T.text1,marginTop:10}}>
            These prorated salaries are passed automatically to the payroll engine as <code style={{fontFamily:T.mono,background:T.bg3,padding:"1px 5px",borderRadius:3,fontSize:10}}>daysWorked</code>. No manual adjustment needed.
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectId&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:10,padding:28,width:420}}>
            <div style={{fontFamily:T.display,fontSize:16,fontWeight:600,marginBottom:16}}>Reject leave application</div>
            <div style={{fontFamily:T.sans,fontSize:13,color:T.text1,marginBottom:12}}>
              <strong style={{color:T.text0}}>{empName(leaveRecords.find(r=>r.id===rejectId)?.employeeId)}</strong>
              {" · "}{leaveRecords.find(r=>r.id===rejectId)?.days}d {typeInfo(leaveRecords.find(r=>r.id===rejectId)?.type)?.label}
            </div>
            <div style={{fontFamily:T.sans,fontSize:11,color:T.text2,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.07em"}}>Reason</div>
            <input value={rejectText} onChange={e=>setRejectText(e.target.value)}
              placeholder="e.g. Insufficient AL balance, Peak period..."
              style={{width:"100%",background:T.bg2,border:`0.5px solid ${T.borderStrong}`,
                borderRadius:6,padding:"8px 12px",color:T.text0,fontFamily:T.sans,fontSize:13,
                outline:"none",marginBottom:20}}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
              <GhostBtn onClick={()=>setRejectId(null)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={handlers.confirmReject} color={T.red}>Confirm reject</PrimaryBtn>
            </div>
          </div>
        </div>
      )}

      {/* New leave form */}
      {showForm&&(
        <div style={{background:T.bg2,border:`0.5px solid ${T.borderStrong}`,borderRadius:10,
          padding:"20px 24px",marginBottom:24}}>
          <div style={{fontFamily:T.display,fontSize:14,fontWeight:600,marginBottom:16,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            Apply leave
            <button onClick={()=>setShowForm(false)} style={{background:"transparent",border:"none",color:T.text2,cursor:"pointer",fontSize:18}}>×</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[
              { label:"Employee",    key:"employeeId", type:"select", options:[{value:"",label:"Select employee…"},...EMPLOYEES.map(e=>({value:e.id,label:e.name}))] },
              { label:"Leave type",  key:"type",       type:"select", options:LEAVE_TYPES.map(t=>({value:t.id,label:t.label})) },
              { label:"Start date",  key:"startDate",  type:"date" },
              { label:"End date",    key:"endDate",    type:"date" },
              { label:"Days",        key:"days",       type:"number", placeholder:"Number of days" },
              { label:"Reason",      key:"reason",     type:"text",   placeholder:"Brief reason (optional)" },
            ].map(f=>(
              <div key={f.key} style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontFamily:T.sans,fontSize:11,color:T.text2,textTransform:"uppercase",letterSpacing:"0.07em"}}>{f.label}</label>
                {f.type==="select"?(
                  <select value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:6,padding:"8px 10px",
                      color:T.text0,fontFamily:T.sans,fontSize:13,outline:"none",cursor:"pointer"}}>
                    {f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ):(
                  <input type={f.type} value={form[f.key]} placeholder={f.placeholder||""}
                    onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:6,padding:"8px 10px",
                      color:T.text0,fontFamily:T.sans,fontSize:13,outline:"none",
                      colorScheme:"dark"}}/>
                )}
              </div>
            ))}
          </div>
          <div style={{marginTop:6}}>
            {form.type&&(
              <div style={{fontFamily:T.sans,fontSize:11,color:T.text2,padding:"6px 0"}}>
                {typeInfo(form.type)?.paid
                  ? "✓ Paid leave — no salary impact"
                  : "⚑ No-Pay Leave — salary will be prorated automatically in payroll run"}
              </div>
            )}
          </div>
          <div style={{marginTop:14,display:"flex",gap:10,justifyContent:"flex-end"}}>
            <GhostBtn onClick={()=>setShowForm(false)}>Cancel</GhostBtn>
            <PrimaryBtn onClick={handlers.submit} color={T.green}>Submit application</PrimaryBtn>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:`0.5px solid ${T.border}`,marginBottom:20}}>
        <div style={{display:"flex"}}>
          {[
            {id:"queue",    label:"Approval queue", count:pending.length, countColor:T.amber},
            {id:"all",      label:"All records",    count:leaveRecords.length},
            {id:"balances", label:"Balances",       count:null},
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"10px 18px",fontFamily:T.mono,fontSize:12,
              background:"transparent",border:"none",cursor:"pointer",
              color:tab===t.id?T.text0:T.text2,
              borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent",
              marginBottom:-1,display:"flex",alignItems:"center",gap:7}}>
              {t.label}
              {t.count>0&&(
                <span style={{background:t.countColor?`${t.countColor}22`:T.bg3,
                  color:t.countColor||T.text2,fontFamily:T.mono,fontSize:9,fontWeight:500,
                  padding:"1px 6px",borderRadius:10,border:`0.5px solid ${t.countColor||T.border}`}}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={()=>setShowForm(s=>!s)}
          style={{fontFamily:T.mono,fontSize:11,color:T.green,background:"transparent",
            border:`0.5px solid ${T.green}`,borderRadius:5,padding:"5px 14px",cursor:"pointer"}}>
          + Apply leave
        </button>
      </div>

      {/* ── Approval queue ── */}
      {tab==="queue"&&(
        pending.length===0
          ? <div style={{textAlign:"center",padding:"48px 0",color:T.text2,fontFamily:T.sans,fontSize:14}}>No leave applications pending ✓</div>
          : <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <TableHead showActions/>
                <tbody>{pending.map(r=><LeaveRow key={r.id} r={r} showActions/>)}</tbody>
              </table>
            </div>
      )}

      {/* ── All records ── */}
      {tab==="all"&&(
        <div style={{border:`0.5px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <TableHead showActions/>
            <tbody>{leaveRecords.map(r=><LeaveRow key={r.id} r={r} showActions/>)}</tbody>
          </table>
        </div>
      )}

      {/* ── Leave balances ── */}
      {tab==="balances"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontFamily:T.sans,fontSize:12,color:T.text2,marginBottom:4}}>
            EA statutory entitlements calculated by years of service as at March 2026.
            Click an employee to expand full balance detail.
          </div>
          {entitlements.map(ent=>{
            const expanded = expandedEmp===ent.employeeId;
            const nplUsed  = ent.npl.used;
            return (
              <div key={ent.employeeId} style={{background:T.bg2,border:`0.5px solid ${T.border}`,
                borderRadius:10,overflow:"hidden"}}>
                {/* Summary row */}
                <div onClick={()=>setExpandedEmp(expanded?null:ent.employeeId)}
                  style={{padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:16}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.bg3}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:T.sans,fontSize:13,fontWeight:500,color:T.text0}}>{ent.name}</div>
                    <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginTop:2}}>
                      {ent.designation} · {ent.yearsOfService.toFixed(1)}y service · joined {ent.joinDate}
                    </div>
                  </div>
                  {/* Quick-view chips */}
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {[
                      {label:"AL",  val:`${ent.annual.total-ent.annual.used}d`, color:T.green},
                      {label:"MC",  val:`${ent.medical.total-ent.medical.used}d`, color:T.blue||T.accent},
                      ...(nplUsed>0?[{label:"NPL",val:`${nplUsed}d`,color:T.amber}]:[]),
                    ].map(c=>(
                      <div key={c.label} style={{background:T.bg3,border:`0.5px solid ${T.border}`,
                        borderRadius:6,padding:"4px 10px",textAlign:"center"}}>
                        <div style={{fontFamily:T.mono,fontSize:9,color:T.text2,letterSpacing:"0.06em"}}>{c.label}</div>
                        <div style={{fontFamily:T.mono,fontSize:13,fontWeight:500,color:c.color}}>{c.val}</div>
                      </div>
                    ))}
                  </div>
                  <span style={{color:T.text2,fontSize:16,marginLeft:4}}>{expanded?"▲":"▼"}</span>
                </div>

                {/* Expanded balance detail */}
                {expanded&&(
                  <div style={{borderTop:`0.5px solid ${T.border}`,padding:"16px 18px",
                    display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
                    {[
                      {key:"annual",    label:"Annual Leave",          hint:`EA: ${alEntitlement(ent.yearsOfService)}d at ${ent.yearsOfService.toFixed(1)}y service`},
                      {key:"medical",   label:"Medical Leave (outpat.)",hint:`EA: ${mcOutpatientEntitlement(ent.yearsOfService)}d at ${ent.yearsOfService.toFixed(1)}y service`},
                      {key:"hosp",      label:"Hospitalisation Leave",  hint:`EA: ${mcHospEntitlement(ent.yearsOfService)}d (includes outpat.)`},
                      {key:"childcare", label:"Childcare Leave",        hint:"CDCA: 6 days/yr (child <7)"},
                      {key:"maternity", label:"Maternity Leave",        hint:"CDCA: 16 weeks govt-paid"},
                      {key:"paternity", label:"Paternity Leave",        hint:"CDCA: 2 weeks govt-paid"},
                    ].map(f=>{
                      const bal = ent[f.key];
                      const ti  = LEAVE_TYPES.find(t=>t.id===f.key);
                      return (
                        <div key={f.key} style={{background:T.bg1,border:`0.5px solid ${T.border}`,
                          borderRadius:8,padding:"12px 14px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                            <Badge color={ti?.color||"gray"}>{ti?.short}</Badge>
                            <span style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>{f.label}</span>
                          </div>
                          <BalBar used={bal.used} pending={bal.pending} total={bal.total} color={ti?.color||"green"}/>
                          <div style={{fontFamily:T.sans,fontSize:10,color:T.text2,marginTop:6}}>{f.hint}</div>
                        </div>
                      );
                    })}
                    {/* NPL */}
                    <div style={{background:ent.npl.used>0?T.amberDim:T.bg1,
                      border:`0.5px solid ${ent.npl.used>0?"rgba(210,153,34,0.3)":T.border}`,
                      borderRadius:8,padding:"12px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                        <Badge color="amber">NPL</Badge>
                        <span style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>No-Pay Leave</span>
                      </div>
                      <div style={{fontFamily:T.mono,fontSize:13,fontWeight:500,color:ent.npl.used>0?T.amber:T.text2}}>
                        {ent.npl.used}d taken{ent.npl.pending>0?` + ${ent.npl.pending}d pending`:""}
                      </div>
                      <div style={{fontFamily:T.sans,fontSize:10,color:T.text2,marginTop:6}}>
                        No cap · Salary prorated automatically
                      </div>
                      {ent.npl.used>0&&(
                        <div style={{fontFamily:T.mono,fontSize:10,color:T.amber,marginTop:4}}>
                          ⚑ {fmt(nplImpact.find(n=>n.employeeId===ent.employeeId)?.salaryDeduction||0)} deducted this month
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [step,    setStep]    = useState("email");
  const [email,   setEmail]   = useState("");
  const [otp,     setOtp]     = useState(["","","","","",""]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const otpRefs = useRef([]);

  const sendOtp = async () => {
    if (!email.includes("@")) { setError("Enter a valid email address."); return; }
    setLoading(true); setError("");
    try {
      await apiPost('/auth/otp/send', { email });
      setStep("otp");
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleOtpInput = (i, e) => {
    const val = e.target.value.replace(/\D/g,"").slice(-1);
    const next = [...otp]; next[i] = val; setOtp(next);
    if (val && i < 5) otpRefs.current[i+1]?.focus();
    if (!val && e.key === "Backspace" && i > 0) otpRefs.current[i-1]?.focus();
  };

  const verifyOtp = async () => {
    const code = otp.join("");
    if (code.length < 6) { setError("Enter the full 6-digit code."); return; }
    setLoading(true); setError("");
    try {
      const { token, user } = await apiPost('/auth/otp/verify', { email, otp: code });
      authStore.set(token, user);
      onLogin(user);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg0, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:24, fontFamily:T.sans }}>
      <div style={{ marginBottom:32, textAlign:"center" }}>
        <div style={{ fontFamily:T.display, fontSize:22, fontWeight:700, color:T.text0, letterSpacing:"-0.02em" }}>PayOps</div>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:3, letterSpacing:"0.1em" }}>OPERATOR CONSOLE</div>
      </div>
      <div style={{ width:"100%", maxWidth:380, background:T.bg1, border:`0.5px solid ${T.border}`,
        borderRadius:12, padding:"32px 28px" }}>
        {step === "email" && (<>
          <div style={{ fontSize:16, fontWeight:600, color:T.text0, marginBottom:5 }}>Sign in</div>
          <div style={{ fontSize:13, color:T.text1, marginBottom:22 }}>Enter your operator email to receive a code.</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:16 }}>
            <label style={{ fontFamily:T.mono, fontSize:10, color:T.text2, letterSpacing:"0.08em" }}>EMAIL</label>
            <input value={email} onChange={e=>{setEmail(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&sendOtp()}
              placeholder="you@example.com" type="email"
              style={{ background:T.bg2, border:`0.5px solid ${T.borderStrong}`, borderRadius:6,
                padding:"9px 12px", color:T.text0, fontFamily:T.sans, fontSize:13, outline:"none" }}/>
          </div>
          {error && <div style={{ fontSize:12, color:T.red, marginBottom:10 }}>{error}</div>}
          <button onClick={sendOtp} disabled={loading}
            style={{ width:"100%", background:T.accent, color:T.bg0, border:"none", borderRadius:6,
              padding:"9px 0", fontFamily:T.mono, fontSize:12, fontWeight:500, cursor:"pointer",
              opacity:loading?0.6:1 }}>{loading ? "Sending…" : "Send code →"}</button>
          <div style={{ marginTop:16, fontSize:11, color:T.text2, textAlign:"center" }}>
            Operator accounts only. Employees use the separate employee portal.
          </div>
        </>)}

        {step === "otp" && (<>
          <div style={{ fontSize:16, fontWeight:600, color:T.text0, marginBottom:5 }}>Check your email</div>
          <div style={{ fontSize:13, color:T.text1, marginBottom:22 }}>
            6-digit code sent to <strong style={{color:T.text0}}>{email}</strong>
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:18 }}>
            {otp.map((d,i) => (
              <input key={i} ref={el=>otpRefs.current[i]=el} value={d}
                onChange={e=>handleOtpInput(i,e)}
                onKeyDown={e=>{if(e.key==="Backspace"&&!d&&i>0)otpRefs.current[i-1]?.focus();}}
                maxLength={1} inputMode="numeric"
                style={{ width:42, height:48, textAlign:"center", fontSize:20, fontFamily:T.mono,
                  background:d?T.accentDim:T.bg2, color:T.text0, border:`1px solid ${d?T.accent:T.borderStrong}`,
                  borderRadius:7, outline:"none", transition:"all .15s" }}/>
            ))}
          </div>
          {error && <div style={{ fontSize:12, color:T.red, marginBottom:10, textAlign:"center" }}>{error}</div>}
          <button onClick={verifyOtp} disabled={loading}
            style={{ width:"100%", background:T.accent, color:T.bg0, border:"none", borderRadius:6,
              padding:"9px 0", fontFamily:T.mono, fontSize:12, fontWeight:500, cursor:"pointer",
              opacity:loading?0.6:1 }}>{loading ? "Verifying…" : "Verify & sign in →"}</button>
          <div style={{ marginTop:12, textAlign:"center" }}>
            <button onClick={()=>setStep("email")} style={{ background:"none", border:"none",
              fontSize:12, color:T.accent, cursor:"pointer", fontFamily:T.sans }}>← Different email</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
// ─── Onboarding: Add Client wizard ────────────────────────────────────────────
function OnboardClientModal({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");

  const [client, setClient] = useState({
    name:"", uen:"", industry:"", contactName:"", contactEmail:"",
    contactPhone:"", payrollDay:28, bankName:"", airwallexAccountId:"",
  });
  const [employees, setEmployees] = useState([{
    id: Date.now(),
    fullName:"", nricMasked:"", dateOfBirth:"", residencyType:"citizen",
    designation:"", department:"", joinDate:"", basicSalary:"", fixedAllowance:"0",
    workEmail:"", bankName:"", portalEnabled:false,
  }]);

  const INDUSTRIES = ["Technology","Finance","Consulting","Logistics","Manufacturing",
    "F&B","Retail","Healthcare","Education","Construction","Media","Other"];
  const RESIDENCY   = [
    {v:"citizen",label:"Singapore Citizen"},
    {v:"pr1",    label:"PR — 1st year"},
    {v:"pr2",    label:"PR — 2nd year"},
    {v:"pr3",    label:"PR — 3rd year+"},
    {v:"ep",     label:"Employment Pass"},
    {v:"spass",  label:"S Pass"},
    {v:"wp",     label:"Work Permit"},
  ];

  const STEPS = ["Client details","Employees","Review & confirm"];

  const Field = ({ label, value, onChange, type="text", placeholder, required, half, opts }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:5,
      gridColumn: half ? "span 1" : "span 2" }}>
      <label style={{ fontFamily:T.sans, fontSize:11, fontWeight:500, color:T.text1,
        textTransform:"uppercase", letterSpacing:"0.07em" }}>
        {label}{required && <span style={{color:T.red}}> *</span>}
      </label>
      {opts ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ background:T.bg2, border:`0.5px solid ${T.borderStrong}`, borderRadius:6,
            padding:"9px 10px", color:T.text0, fontFamily:T.sans, fontSize:13, outline:"none",
            cursor:"pointer" }}>
          {opts.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.label ?? o}</option>)}
        </select>
      ) : (
        <input type={type} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          style={{ background:T.bg2, border:`0.5px solid ${T.borderStrong}`, borderRadius:6,
            padding:"9px 10px", color:T.text0, fontFamily:T.sans, fontSize:13, outline:"none" }}
          onFocus={e => e.target.style.borderColor = T.accent}
          onBlur={e  => e.target.style.borderColor = T.borderStrong}/>
      )}
    </div>
  );

  const fc = (k, v) => setClient(c => ({...c, [k]:v}));
  const fe = (i, k, v) => setEmployees(es => es.map((e,j) => j===i ? {...e,[k]:v} : e));

  const addEmpRow = () => setEmployees(es => [...es, {
    id:Date.now(), fullName:"", nricMasked:"", dateOfBirth:"", residencyType:"citizen",
    designation:"", department:"", joinDate:"", basicSalary:"", fixedAllowance:"0",
    workEmail:"", bankName:"", portalEnabled:false,
  }]);

  const removeEmpRow = i => setEmployees(es => es.filter((_,j) => j!==i));

  const validateStep0 = () => {
    if (!client.name.trim())  { setErr("Client name is required."); return false; }
    if (!client.uen.trim())   { setErr("UEN is required."); return false; }
    if (!/^\d{9}[A-Z]$/.test(client.uen.toUpperCase())) {
      setErr("UEN must be 9 digits followed by a letter (e.g. 202312345A).");
      return false;
    }
    return true;
  };

  const validateStep1 = () => {
    for (let i = 0; i < employees.length; i++) {
      const e = employees[i];
      if (!e.fullName.trim())    { setErr(`Employee ${i+1}: Full name required.`); return false; }
      if (!e.designation.trim()) { setErr(`Employee ${i+1}: Designation required.`); return false; }
      if (!e.joinDate)           { setErr(`Employee ${i+1}: Join date required.`); return false; }
      if (!e.basicSalary || isNaN(parseFloat(e.basicSalary))) {
        setErr(`Employee ${i+1}: Basic salary required (numbers only).`); return false;
      }
    }
    return true;
  };

  const next = () => {
    setErr("");
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    setStep(s => s + 1);
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      // Create client
      const created = await apiPost('/clients', {
        name:               client.name,
        uen:                client.uen.toUpperCase(),
        industry:           client.industry || null,
        contactName:        client.contactName || null,
        contactEmail:       client.contactEmail || null,
        contactPhone:       client.contactPhone || null,
        payrollDay:         parseInt(client.payrollDay),
        bankName:           client.bankName || null,
        airwallexAccountId: client.airwallexAccountId || null,
      });
      const clientId = created.id;

      // Create employees
      for (const emp of employees) {
        if (!emp.fullName.trim()) continue;
        await apiPost(`/clients/${clientId}/employees`, {
          fullName:        emp.fullName,
          nricMasked:      emp.nricMasked || "—",
          dateOfBirth:     emp.dateOfBirth || new Date(Date.now() - 30*365.25*24*3600*1000).toISOString().slice(0,10),
          residencyType:   emp.residencyType,
          designation:     emp.designation,
          department:      emp.department || null,
          joinDate:        emp.joinDate,
          basicSalary:     Math.round(parseFloat(emp.basicSalary) * 100),  // cents
          fixedAllowance:  Math.round(parseFloat(emp.fixedAllowance || "0") * 100),
          workEmail:       emp.workEmail || null,
          bankName:        emp.bankName || null,
          portalEnabled:   emp.portalEnabled,
        });
      }

      onCreated(created);
    } catch (e) {
      // API unavailable — create local mock client so UI still works in dev
      if (e.message.includes('fetch') || e.message.includes('Network') || e.message.includes('HTTP')) {
        const mockClient = {
          id:            `local-${Date.now()}`,
          name:          client.name,
          uen:           client.uen.toUpperCase(),
          industry:      client.industry,
          headcount:     employees.filter(e => e.fullName).length,
          status:        "active",
          nextPayroll:   "31 Mar 2026",
          ytd_cpf:       0,
        };
        onCreated(mockClient);
      } else {
        setErr(e.message);
        setBusy(false);
      }
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:200,
      display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:T.bg1, border:`0.5px solid ${T.border}`, borderRadius:14,
        width:"100%", maxWidth:680, maxHeight:"90vh", overflow:"hidden",
        display:"flex", flexDirection:"column", boxShadow:"0 24px 80px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ padding:"20px 24px", borderBottom:`0.5px solid ${T.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <div style={{ fontFamily:T.display, fontSize:16, fontWeight:700, color:T.text0 }}>
              Onboard new client
            </div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:3 }}>
              Step {step+1} of {STEPS.length} — {STEPS[step]}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:22, lineHeight:1 }}>×</button>
        </div>

        {/* Step progress */}
        <div style={{ display:"flex", padding:"12px 24px", gap:6, borderBottom:`0.5px solid ${T.border}`,
          flexShrink:0 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
              <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                background: i < step ? T.green : i === step ? T.accent : T.bg3,
                border: `0.5px solid ${i < step ? T.green : i === step ? T.accent : T.border}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontFamily:T.mono, fontSize:10, fontWeight:500,
                color: i <= step ? T.bg0 : T.text2 }}>
                {i < step ? "✓" : i+1}
              </div>
              <span style={{ fontFamily:T.sans, fontSize:11,
                color: i === step ? T.text0 : T.text2 }}>{s}</span>
              {i < STEPS.length-1 && (
                <div style={{ flex:1, height:1,
                  background: i < step ? T.green : T.border, marginLeft:4 }}/>
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY:"auto", flex:1, padding:"24px" }}>

          {/* Step 0: Client details */}
          {step === 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <Field label="Company name" value={client.name} onChange={v=>fc("name",v)}
                placeholder="Vertex Solutions Pte Ltd" required/>
              <Field label="UEN" value={client.uen} onChange={v=>fc("uen",v.toUpperCase())}
                placeholder="202312345A" required half/>
              <Field label="Industry" value={client.industry} onChange={v=>fc("industry",v)}
                half opts={["", ...INDUSTRIES]}/>
              <Field label="Payroll date" value={String(client.payrollDay)} onChange={v=>fc("payrollDay",v)}
                half opts={[...Array(28)].map((_,i)=>({v:String(i+1),label:`${i+1}${i===0?"st":i===1?"nd":i===2?"rd":"th"} of month`}))}/>
              <div style={{ gridColumn:"span 2", height:1, background:T.border, margin:"4px 0" }}/>
              <Field label="Contact name" value={client.contactName} onChange={v=>fc("contactName",v)}
                placeholder="Jane Tan" half/>
              <Field label="Contact email" value={client.contactEmail} onChange={v=>fc("contactEmail",v)}
                type="email" placeholder="hr@company.sg" half/>
              <Field label="Contact phone" value={client.contactPhone} onChange={v=>fc("contactPhone",v)}
                placeholder="+65 9123 4567" half/>
              <div style={{ gridColumn:"span 1" }}/>
              <div style={{ gridColumn:"span 2", height:1, background:T.border, margin:"4px 0" }}/>
              <Field label="Bank name" value={client.bankName} onChange={v=>fc("bankName",v)}
                placeholder="DBS / OCBC / UOB" half
                opts={["","DBS","OCBC","UOB","Standard Chartered","HSBC","Citibank","Maybank","Other"]}/>
              <Field label="Airwallex account ID" value={client.airwallexAccountId}
                onChange={v=>fc("airwallexAccountId",v)}
                placeholder="acct_xxxxxx (from Airwallex dashboard)" half/>
            </div>
          )}

          {/* Step 1: Employees */}
          {step === 1 && (
            <div>
              <div style={{ fontFamily:T.sans, fontSize:12, color:T.text2, marginBottom:16 }}>
                Add employees for this client. You can add more later from the employee management page.
              </div>
              {employees.map((emp, i) => (
                <div key={emp.id} style={{ background:T.bg2, border:`0.5px solid ${T.border}`,
                  borderRadius:10, padding:"16px 18px", marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", marginBottom:14 }}>
                    <div style={{ fontFamily:T.sans, fontSize:13, fontWeight:500, color:T.text0 }}>
                      Employee {i+1}{emp.fullName ? ` — ${emp.fullName}` : ""}
                    </div>
                    {employees.length > 1 && (
                      <button onClick={() => removeEmpRow(i)}
                        style={{ background:"none", border:"none", color:T.red,
                          cursor:"pointer", fontSize:18, lineHeight:1, padding:"0 4px" }}>×</button>
                    )}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    {[
                      {label:"Full name",      key:"fullName",      required:true,  placeholder:"Tan Wei Ming"},
                      {label:"Designation",    key:"designation",   required:true,  placeholder:"Software Engineer", half:true},
                      {label:"Department",     key:"department",    placeholder:"Engineering", half:true},
                      {label:"Join date",      key:"joinDate",      required:true,  type:"date", half:true},
                      {label:"Date of birth",  key:"dateOfBirth",   type:"date",    half:true},
                      {label:"NRIC (masked)",  key:"nricMasked",    placeholder:"S****123A", half:true},
                      {label:"Residency",      key:"residencyType", opts:RESIDENCY, half:true},
                      {label:"Basic salary (S$)", key:"basicSalary", required:true, type:"number", placeholder:"5000.00", half:true},
                      {label:"Fixed allowance (S$)", key:"fixedAllowance", type:"number", placeholder:"0.00", half:true},
                      {label:"Work email",     key:"workEmail",     type:"email",   placeholder:"name@company.sg"},
                      {label:"Bank name",      key:"bankName",      half:true,
                        opts:["","DBS","OCBC","UOB","Standard Chartered","HSBC","POSB","Maybank","Other"]},
                    ].map(f => (
                      <div key={f.key} style={{ display:"flex", flexDirection:"column", gap:4,
                        gridColumn: f.half ? "span 1" : "span 2" }}>
                        <label style={{ fontFamily:T.sans, fontSize:10, color:T.text2,
                          textTransform:"uppercase", letterSpacing:"0.07em" }}>
                          {f.label}{f.required && <span style={{color:T.red}}> *</span>}
                        </label>
                        {f.opts ? (
                          <select value={emp[f.key] ?? ""} onChange={e => fe(i, f.key, e.target.value)}
                            style={{ background:T.bg3, border:`0.5px solid ${T.border}`, borderRadius:6,
                              padding:"7px 8px", color:T.text0, fontFamily:T.sans, fontSize:12,
                              outline:"none", cursor:"pointer" }}>
                            {f.opts.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.label ?? o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type ?? "text"} value={emp[f.key] ?? ""}
                            placeholder={f.placeholder} onChange={e => fe(i, f.key, e.target.value)}
                            style={{ background:T.bg3, border:`0.5px solid ${T.border}`, borderRadius:6,
                              padding:"7px 8px", color:T.text0, fontFamily:T.sans, fontSize:12,
                              outline:"none" }}/>
                        )}
                      </div>
                    ))}
                    <div style={{ gridColumn:"span 2", display:"flex", alignItems:"center", gap:8 }}>
                      <input type="checkbox" checked={emp.portalEnabled}
                        onChange={e => fe(i, "portalEnabled", e.target.checked)}
                        style={{ accentColor:T.accent, cursor:"pointer", width:14, height:14 }}/>
                      <span style={{ fontFamily:T.sans, fontSize:12, color:T.text1 }}>
                        Enable employee portal access (login with work email)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addEmpRow}
                style={{ width:"100%", padding:"10px", background:"transparent",
                  border:`0.5px dashed ${T.borderStrong}`, borderRadius:8,
                  color:T.accent, fontFamily:T.mono, fontSize:12, cursor:"pointer" }}>
                + Add another employee
              </button>
            </div>
          )}

          {/* Step 2: Review */}
          {step === 2 && (
            <div>
              {/* Client summary */}
              <div style={{ background:T.bg2, border:`0.5px solid ${T.border}`, borderRadius:10,
                padding:"16px 18px", marginBottom:16 }}>
                <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.text0,
                  marginBottom:12, display:"flex", justifyContent:"space-between" }}>
                  Client
                  <button onClick={() => setStep(0)}
                    style={{ background:"none", border:"none", color:T.accent,
                      fontFamily:T.mono, fontSize:10, cursor:"pointer" }}>Edit</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  {[
                    ["Company", client.name],
                    ["UEN",     client.uen.toUpperCase()],
                    ["Industry",client.industry || "—"],
                    ["Payroll day", `${client.payrollDay}th of month`],
                    ["Contact", client.contactEmail || "—"],
                    ["Airwallex", client.airwallexAccountId || "Not set"],
                  ].map(([k,v]) => (
                    <div key={k} style={{ borderBottom:`0.5px solid ${T.border}`, paddingBottom:8 }}>
                      <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginBottom:3 }}>{k}</div>
                      <div style={{ fontFamily:T.sans, fontSize:13, color:T.text0, fontWeight:500 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Employees summary */}
              <div style={{ background:T.bg2, border:`0.5px solid ${T.border}`, borderRadius:10,
                padding:"16px 18px" }}>
                <div style={{ fontFamily:T.sans, fontSize:12, fontWeight:600, color:T.text0,
                  marginBottom:12, display:"flex", justifyContent:"space-between" }}>
                  Employees ({employees.filter(e=>e.fullName).length})
                  <button onClick={() => setStep(1)}
                    style={{ background:"none", border:"none", color:T.accent,
                      fontFamily:T.mono, fontSize:10, cursor:"pointer" }}>Edit</button>
                </div>
                {employees.filter(e=>e.fullName).map((emp, i) => (
                  <div key={emp.id} style={{ display:"flex", alignItems:"center", gap:12,
                    padding:"10px 0", borderBottom:`0.5px solid ${T.border}` }}>
                    <div style={{ width:32, height:32, borderRadius:"50%", background:T.accentDim,
                      border:`0.5px solid ${T.accent}`, display:"flex", alignItems:"center",
                      justifyContent:"center", fontFamily:T.mono, fontSize:11, color:T.accent, flexShrink:0 }}>
                      {emp.fullName.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:T.sans, fontSize:13, color:T.text0, fontWeight:500 }}>
                        {emp.fullName}
                      </div>
                      <div style={{ fontFamily:T.mono, fontSize:10, color:T.text2, marginTop:2 }}>
                        {emp.designation} · {RESIDENCY.find(r=>r.v===emp.residencyType)?.label} ·
                        S${parseFloat(emp.basicSalary||0).toLocaleString()}/mo
                      </div>
                    </div>
                    {emp.portalEnabled && (
                      <Badge color="green">Portal enabled</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 24px", borderTop:`0.5px solid ${T.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          {err && <div style={{ fontFamily:T.sans, fontSize:12, color:T.red, flex:1 }}>{err}</div>}
          {!err && <div/>}
          <div style={{ display:"flex", gap:10 }}>
            {step > 0 && <GhostBtn onClick={() => { setErr(""); setStep(s=>s-1); }}>← Back</GhostBtn>}
            {step < 2 && <PrimaryBtn onClick={next}>Continue →</PrimaryBtn>}
            {step === 2 && (
              <PrimaryBtn onClick={submit} color={T.green} style={{ opacity:busy?0.6:1 }}>
                {busy ? "Creating…" : "✓ Create client & employees"}
              </PrimaryBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding: Add Employee modal ───────────────────────────────────────────
function AddEmployeeModal({ client, onClose, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");
  const RESIDENCY = [
    {v:"citizen",label:"Singapore Citizen"},{v:"pr1",label:"PR — 1st year"},
    {v:"pr2",label:"PR — 2nd year"},{v:"pr3",label:"PR — 3rd year+"},
    {v:"ep",label:"Employment Pass"},{v:"spass",label:"S Pass"},{v:"wp",label:"Work Permit"},
  ];
  const [form, setForm] = useState({
    fullName:"", nricMasked:"", dateOfBirth:"", residencyType:"citizen",
    designation:"", department:"", joinDate:"", basicSalary:"",
    fixedAllowance:"0", workEmail:"", bankName:"", portalEnabled:false,
  });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  const submit = async () => {
    if (!form.fullName.trim())    { setErr("Full name required."); return; }
    if (!form.designation.trim()) { setErr("Designation required."); return; }
    if (!form.joinDate)           { setErr("Join date required."); return; }
    if (!form.basicSalary || isNaN(parseFloat(form.basicSalary))) {
      setErr("Basic salary required."); return;
    }
    setBusy(true); setErr("");
    try {
      const created = await apiPost(`/clients/${client.id}/employees`, {
        fullName:       form.fullName,
        nricMasked:     form.nricMasked || "—",
        dateOfBirth:    form.dateOfBirth || new Date(Date.now()-30*365.25*24*3600*1000).toISOString().slice(0,10),
        residencyType:  form.residencyType,
        designation:    form.designation,
        department:     form.department || null,
        joinDate:       form.joinDate,
        basicSalary:    Math.round(parseFloat(form.basicSalary) * 100),
        fixedAllowance: Math.round(parseFloat(form.fixedAllowance||"0") * 100),
        workEmail:      form.workEmail || null,
        bankName:       form.bankName || null,
        portalEnabled:  form.portalEnabled,
      });
      onCreated(created);
    } catch(e) {
      if (e.message.includes('fetch') || e.message.includes('Network')) {
        // Dev fallback
        onCreated({ id:`local-${Date.now()}`, ...form,
          basic_salary: Math.round(parseFloat(form.basicSalary)*100),
          full_name: form.fullName, residency_type: form.residencyType });
      } else {
        setErr(e.message); setBusy(false);
      }
    }
  };

  const Row = ({label,k,type="text",placeholder,opts,half,required}) => (
    <div style={{display:"flex",flexDirection:"column",gap:5,
      gridColumn:half?"span 1":"span 2"}}>
      <label style={{fontFamily:T.sans,fontSize:10,color:T.text2,
        textTransform:"uppercase",letterSpacing:"0.07em"}}>
        {label}{required&&<span style={{color:T.red}}> *</span>}
      </label>
      {opts ? (
        <select value={form[k]} onChange={e=>f(k,e.target.value)}
          style={{background:T.bg2,border:`0.5px solid ${T.borderStrong}`,borderRadius:6,
            padding:"8px 10px",color:T.text0,fontFamily:T.sans,fontSize:13,outline:"none",cursor:"pointer"}}>
          {opts.map(o=><option key={o.v??o} value={o.v??o}>{o.label??o}</option>)}
        </select>
      ):(
        <input type={type} value={form[k]} placeholder={placeholder}
          onChange={e=>f(k,e.target.value)}
          style={{background:T.bg2,border:`0.5px solid ${T.borderStrong}`,borderRadius:6,
            padding:"8px 10px",color:T.text0,fontFamily:T.sans,fontSize:13,outline:"none"}}
          onFocus={e=>e.target.style.borderColor=T.accent}
          onBlur={e=>e.target.style.borderColor=T.borderStrong}/>
      )}
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:T.bg1,border:`0.5px solid ${T.border}`,borderRadius:14,
        width:"100%",maxWidth:580,maxHeight:"90vh",overflow:"hidden",
        display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,0.6)"}}>

        <div style={{padding:"20px 24px",borderBottom:`0.5px solid ${T.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontFamily:T.display,fontSize:16,fontWeight:700,color:T.text0}}>
              Add employee
            </div>
            <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginTop:3}}>
              {client.name}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:"none",border:"none",color:T.text2,cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
        </div>

        <div style={{overflowY:"auto",flex:1,padding:24}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Row label="Full name"         k="fullName"      required placeholder="Tan Wei Ming"/>
            <Row label="Designation"       k="designation"   required placeholder="Software Engineer" half/>
            <Row label="Department"        k="department"    placeholder="Engineering" half/>
            <Row label="Join date"         k="joinDate"      required type="date" half/>
            <Row label="Date of birth"     k="dateOfBirth"   type="date" half/>
            <Row label="NRIC (masked)"     k="nricMasked"    placeholder="S****123A" half/>
            <Row label="Residency"         k="residencyType" opts={RESIDENCY} half/>
            <Row label="Basic salary (S$)" k="basicSalary"   required type="number" placeholder="5000.00" half/>
            <Row label="Fixed allowance"   k="fixedAllowance" type="number" placeholder="0.00" half/>
            <Row label="Work email"        k="workEmail"     type="email" placeholder="name@company.sg"/>
            <Row label="Bank name"         k="bankName" half
              opts={["","DBS","OCBC","UOB","Standard Chartered","HSBC","POSB","Maybank","Other"]}/>
            <div style={{gridColumn:"span 2",display:"flex",alignItems:"center",gap:8,marginTop:4}}>
              <input type="checkbox" checked={form.portalEnabled}
                onChange={e=>f("portalEnabled",e.target.checked)}
                style={{accentColor:T.accent,cursor:"pointer",width:14,height:14}}/>
              <span style={{fontFamily:T.sans,fontSize:12,color:T.text1}}>
                Enable employee portal access
              </span>
            </div>
          </div>
        </div>

        <div style={{padding:"14px 24px",borderTop:`0.5px solid ${T.border}`,
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          {err
            ? <div style={{fontFamily:T.sans,fontSize:12,color:T.red}}>{err}</div>
            : <div style={{fontFamily:T.sans,fontSize:11,color:T.text2}}>
                Basic salary in S$ · stored as integer cents internally
              </div>}
          <div style={{display:"flex",gap:10}}>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={submit} style={{opacity:busy?0.6:1}}>
              {busy ? "Adding…" : "Add employee"}
            </PrimaryBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { id:"dashboard", label:"Dashboard",            icon:"⊞" },
  { id:"payroll",   label:"Payroll runs",          icon:"◈" },
  { id:"payments",  label:"Payment instructions",  icon:"◎" },
  { id:"cpf",       label:"CPF / SDL",             icon:"◉" },
  { id:"leave",     label:"Leave",                 icon:"◧" },
  { id:"claims",    label:"Claims",                icon:"◫" },
  { id:"reports",   label:"Reports & IR8A",       icon:"◪" },
];

export default function App() {
  const [view,setView]                   = useState("dashboard");
  const [user,setUser]                   = useState(() => authStore.getUser());
  const [showOnboard, setShowOnboard]    = useState(false);

  // ── Real data from API ─────────────────────────────────────────────────────
  const { data: clientsData, loading: clientsLoading, error: clientsError, refetch: refetchClients }
    = useFetch(() => user ? apiGet('/clients') : null, [user]);

  const clients = clientsData ?? [];
  const [activeClient, setActiveClient]  = useState(null);

  // Set first client once loaded
  useEffect(() => {
    if (clients.length && !activeClient) setActiveClient(clients[0]);
  }, [clients]);

  const cid = activeClient?.id;

  const { data: claimsData, loading: claimsLoading, refetch: refetchClaims }
    = useFetch(() => cid ? apiGet(`/clients/${cid}/claims`) : null, [cid]);
  const claims    = claimsData    ?? [];
  const setClaims = useCallback(() => refetchClaims(), [refetchClaims]);

  const { data: leaveData, loading: leaveLoading, refetch: refetchLeave }
    = useFetch(() => cid ? apiGet(`/clients/${cid}/leave`) : null, [cid]);
  const leaveRecords    = leaveData ?? [];
  const setLeaveRecords = useCallback(() => refetchLeave(), [refetchLeave]);

  // Session expiry
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('payops:session-expired', onExpired);
    return () => window.removeEventListener('payops:session-expired', onExpired);
  }, []);

  const logout = () => { authStore.clear(); setUser(null); };

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) return <LoginScreen onLogin={u => setUser(u)} />;

  const handleClientCreated = (newClient) => {
    setShowOnboard(false);
    refetchClients();
    setActiveClient(newClient);
    setView("payroll");
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  const Spinner = () => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:T.text2, fontFamily:T.mono, fontSize:12 }}>
      Loading…
    </div>
  );
  const ErrBox = ({msg}) => (
    <div style={{ padding:20, color:T.red, background:T.redDim, borderRadius:8,
      border:`0.5px solid ${T.red}`, fontFamily:T.sans, fontSize:13 }}>
      {msg} &nbsp;<button onClick={refetchClients}
        style={{ background:"none", border:"none", color:T.accent, cursor:"pointer", fontSize:12 }}>
        Retry
      </button>
    </div>
  );

  return (
    <div style={{display:"flex",minHeight:"100vh",background:T.bg0,fontFamily:T.sans,color:T.text0}}>
      <aside style={{width:228,flexShrink:0,background:T.bg1,borderRight:`0.5px solid ${T.border}`,
        display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh"}}>

        <div style={{padding:"20px 20px 16px",borderBottom:`0.5px solid ${T.border}`}}>
          <div style={{fontFamily:T.display,fontSize:17,fontWeight:700,color:T.text0,letterSpacing:"-0.02em"}}>PayOps</div>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginTop:2,letterSpacing:"0.08em"}}>OPERATOR CONSOLE</div>
        </div>

        <div style={{padding:"12px 16px",borderBottom:`0.5px solid ${T.border}`}}>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2,marginBottom:6,letterSpacing:"0.08em"}}>ACTIVE CLIENT</div>
          {clientsLoading
            ? <div style={{fontFamily:T.mono,fontSize:11,color:T.text2}}>Loading…</div>
            : <select value={activeClient?.id ?? ''}
                onChange={e=>setActiveClient(clients.find(c=>c.id===e.target.value))}
                style={{width:"100%",background:T.bg2,color:T.text0,border:`0.5px solid ${T.border}`,
                  borderRadius:5,padding:"6px 8px",fontFamily:T.sans,fontSize:12,cursor:"pointer"}}>
                {clients.map(c=>(
                  <option key={c.id} value={c.id}>{c.name.length>28?c.name.substring(0,26)+"…":c.name}</option>
                ))}
              </select>
          }
        </div>

        <nav style={{flex:1,padding:"8px 8px"}}>
              {NAV.map(n=>{
                const badge = n.id==="claims" ? claims.filter(c=>c.status==="pending").length
                           : n.id==="leave"   ? leaveRecords.filter(r=>r.status==="pending").length
                           : 0;
                return (
                <button key={n.id} disabled={n.soon} onClick={()=>!n.soon&&setView(n.id)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    width:"100%",padding:"8px 12px",marginBottom:2,
                    background:view===n.id?T.bg3:"transparent",
                    border:"none",borderRadius:6,
                    color:n.soon?T.text2:(view===n.id?T.text0:T.text1),
                    fontFamily:T.sans,fontSize:13,
                    cursor:n.soon?"default":"pointer",
                    textAlign:"left",transition:"background 0.1s",
                    borderLeft:view===n.id?`2px solid ${T.accent}`:"2px solid transparent"}}
                  onMouseEnter={e=>{if(!n.soon&&view!==n.id)e.currentTarget.style.background=T.bg2;}}
                  onMouseLeave={e=>{if(view!==n.id)e.currentTarget.style.background="transparent";}}>
                  <span style={{display:"flex",alignItems:"center",gap:9}}>
                    <span style={{fontSize:14,opacity:n.soon?0.4:1}}>{n.icon}</span>
                    {n.label}
                  </span>
                  {n.soon && <span style={{fontFamily:T.mono,fontSize:9,color:T.text2,letterSpacing:"0.06em"}}>SOON</span>}
                  {badge>0 && <span style={{background:T.amberDim,color:T.amber,fontFamily:T.mono,
                    fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:10,
                    border:`0.5px solid ${T.amber}`}}>{badge}</span>}
                </button>
                );
              })}
        </nav>

        <div style={{padding:"12px 16px",borderTop:`0.5px solid ${T.border}`}}>
          <div style={{fontFamily:T.mono,fontSize:10,color:T.text2}}>{user.name} · {user.role}</div>
          <button onClick={logout}
            style={{marginTop:6,fontFamily:T.mono,fontSize:10,color:T.red,background:"none",
              border:"none",cursor:"pointer",padding:0}}>Sign out</button>
        </div>
      </aside>

      <main style={{flex:1,padding:"32px 36px",overflowY:"auto",minWidth:0}}>
        {showOnboard && (
          <OnboardClientModal
            onClose={() => setShowOnboard(false)}
            onCreated={handleClientCreated}
          />
        )}
        {clientsError && <ErrBox msg={clientsError}/>}
        {clientsLoading && !activeClient && <Spinner/>}
        {activeClient && (<>
          {view==="dashboard" && <Dashboard setView={setView} setActiveClient={setActiveClient}
              clients={clients} clientsLoading={clientsLoading}
              onAddClient={() => setShowOnboard(true)}/>}
          {view==="payroll"   && <PayrollRun client={activeClient}/>}
          {view==="payments"  && <PaymentInstructions client={activeClient}/>}
          {view==="cpf"       && <CPFView client={activeClient}/>}
          {view==="claims"    && <ClaimsPage client={activeClient}
              claims={claims} setClaims={async (updater) => {
                if (typeof updater === 'function') {
                  // optimistic update not needed — just refetch
                }
                await refetchClaims();
              }}/>}
          {view==="leave"     && <LeavePage client={activeClient}
              leaveRecords={leaveRecords} setLeaveRecords={async () => await refetchLeave()}/>}
          {view==="reports"   && <ReportsPage client={activeClient}/>}
        </>)}
      </main>
    </div>
  );
}

