import { useCallback, useEffect, useState } from 'react';
import type { AccountView } from '@team-manager/shared';
import { Alert } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { apiClient, ApiError, clearToken, getToken, setToken } from '../api.js';
import { Login } from '../Login.js';
import { ParentRoutes } from '../features/parents/ParentRoutes.js';
import { PublicSeatPage } from '../features/public-seat/PublicSeatPage.js';
import { SubaccountRoutes } from '../features/subaccounts/SubaccountRoutes.js';
import { AppShell } from './AppShell.js';

export function AppRoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');

  const handleError = useCallback((errorValue: unknown) => {
    const message = (errorValue as Error).message;
    setError(message);
    if (errorValue instanceof ApiError && errorValue.status === 401) {
      setAuthed(false);
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const mergeAccount = useCallback((updated: AccountView) => {
    setAccounts((current) => {
      const exists = current.some((account) => account.id === updated.id);
      const next = exists
        ? current.map((account) => (account.id === updated.id ? updated : account))
        : [updated, ...current];
      return next;
    });
  }, []);

  const removeAccount = useCallback((id: string) => {
    setAccounts((current) => current.filter((account) => account.id !== id));
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError('');
    try {
      setAccounts(await apiClient.listAccounts());
    } catch (loadError) {
      handleError(loadError);
    } finally {
      setLoadingAccounts(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (authed) void loadAccounts();
  }, [authed, loadAccounts]);

  const refreshAccount = useCallback(
    async (account: AccountView) => {
      setSyncingIds((current) => new Set(current).add(account.id));
      setError('');
      try {
        mergeAccount(await apiClient.refreshAccount(account.id));
      } catch (refreshError) {
        handleError(refreshError);
      } finally {
        setSyncingIds((current) => {
          const next = new Set(current);
          next.delete(account.id);
          return next;
        });
      }
    },
    [handleError, mergeAccount]
  );

  const logout = () => {
    clearToken();
    setAuthed(false);
    setAccounts([]);
    navigate('/login', { replace: true });
  };

  const login = async (username: string, password: string) => {
    const { token } = await apiClient.login(username, password);
    setToken(token);
    setAuthed(true);
    navigate('/parents', { replace: true });
  };

  if (location.pathname.startsWith('/seat/')) {
    return (
      <Routes>
        <Route path="/seat/:seatKey" element={<PublicSeatPage />} />
        <Route path="*" element={<Navigate to={location.pathname} replace />} />
      </Routes>
    );
  }

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={login} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell onLogout={logout}>
      {error && <Alert className="global-alert" type="error" showIcon message={error} closable onClose={() => setError('')} />}
      <Routes>
        <Route
          path="/parents/:accountId?"
          element={
            <ParentRoutes
              accounts={accounts}
              loading={loadingAccounts}
              globalError={error}
              syncingIds={syncingIds}
              onAccountChanged={mergeAccount}
              onAccountRemoved={removeAccount}
              onRefreshAccount={(account) => void refreshAccount(account)}
              onError={handleError}
            />
          }
        />
        <Route
          path="/subaccounts/:subaccountId?"
          element={<SubaccountRoutes accounts={accounts} onError={handleError} />}
        />
        <Route path="/login" element={<Navigate to="/parents" replace />} />
        <Route path="*" element={<Navigate to="/parents" replace />} />
      </Routes>
    </AppShell>
  );
}
