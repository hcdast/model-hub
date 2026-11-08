import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { dramaApi, type DramaPlan, type DramaProject } from '../services/drama-api';
import { useAuthStore, getApiErrorMessage } from '../store/auth-store';

interface Backup { baseRevision: number; plan: DramaPlan }
export function useDramaProject(id?: string) {
  const owner = useAuthStore(s => s.user?.id);
  const [project, setProject] = useState<DramaProject>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved');
  const [recovery, setRecovery] = useState<Backup>();
  const latest = useRef<DramaProject>(), dirty = useRef(false), operation = useRef<Promise<DramaProject | undefined>>(), generation = useRef(0);
  const key = `short-drama-draft:${owner}:${id}`;
  const backup = useCallback((p: DramaProject) => { try { localStorage.setItem(key, JSON.stringify({ baseRevision: p.revision, plan: p.plan })); } catch { /* The unsaved badge and unload prompt remain active. */ } }, [key]);
  const load = useCallback(async () => {
    const version = ++generation.current; operation.current = undefined; setLoading(true); setError(''); latest.current = undefined; setProject(undefined); dirty.current = false; setRecovery(undefined);
    if (!id) { setLoading(false); return; }
    try {
      const server = await dramaApi.get(id); if (version !== generation.current) return;
      latest.current = server; setProject(server); setSaveState('saved');
      try { const raw = localStorage.getItem(key); if (raw) { const saved = JSON.parse(raw) as Backup; if (saved.plan && JSON.stringify(saved.plan) !== JSON.stringify(server.plan)) setRecovery(saved); else localStorage.removeItem(key); } } catch { /* Ignore invalid local copies. */ }
    } catch (e) { if (version === generation.current) setError(getApiErrorMessage(e, '作品加载失败，请重试')); }
    finally { if (version === generation.current) setLoading(false); }
  }, [id, key]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const edit = useCallback((update: DramaPlan | ((plan: DramaPlan) => DramaPlan)) => {
    const p = latest.current; if (!p) return;
    const next = typeof update === 'function' ? update(p.plan) : update;
    latest.current = { ...p, plan: next }; dirty.current = true; setProject(latest.current); backup(latest.current);
    setSaveState(s => s === 'conflict' ? 'conflict' : 'dirty');
  }, [backup]);
  const flush = useCallback(async (): Promise<DramaProject | undefined> => {
    if (operation.current) return operation.current;
    const version = generation.current;
    const task = (async () => {
      while (dirty.current && latest.current && version === generation.current) {
        const sent = latest.current; setSaveState('saving');
        try {
          const saved = await dramaApi.save(sent.id, sent.revision, sent.plan);
          if (version !== generation.current) return;
          const changed = JSON.stringify(latest.current?.plan) !== JSON.stringify(sent.plan);
          latest.current = changed ? { ...saved, plan: latest.current!.plan } : saved; dirty.current = changed;
          setProject(latest.current);
          if (changed) backup(latest.current); else { try { localStorage.removeItem(key); } catch { /* Optional storage. */ } setSaveState('saved'); }
          setError('');
        } catch (e) {
          if (version === generation.current) { setSaveState(axios.isAxiosError(e) && e.response?.status === 409 ? 'conflict' : 'error'); setError(getApiErrorMessage(e, '保存失败，请检查网络。你的编辑仍保留在当前页面。')); }
          throw e;
        }
      }
      return latest.current;
    })();
    operation.current = task;
    try { return await task; } finally { if (operation.current === task) operation.current = undefined; }
  }, [backup, key]);
  useEffect(() => { if (saveState !== 'dirty' || recovery) return; const timer = setTimeout(() => { void flush().catch(() => {}); }, 700); return () => clearTimeout(timer); }, [project, saveState, recovery, flush]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  const refresh = useCallback(async () => {
    const p = latest.current, version = generation.current; if (!p) return;
    const server = await dramaApi.get(p.id);
    if (version !== generation.current || latest.current?.id !== p.id || server.revision < latest.current.revision) return;
    if (!dirty.current && !operation.current) { latest.current = server; setProject(server); }
    else { latest.current = { ...latest.current, candidates: server.candidates, pendingRequests: server.pendingRequests, budget: server.budget }; setProject(latest.current); }
  }, []);
  // Budget/restore also advance the revision. Serialize them with autosave and
  // retain edits made while the request is in flight instead of reloading the page.
  const mutate = useCallback(async (action: (saved: DramaProject) => Promise<DramaProject>) => {
    await flush();
    while (operation.current) await operation.current;
    const sent = latest.current, version = generation.current;
    if (!sent) return;
    const task = (async () => {
      setSaveState('saving');
      try {
        const server = await action(sent);
        if (version !== generation.current) return;
        const changed = JSON.stringify(latest.current?.plan) !== JSON.stringify(sent.plan);
        latest.current = changed ? { ...server, plan: latest.current!.plan } : server;
        dirty.current = changed; setProject(latest.current); setError('');
        if (changed) { backup(latest.current); setSaveState('dirty'); }
        else { try { localStorage.removeItem(key); } catch { /* Optional storage. */ } setSaveState('saved'); }
        return latest.current;
      } catch (e) {
        if (version === generation.current) {
          setSaveState(axios.isAxiosError(e) && e.response?.status === 409 ? 'conflict' : 'error');
          setError(getApiErrorMessage(e, '保存设置失败，你的编辑仍保留在当前页面。'));
        }
        throw e;
      }
    })();
    operation.current = task;
    try { await task; } finally { if (operation.current === task) operation.current = undefined; }
    return flush();
  }, [flush, backup, key]);
  useEffect(() => {
    if (!project?.candidates.some(c => c.status === 'pending' || c.status === 'running' || c.archiveStatus === 'archiving' || (c.source === 'model' && c.status === 'succeeded' && c.url && c.archiveStatus !== 'archived'))) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, project.candidates.some(c => c.status === 'pending' || c.status === 'running') ? 3000 : 15000); return () => clearInterval(timer);
  }, [project?.candidates, refresh]);
  return { project, loading, error, saveState, edit, flush, refresh, load, mutate, recovery,
    recover: () => { if (recovery && latest.current) { const plan = recovery.plan; setRecovery(undefined); edit(plan); } },
    discardRecovery: () => { setRecovery(undefined); try { localStorage.removeItem(key); } catch { /* Optional storage. */ } },
  };
}
