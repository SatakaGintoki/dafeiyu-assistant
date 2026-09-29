import { motion } from 'motion/react';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';

export type ParticleKind = 'sparkle' | 'heart' | 'code' | 'zzz' | 'sweat' | 'star' | 'note';
interface Particle { id: number; kind: ParticleKind; x: number; y: number; dx: number; dy: number; rotate: number; delay: number; text: string; size: number }

export interface EffectsHandle {
  burst(kind: ParticleKind, count: number, origin: { x: number; y: number }, spread?: number): void;
}

const glyphs = ['</>', '{ }', ';', '=>', '()', '#', '[]', '&&'];
const colors: Record<ParticleKind, string> = {
  sparkle: '#FFD66B', heart: '#FF7BA5', code: '#7C95FF', zzz: '#8FA6FF', sweat: '#7CC8FF', star: '#FFD66B', note: '#9FB4FF',
};
let nextId = 1;

function make(kind: ParticleKind, origin: { x: number; y: number }, spread: number, index: number): Particle {
  const angle = kind === 'sparkle' || kind === 'star' ? (Math.PI * 2 * index) / 8 + Math.random() * 0.6 : -Math.PI / 2 + (Math.random() - 0.5) * 1.3;
  const distance = spread * (0.6 + Math.random() * 0.6);
  const text = kind === 'heart' ? '♥' : kind === 'code' ? glyphs[Math.floor(Math.random() * glyphs.length)]
    : kind === 'zzz' ? 'z' : kind === 'note' ? (Math.random() > 0.5 ? '♪' : '♫') : kind === 'sweat' ? '' : '✦';
  return {
    id: nextId++, kind, text,
    x: origin.x + (Math.random() - 0.5) * 14, y: origin.y,
    dx: Math.cos(angle) * distance + (kind === 'zzz' ? 26 : 0),
    dy: Math.sin(angle) * distance - (kind === 'heart' || kind === 'code' || kind === 'zzz' || kind === 'note' ? spread * 0.6 : 0),
    rotate: (Math.random() - 0.5) * 50,
    delay: index * (kind === 'zzz' ? 0.45 : 0.04),
    size: kind === 'zzz' ? 14 + index * 4 : kind === 'code' ? 11 + Math.random() * 3 : kind === 'heart' ? 14 + Math.random() * 8 : 10 + Math.random() * 10,
  };
}

/** Lightweight one-shot particles; each removes itself when its animation ends. */
export const Effects = forwardRef<EffectsHandle>(function Effects(_props, ref) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const remove = useCallback((id: number) => setParticles(list => list.filter(p => p.id !== id)), []);
  useImperativeHandle(ref, () => ({
    burst(kind, count, origin, spread = 60) {
      const fresh = Array.from({ length: count }, (_, i) => make(kind, origin, spread, i));
      setParticles(list => [...list.slice(-40), ...fresh]);
    },
  }), []);

  return (
    <div className="effects" aria-hidden>
      {particles.map(p => p.kind === 'sweat'
        ? (
          <motion.svg key={p.id} className="particle" width="14" height="20" viewBox="0 0 14 20" style={{ left: p.x, top: p.y }}
            initial={{ opacity: 0, y: -4, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-4, 0, 10, 22], scale: [0.4, 1, 1, 0.9] }}
            transition={{ duration: 1.3, times: [0, 0.2, 0.7, 1], ease: 'easeIn' }}
            onAnimationComplete={() => remove(p.id)}>
            <path d="M7 1 C9 6 13 9 13 13 A6 6 0 0 1 1 13 C1 9 5 6 7 1Z" fill="#9FD8FF" stroke="#5BB2F0" strokeWidth="1.2" />
            <ellipse cx="4.8" cy="12.5" rx="1.4" ry="2.2" fill="#fff" opacity=".8" />
          </motion.svg>
        )
        : (
          <motion.span key={p.id} className={`particle particle-${p.kind}`}
            style={{ left: p.x, top: p.y, color: colors[p.kind], fontSize: p.size }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.3, rotate: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              x: [0, p.dx * 0.55, p.dx * 0.85, p.dx],
              y: [0, p.dy * 0.55, p.dy * 0.85, p.dy],
              scale: p.kind === 'sparkle' || p.kind === 'star' ? [0.3, 1.2, 0.9, 0.2] : [0.3, 1, 1, 0.8],
              rotate: [0, p.rotate * 0.5, p.rotate, p.rotate],
            }}
            transition={{ duration: p.kind === 'zzz' ? 2.4 : p.kind === 'code' ? 1.8 : 1.1, delay: p.delay, times: [0, 0.25, 0.7, 1], ease: 'easeOut' }}
            onAnimationComplete={() => remove(p.id)}>
            {p.text}
          </motion.span>
        ))}
    </div>
  );
});
