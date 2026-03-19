// api.js — PayOps API client
// Drop this file next to your React app entry point.
// All monetary values from the API are INTEGER CENTS — divide by 100 to display.
//
// Usage:
//   import api from './api';
//   const clients = await api.clients.list();

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ?? window.__PAYOPS_API_URL__
  ?? 'http://localhost:4000/api';

// ─── Token storage ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'payops_token';
const USER_KEY  = 'payops_user';

export const auth = {
  getToken: ()  => sessionStorage.getItem(TOKEN_KEY),
  getUser:  ()  => { try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; } },
  setToken: (t, u) => { sessionStorage.setItem(TOKEN_KEY, t); sessionStorage.setItem(USER_KEY, JSON.stringify(u)); },
  clear:    ()  => { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); },
  isLoggedIn: () => !!sessionStorage.getItem(TOKEN_KEY),
};

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function req(method, path, body, opts = {}) {
  const token = auth.getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  // 401 = session expired — clear and reload
  if (res.status === 401) {
    auth.clear();
    window.dispatchEvent(new Event('payops:session-expired'));
    throw new ApiError('Session expired. Please sign in again.', 401);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
      data.issues
    );
  }
  return data;
}

const get    = (path, opts)     => req('GET',    path, null, opts);
const post   = (path, body)     => req('POST',   path, body);
const patch  = (path, body)     => req('PATCH',  path, body);
const del    = (path)           => req('DELETE', path);

// ─── Error class ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(message, status, issues) {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.issues = issues; // Zod validation issues
  }
}

// ─── Money helpers (cents ↔ display) ─────────────────────────────────────────
export const cents = {
  toSGD:   (c) => (c / 100).toFixed(2),
  display: (c) => `S$${(c / 100).toLocaleString('en-SG', { minimumFractionDigits:2 })}`,
  fromSGD: (n) => Math.round(parseFloat(n) * 100),
};

// ─── API methods ──────────────────────────────────────────────────────────────

// Authentication
const authApi = {
  sendOtp:   (email)      => post('/auth/otp/send',   { email }),
  verifyOtp: (email, otp) => post('/auth/otp/verify', { email, otp }),
};

// Clients
const clientsApi = {
  list:   ()           => get('/clients'),
  get:    (id)         => get(`/clients/${id}`),
  create: (data)       => post('/clients', data),
  update: (id, data)   => patch(`/clients/${id}`, data),
};

// Employees
const employeesApi = {
  list:   (clientId, status = 'active') => get(`/clients/${clientId}/employees?status=${status}`),
  get:    (clientId, empId)             => get(`/clients/${clientId}/employees/${empId}`),
  create: (clientId, data)              => post(`/clients/${clientId}/employees`, data),
  update: (clientId, empId, data)       => patch(`/clients/${clientId}/employees/${empId}`, data),
};

// Payroll
const payrollApi = {
  listPeriods:    (clientId)                 => get(`/clients/${clientId}/payroll`),
  createPeriod:   (clientId, data)           => post(`/clients/${clientId}/payroll`, data),
  computePeriod:  (clientId, periodId)       => post(`/clients/${clientId}/payroll/${periodId}/compute`),
  approvePeriod:  (clientId, periodId)       => post(`/clients/${clientId}/payroll/${periodId}/approve`),
  getLines:       (clientId, periodId)       => get(`/clients/${clientId}/payroll/${periodId}/lines`),
  generatePI:     (clientId, periodId)       => post(`/clients/${clientId}/payroll/${periodId}/generate-pi`),
};

// Payment Instructions
const piApi = {
  list:     (clientId) => get(`/clients/${clientId}/payment-instructions`),
  markPaid: (piId)     => post(`/payment-instructions/${piId}/mark-paid`),
};

// Leave
const leaveApi = {
  list:      (clientId, status)     => get(`/clients/${clientId}/leave${status ? `?status=${status}` : ''}`),
  submit:    (clientId, data)       => post(`/clients/${clientId}/leave`, data),
  approve:   (clientId, leaveId)   => post(`/clients/${clientId}/leave/${leaveId}/approve`),
  reject:    (clientId, leaveId, reason) => post(`/clients/${clientId}/leave/${leaveId}/reject`, { reason }),
  balances:  (clientId, employeeId) => get(`/clients/${clientId}/leave/balances/${employeeId}`),
};

// Claims
const claimsApi = {
  list:          (clientId, status)          => get(`/clients/${clientId}/claims${status ? `?status=${status}` : ''}`),
  submit:        (clientId, data)            => post(`/clients/${clientId}/claims`, data),
  approve:       (clientId, claimId)        => post(`/clients/${clientId}/claims/${claimId}/approve`),
  reject:        (clientId, claimId, reason) => post(`/clients/${clientId}/claims/${claimId}/reject`, { reason }),
  lockToPayroll: (clientId, claimIds, payrollPeriodId) =>
    post(`/clients/${clientId}/claims/lock-to-payroll`, { claimIds, payrollPeriodId }),
};

// Employee self-service (portal)
const meApi = {
  get:      ()  => get('/me'),
  payslips: ()  => get('/me/payslips'),
  leave:    (clientId) => leaveApi.list(clientId),
  claims:   (clientId) => claimsApi.list(clientId),
};

// Audit
const auditApi = {
  list: (clientId, limit = 100) => get(`/clients/${clientId}/audit-log?limit=${limit}`),
};

const api = {
  auth:      authApi,
  clients:   clientsApi,
  employees: employeesApi,
  payroll:   payrollApi,
  pi:        piApi,
  leave:     leaveApi,
  claims:    claimsApi,
  me:        meApi,
  audit:     auditApi,
};

export default api;
