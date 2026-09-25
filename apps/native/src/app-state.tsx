import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { Bootstrap, Draft, Plan } from './types';
import { clientId, deletePlanOffline, getLocalPlanMutationRevision, hydrate, local, refreshRemote, savePlanOffline, syncPending, updatePlanOffline } from './repository';
import { initialDraft } from './logic';
import * as Crypto from 'expo-crypto';
import { disableReminders } from './reminders';

type SyncState = 'synced' | 'pending' | 'error';
type State = {
  loading: boolean; error: string | null; plan: Plan | null; bootstrap: Bootstrap | null; draft: Draft | null;
  onboarded: boolean; sync: SyncState; refresh: () => Promise<void>; updateDraft: (draft: Draft) => Promise<void>;
  savePlan: (plan: Plan) => Promise<void>; updatePlan: (update: (current: Plan) => Plan) => Promise<Plan>;
  finishOnboarding: () => Promise<void>; clearLocalPlan: () => Promise<void>;
};
const Context = createContext<State | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [sync, setSync] = useState<SyncState>('synced');
  const refresh = useCallback(async () => {
    const revision = getLocalPlanMutationRevision();
    setLoading(true); setError(null);
    try {
      const id = await clientId();
      const [snapshot, storedDraft, seen] = await Promise.all([hydrate(), local.draft(), local.onboarding()]);
      setPlan(snapshot.plan); setBootstrap(snapshot.bootstrap); setSync(snapshot.sync);
      setDraft(storedDraft ?? initialDraft(Crypto.randomUUID())); setOnboarded(Boolean(seen));
      void refreshRemote(id).then(remote => {
        if (revision !== getLocalPlanMutationRevision()) return;
        setPlan(remote.plan); setBootstrap(remote.bootstrap); setSync(remote.sync);
      }).catch(() => { if (revision === getLocalPlanMutationRevision()) setSync('error'); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть данные приложения.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        const revision = getLocalPlanMutationRevision();
        void clientId().then(id => refreshRemote(id).then(remote => {
          if (revision !== getLocalPlanMutationRevision()) return;
          setPlan(remote.plan); setBootstrap(remote.bootstrap); setSync(remote.sync);
        })).catch(() => { if (revision === getLocalPlanMutationRevision()) setSync('pending'); });
      }
    });
    return () => subscription.remove();
  }, []);
  const updateDraft = async (value: Draft) => { setDraft(value); await local.saveDraft(value); };
  const savePlan = async (value: Plan) => {
    await savePlanOffline(value); setPlan(value); setSync('pending');
    if (plan?.id !== value.id) void disableReminders().catch(() => undefined);
    void clientId().then(id => syncPending(id).then(setSync)).catch(() => setSync('pending'));
  };
  const updatePlan = async (update: (current: Plan) => Plan) => {
    const value = await updatePlanOffline(update);
    setPlan(value); setSync('pending');
    void clientId().then(id => syncPending(id).then(setSync)).catch(() => setSync('pending'));
    return value;
  };
  const finishOnboarding = async () => { await local.finishOnboarding(); setOnboarded(true); };
  const clearLocalPlan = async () => {
    const freshDraft = initialDraft(Crypto.randomUUID());
    await deletePlanOffline(freshDraft);
    setPlan(null); setDraft(freshDraft); setSync('pending');
    void disableReminders().catch(() => undefined);
    void clientId().then(id => syncPending(id).then(setSync)).catch(() => setSync('pending'));
  };
  return <Context.Provider value={{ loading, error, plan, bootstrap, draft, onboarded, sync, refresh, updateDraft, savePlan, updatePlan, finishOnboarding, clearLocalPlan }}>{children}</Context.Provider>;
}
export function useApp() { const state = useContext(Context); if (!state) throw new Error('AppProvider missing'); return state; }
