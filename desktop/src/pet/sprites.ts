import frontSrc from '../assets/front.png?inline';
import sideSrc from '../assets/side.png?inline';
import backSrc from '../assets/back.png?inline';

/** The three original views from 1190fasheqi/dafeiyu-pet (MIT), used unmodified. Side view faces left. */
export type View = 'front' | 'side' | 'back';
export const SPRITES: Record<View, { src: string; width: number; height: number }> = {
  front: { src: frontSrc, width: 255, height: 340 },
  side: { src: sideSrc, width: 222, height: 340 },
  back: { src: backSrc, width: 253, height: 340 },
};

const STEP = 2; // mask resolution in source pixels
interface Mask { cols: number; rows: number; bits: Uint8Array }
const masks: Partial<Record<View, Mask>> = {};

/** Alpha masks let the transparent window pass clicks through everything but the character. */
export function loadMasks() {
  for (const view of Object.keys(SPRITES) as View[]) {
    const { src, width, height } = SPRITES[view];
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const cols = Math.ceil(width / STEP), rows = Math.ceil(height / STEP);
      const bits = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (data[((r * STEP) * width + c * STEP) * 4 + 3] > 40) bits[r * cols + c] = 1;
      }
      masks[view] = { cols, rows, bits };
    };
    image.src = src;
  }
}

/** u, v in 0..1 over the sprite image. A small radius forgives near-misses on thin hair strands. */
export function hitSprite(view: View, u: number, v: number) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const mask = masks[view];
  if (!mask) return true;
  const c = Math.floor(u * mask.cols), r = Math.floor(v * mask.rows);
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < mask.rows && cc >= 0 && cc < mask.cols && mask.bits[rr * mask.cols + cc]) return true;
  }
  return false;
}
