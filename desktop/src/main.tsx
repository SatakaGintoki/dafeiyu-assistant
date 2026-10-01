import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppContext } from './context';
import { DeskPreview } from './DeskPreview';
import { electronHost } from './lib/host';
import { Store } from './lib/store';
import { AgendaStore } from './lib/agenda';
import type { PanelTab } from './lib/types';
import { webHost } from './lib/webHost';
import { Panel } from './panel/Panel';
import { Pet, type Mood } from './pet/Pet';
import './styles.css';

const params = new URLSearchParams(location.search);
const tabParam = params.get('panel');
const panelTab = tabParam === 'chat' || tabParam === 'tasks' || tabParam === 'agenda' || tabParam === 'settings' ? tabParam as PanelTab : undefined;
const forcedMood = (params.get('pet') || undefined) as Mood | undefined;

const root = createRoot(document.getElementById('root')!);
const view = location.hash.slice(1);

if (window.dayu) {
  const host = electronHost(window.dayu);
  const store = new Store(host.transport);
  // Only the panel window reads agenda data; the pet window never starts it.
  const agenda = new AgendaStore(store.api.agenda, host.transport);
  if (view === 'panel') agenda.start();
  document.documentElement.dataset.view = view;
  root.render(
    <StrictMode>
      <AppContext.Provider value={{ host, store, agenda }}>
        <MotionConfig reducedMotion="user">
          {view === 'panel' ? <Panel /> : <Pet />}
        </MotionConfig>
      </AppContext.Provider>
    </StrictMode>,
  );
} else {
  const { host, desk } = webHost();
  const store = new Store(host.transport);
  const agenda = new AgendaStore(store.api.agenda, host.transport, { popups: true });
  agenda.start();
  document.documentElement.dataset.view = 'desk';
  desk.menu(() => host.panel.open('settings'));
  if (panelTab) setTimeout(() => host.panel.open(panelTab), 250);
  root.render(
    <StrictMode>
      <AppContext.Provider value={{ host, store, agenda }}>
        <MotionConfig reducedMotion="user">
          <DeskPreview desk={desk} forcedMood={forcedMood} />
        </MotionConfig>
      </AppContext.Provider>
    </StrictMode>,
  );
}
