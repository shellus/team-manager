import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountSummaryFromView, type AccountSummaryView, type AccountView } from '@team-manager/shared';
import { Alert, Skeleton } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { apiClient, ApiError, clearToken, getToken, setToken } from '../api.js';
import { useActionBusy } from '../components/useActionBusy.js';
import { accountRefreshActionKey, syncingAccountIdsFromBusy } from './accountRefreshBusy.js';
import { AppShell } from './AppShell.js';
import { PageErrorBoundary } from '../components/PageErrorBoundary.js';
import { routeNeedsAccountSummaries } from './accountSummaryRoute.js';

const Login = lazy(async () => ({ default: (await import('../Login.js')).Login }));
const ParentRoutes = lazy(async () => ({ default: (await import('../features/parents/ParentRoutes.js')).ParentRoutes }));
const PublicSeatPage = lazy(async () => ({ default: (await import('../features/public-seat/PublicSeatPage.js')).PublicSeatPage }));
const OverviewPage = lazy(async () => ({ default: (await import('../features/overview/OverviewPage.js')).OverviewPage }));
const ParentOverviewPage = lazy(async () => ({ default: (await import('../features/overview/ParentOverviewPage.js')).ParentOverviewPage }));
const SubaccountRoutes = lazy(async () => ({ default: (await import('../features/subaccounts/SubaccountRoutes.js')).SubaccountRoutes }));
const TeamOrdersPage = lazy(async () => ({ default: (await import('../features/team-orders/TeamOrdersPage.js')).TeamOrdersPage }));

function RouteFallback() {
  return <Skeleton active paragraph={{ rows: 8 }} />;
}

export function AppRoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [accounts, setAccounts] = useState<AccountSummaryView[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const removedAccountIds = useRef(new Set<string>());
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [error, setError] = useState('');
  const accountRefreshBusy = useActionBusy();
  const syncingIds = useMemo(
    () => syncingAccountIdsFromBusy(accounts, accountRefreshBusy.busyState),
    [accounts, accountRefreshBusy.busyState]
  );
  const needsAccountSummaries = routeNeedsAccountSummaries(location.pathname);

  const handleError = useCallback((errorValue: unknown) => {
    const message = (errorValue as Error).message;
    setError(message);
    if (errorValue instanceof ApiError && errorValue.status === 401) {
      setAuthed(false);
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const mergeAccountSummary = useCallback((updated: AccountSummaryView) => {
    setAccounts((current) => {
      if (removedAccountIds.current.has(updated.id)) return current;
      const exists = current.some((account) => account.id === updated.id);
      const next = exists
        ? current.map((account) => (account.id === updated.id ? updated : account))
        : [updated, ...current];
      return next;
    });
  }, []);

  const mergeAccount = useCallback((updated: AccountView) => {
    mergeAccountSummary(accountSummaryFromView(updated));
  }, [mergeAccountSummary]);

  const removeAccount = useCallback((id: string) => {
    removedAccountIds.current.add(id);
    setAccounts((current) => current.filter((account) => account.id !== id));
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError('');
    try {
      const loaded = await apiClient.listAccounts();
      setAccounts(loaded.filter((account) => !removedAccountIds.current.has(account.id)));
      setAccountsLoaded(true);
    } catch (loadError) {
      handleError(loadError);
    } finally {
      setLoadingAccounts(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (authed && needsAccountSummaries && !accountsLoaded) void loadAccounts();
  }, [accountsLoaded, authed, loadAccounts, needsAccountSummaries]);

  const refreshAccount = useCallback(
    async (account: AccountSummaryView): Promise<AccountView | undefined> => {
      setError('');
      try {
        let updated: AccountView | undefined;
        await accountRefreshBusy.run(accountRefreshActionKey(account.id), async () => {
          updated = await apiClient.refreshAccount(account.id);
          mergeAccount(updated);
        });
        return updated;
      } catch (refreshError) {
        handleError(refreshError);
        return undefined;
      }
    },
    [accountRefreshBusy.run, handleError, mergeAccount]
  );

  const logout = () => {
    clearToken();
    setAuthed(false);
    setAccounts([]);
    setAccountsLoaded(false);
    navigate('/login', { replace: true });
  };

  const login = async (username: string, password: string) => {
    const { token } = await apiClient.login(username, password);
    setToken(token);
    setAuthed(true);
    setAccountsLoaded(false);
    navigate('/parents', { replace: true });
  };

  if (location.pathname.startsWith('/seat/')) {
    return (
      <PageErrorBoundary resetKey={`${location.pathname}${location.search}`}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/seat/:seatKey" element={<PublicSeatPage />} />
            <Route path="*" element={<Navigate to={location.pathname} replace />} />
          </Routes>
        </Suspense>
      </PageErrorBoundary>
    );
  }

  if (!authed) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login onLogin={login} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <AppShell onLogout={logout}>
      {error && <Alert className="global-alert" type="error" showIcon message={error} closable onClose={() => setError('')} />}
      <PageErrorBoundary resetKey={`${location.pathname}${location.search}`}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/parent-overview" element={<ParentOverviewPage />} />
          <Route path="/team-orders" element={<TeamOrdersPage onError={handleError} />} />
          <Route
            path="/parents/registrations/:registrationOperationId"
            element={
              <ParentRoutes
                accounts={accounts}
                loading={loadingAccounts}
                globalError={error}
                syncingIds={syncingIds}
                onAccountChanged={mergeAccount}
                onAccountSummaryChanged={mergeAccountSummary}
                onAccountRemoved={removeAccount}
                onRefreshAccount={refreshAccount}
                onError={handleError}
              />
            }
          />
          <Route
            path="/parents/:accountId?"
            element={
              <ParentRoutes
                accounts={accounts}
                loading={loadingAccounts}
                globalError={error}
                syncingIds={syncingIds}
                onAccountChanged={mergeAccount}
                onAccountSummaryChanged={mergeAccountSummary}
                onAccountRemoved={removeAccount}
                onRefreshAccount={refreshAccount}
                onError={handleError}
              />
            }
          />
          <Route
            path="/subaccounts/registrations/:registrationJobId"
            element={<SubaccountRoutes accounts={accounts} onError={handleError} />}
          />
          <Route
            path="/subaccounts/:subaccountId?"
            element={<SubaccountRoutes accounts={accounts} onError={handleError} />}
          />
          <Route path="/login" element={<Navigate to="/parents" replace />} />
          <Route path="*" element={<Navigate to="/parents" replace />} />
          </Routes>
        </Suspense>
      </PageErrorBoundary>
    </AppShell>
  );
}
