import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppContext } from './context';
import { DeskPreview } from './DeskPreview';
import { electronHost } from './lib/host';
import { Store } from './lib/store';
import type { PanelTab } from './lib/types';
import { webHost } from './lib/webHost';
import { Panel } from './panel/Panel';
import { Pet, type Mood } from './pet/Pet';
import './styles.css';

const params = new URLSearchParams(location.search);
const tabParam = params.get('panel');
const panelTab = tabParam === 'chat' || tabParam === 'tasks' || tabParam === 'settings' ? tabParam as PanelTab : undefined;
const forcedMood = (params.get('pet') || undefined) as Mood | undefined;

const root = createRoot(document.getElementById('root')!);
const view = location.hash.slice(1);

if (window.dayu) {
  const host = electronHost(window.dayu);
  const store = new Store(host.transport);
  document.documentElement.dataset.view = view;
  root.render(
    <StrictMode>
      <AppContext.Provider value={{ host, store }}>
        <MotionConfig reducedMotion="user">
          {view === 'panel' ? <Panel /> : <Pet />}
        </MotionConfig>
      </AppContext.Provider>
    </StrictMode>,
  );
} else {
  const { host, desk } = webHost();
  const store = new Store(host.transport);
  document.documentElement.dataset.view = 'desk';
  desk.menu(() => host.panel.open('settings'));
  if (panelTab) setTimeout(() => host.panel.open(panelTab), 250);
  root.render(
    <StrictMode>
      <AppContext.Provider value={{ host, store }}>
        <MotionConfig reducedMotion="user">
          <DeskPreview desk={desk} forcedMood={forcedMood} />
        </MotionConfig>
      </AppContext.Provider>
    </StrictMode>,
  );
}
