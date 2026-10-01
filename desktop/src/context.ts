import { createContext, useContext, useEffect, useState } from 'react';
import type { Host } from './lib/host';
import type { Store } from './lib/store';
import type { AgendaStore } from './lib/agenda';
import { defaultPrefs, type PetPrefs } from './lib/types';

export const AppContext = createContext<{ host: Host; store: Store; agenda: AgendaStore } | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext missing');
  return value;
}

export function usePrefs(host: Host): PetPrefs {
  const [prefs, setPrefs] = useState<PetPrefs>(defaultPrefs);
  useEffect(() => {
    let alive = true;
    void host.prefs.get().then(p => { if (alive) setPrefs(p); });
    const off = host.prefs.onChange(setPrefs);
    return () => { alive = false; off(); };
  }, [host]);
  return prefs;
}

/** True while the document is visible; animations pause when it isn't. */
export function usePageVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
