import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { Rect } from './lib/host';
import type { WebDesk } from './lib/webHost';
import type { PanelTab } from './lib/types';
import { Panel } from './panel/Panel';
import { Pet, PET_WINDOW, type Mood } from './pet/Pet';
import { WebReminderPopups } from './panel/agenda/WebPopups';

const PANEL = { width: 440, height: 680 };
const TASKBAR = 48;

/** Browser stand-in for the desktop: a wallpaper, the pet "window" and the panel "window". */
export function DeskPreview({ desk, forcedMood }: { desk: WebDesk; forcedMood?: Mood }) {
  const [pet, setPet] = useState<Rect>(desk.pet);
  const [panel, setPanel] = useState<{ open: boolean; tab?: PanelTab }>({ open: false });
  const [clock, setClock] = useState(() => new Date());

  useLayoutEffect(() => {
    const area = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - TASKBAR };
    desk.setArea(area);
    desk.pet = { x: area.width - PET_WINDOW.width - 40, y: area.height - PET_WINDOW.height, ...PET_WINDOW };
    setPet(desk.pet);
  }, [desk]);
  useEffect(() => desk.onPetMove(setPet), [desk]);
  useEffect(() => desk.onPanel(setPanel), [desk]);
  useEffect(() => { const t = window.setInterval(() => setClock(new Date()), 10_000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => desk.cursor({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [desk]);

  const area = desk.area;
  let px = pet.x + 60 - PANEL.width;
  if (px < area.x) px = pet.x + pet.width - 60;
  px = Math.max(area.x, Math.min(px, area.x + area.width - PANEL.width));
  const py = Math.max(area.y, Math.min(pet.y + pet.height - PANEL.height, area.y + area.height - PANEL.height));

  return (
    <div className="desk">
      <div className="wallpaper" />
      <div className="desk-icons">
        {['我的项目', '下载', '回收站'].map(name => <div key={name} className="desk-icon"><span />{name}</div>)}
      </div>
      <WebReminderPopups />
      <div className="desk-hint">浏览器预览 · 拖动、单击、双击、在头上来回摸摸、右键都可以试试</div>

      <AnimatePresence>
        {panel.open && (
          <motion.div className="window panel-window" style={{ left: px, top: py, width: PANEL.width, height: PANEL.height }}
            exit={{ opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.16 } }}>
            <Panel initialTab={panel.tab ?? 'chat'} embedded />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="window pet-window" style={{ left: pet.x, top: pet.y, width: pet.width, height: pet.height }}>
        <Pet forcedMood={forcedMood} />
      </div>

      <footer className="taskbar">
        <div className="tb-start" />
        <div className="tb-apps"><span /><span /><span className="on" /></div>
        <div className="tb-clock">{clock.getHours().toString().padStart(2, '0')}:{clock.getMinutes().toString().padStart(2, '0')}</div>
      </footer>
    </div>
  );
}
