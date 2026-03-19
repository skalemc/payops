// hooks.js — React data hooks for PayOps
// Each hook returns { data, loading, error, refetch } plus mutation helpers.
// All hooks call the real API; swap out api.js BASE_URL for local dev.

import { useState, useEffect, useCallback, useRef } from 'react';
import api, { auth, ApiError } from './api.js';

// ─── Base fetch hook ──────────────────────────────────────────────────────────
export function useFetch(fetchFn, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const abortRef = useRef(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(abortRef.current.signal);
      setData(result);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); return () => abortRef.current?.abort(); }, [run]);
  return { data, loading, error, refetch: run, setData };
}

// ─── Mutation hook ────────────────────────────────────────────────────────────
export function useMutation(mutFn) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutFn(...args);
      return result;
    } catch (err) {
      const msg = err.message ?? 'Something went wrong';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutFn]);

  return { mutate, loading, error, clearError: () => setError(null) };
}

// ─── Auth hooks ───────────────────────────────────────────────────────────────
export function useAuth() {
  const [user,       setUser]       = useState(() => auth.getUser());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState('');

  useEffect(() => {
    const onExpired = () => { setUser(null); };
    window.addEventListener('payops:session-expired', onExpired);
    return () => window.removeEventListener('payops:session-expired', onExpired);
  }, []);

  const sendOtp = async (email) => {
    setAuthLoading(true); setAuthError('');
    try {
      return await api.auth.sendOtp(email);
    } catch (err) {
      setAuthError(err.message);
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const verifyOtp = async (email, otp) => {
    setAuthLoading(true); setAuthError('');
    try {
      const { token, user: userData } = await api.auth.verifyOtp(email, otp);
      auth.setToken(token, userData);
      setUser(userData);
      return userData;
    } catch (err) {
      setAuthError(err.message);
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => { auth.clear(); setUser(null); };

  return { user, isLoggedIn: !!user, authLoading, authError, sendOtp, verifyOtp, logout };
}

// ─── Dashboard overview hook ──────────────────────────────────────────────────
export function useDashboard(operatorId) {
  return useFetch(() => api.clients.list(), [operatorId]);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
export function useClients() {
  const fetch = useFetch(() => api.clients.list(), []);
  const create = useMutation((data) => api.clients.create(data));
  const update = useMutation((id, data) => api.clients.update(id, data));
  return { ...fetch, create, update };
}

// ─── Employees ────────────────────────────────────────────────────────────────
export function useEmployees(clientId) {
  const fetch = useFetch(() => clientId ? api.employees.list(clientId) : null, [clientId]);
  const create = useMutation((data) => api.employees.create(clientId, data));
  const update = useMutation((empId, data) => api.employees.update(clientId, empId, data));
  return { ...fetch, create, update };
}

// ─── Payroll ──────────────────────────────────────────────────────────────────
export function usePayroll(clientId) {
  const fetch      = useFetch(() => clientId ? api.payroll.listPeriods(clientId) : null, [clientId]);
  const compute    = useMutation((periodId) => api.payroll.computePeriod(clientId, periodId));
  const approve    = useMutation((periodId) => api.payroll.approvePeriod(clientId, periodId));
  const createPeriod = useMutation((data)   => api.payroll.createPeriod(clientId, data));
  const generatePI = useMutation((periodId) => api.payroll.generatePI(clientId, periodId));

  const computeAndRefetch = async (periodId) => {
    const result = await compute.mutate(periodId);
    await fetch.refetch();
    return result;
  };
  const approveAndRefetch = async (periodId) => {
    const result = await approve.mutate(periodId);
    await fetch.refetch();
    return result;
  };

  return { ...fetch, compute: computeAndRefetch, approve: approveAndRefetch,
           createPeriod, generatePI, computeLoading: compute.loading,
           approveLoading: approve.loading };
}

export function usePayrollLines(clientId, periodId) {
  return useFetch(
    () => clientId && periodId ? api.payroll.getLines(clientId, periodId) : null,
    [clientId, periodId]
  );
}

// ─── Payment Instructions ─────────────────────────────────────────────────────
export function usePaymentInstructions(clientId) {
  const fetch   = useFetch(() => clientId ? api.pi.list(clientId) : null, [clientId]);
  const markPaid = useMutation(async (piId) => {
    const r = await api.pi.markPaid(piId);
    await fetch.refetch();
    return r;
  });
  return { ...fetch, markPaid };
}

// ─── Leave ────────────────────────────────────────────────────────────────────
export function useLeave(clientId, statusFilter) {
  const fetch = useFetch(
    () => clientId ? api.leave.list(clientId, statusFilter) : null,
    [clientId, statusFilter]
  );

  const submit = useMutation(async (data) => {
    const r = await api.leave.submit(clientId, data);
    await fetch.refetch();
    return r;
  });
  const approve = useMutation(async (leaveId) => {
    const r = await api.leave.approve(clientId, leaveId);
    await fetch.refetch();
    return r;
  });
  const reject = useMutation(async (leaveId, reason) => {
    const r = await api.leave.reject(clientId, leaveId, reason);
    await fetch.refetch();
    return r;
  });

  return { ...fetch, submit, approve, reject };
}

export function useLeaveBalances(clientId, employeeId) {
  return useFetch(
    () => clientId && employeeId ? api.leave.balances(clientId, employeeId) : null,
    [clientId, employeeId]
  );
}

// ─── Claims ───────────────────────────────────────────────────────────────────
export function useClaims(clientId, statusFilter) {
  const fetch = useFetch(
    () => clientId ? api.claims.list(clientId, statusFilter) : null,
    [clientId, statusFilter]
  );

  const submit = useMutation(async (data) => {
    const r = await api.claims.submit(clientId, data);
    await fetch.refetch();
    return r;
  });
  const approve = useMutation(async (claimId) => {
    const r = await api.claims.approve(clientId, claimId);
    await fetch.refetch();
    return r;
  });
  const reject = useMutation(async (claimId, reason) => {
    const r = await api.claims.reject(clientId, claimId, reason);
    await fetch.refetch();
    return r;
  });
  const lockToPayroll = useMutation(async (claimIds, payrollPeriodId) => {
    const r = await api.claims.lockToPayroll(clientId, claimIds, payrollPeriodId);
    await fetch.refetch();
    return r;
  });

  return { ...fetch, submit, approve, reject, lockToPayroll };
}

// ─── Employee self-service hooks ──────────────────────────────────────────────
export function useMe() {
  return useFetch(() => api.me.get(), []);
}

export function useMyPayslips() {
  return useFetch(() => api.me.payslips(), []);
}

export function useMyLeave(clientId) {
  const fetch = useFetch(
    () => clientId ? api.leave.list(clientId) : null,
    [clientId]
  );
  const submit = useMutation(async (data) => {
    const r = await api.leave.submit(clientId, data);
    await fetch.refetch();
    return r;
  });
  return { ...fetch, submit };
}

export function useMyClaims(clientId) {
  const fetch = useFetch(
    () => clientId ? api.claims.list(clientId) : null,
    [clientId]
  );
  const submit = useMutation(async (data) => {
    const r = await api.claims.submit(clientId, data);
    await fetch.refetch();
    return r;
  });
  return { ...fetch, submit };
}

// ─── Audit log ────────────────────────────────────────────────────────────────
export function useAuditLog(clientId) {
  return useFetch(() => clientId ? api.audit.list(clientId) : null, [clientId]);
}
