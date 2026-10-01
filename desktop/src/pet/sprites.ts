import frontSrc from '../assets/front.png?inline';
import sideSrc from '../assets/side.png?inline';
import backSrc from '../assets/back.png?inline';

/** The three original views from 1190fasheqi/dafeiyu-pet (MIT), used unmodified. Side view faces left. */
export type View = 'front' | 'side' | 'back';
export type Expression = 'blink' | 'nod' | 'think';
export type SpriteId = View | `${Expression}-${1 | 2 | 3 | 4}`;
const expressionFiles = import.meta.glob('../assets/expressions/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const SPRITES: Record<SpriteId, { src: string; width: number; height: number }> = {
  ...Object.fromEntries(Object.entries(expressionFiles).map(([path, src]) => {
    const [, group, frame] = path.match(/expressions\/(blink|nod|think)\/([1-4])\.png$/)!;
    return [`${group}-${frame}`, { src, width: 255, height: 340 }];
  })) as Record<Exclude<SpriteId, View>, { src: string; width: number; height: number }>,
  front: { src: frontSrc, width: 255, height: 340 },
  side: { src: sideSrc, width: 222, height: 340 },
  back: { src: backSrc, width: 253, height: 340 },
};

const STEP = 2; // mask resolution in source pixels
interface Mask { cols: number; rows: number; bits: Uint8Array }
const masks: Partial<Record<SpriteId, Mask>> = {};

/** Alpha masks let the transparent window pass clicks through everything but the character. */
export function loadMasks() {
  for (const view of Object.keys(SPRITES) as SpriteId[]) {
    const { src, width, height } = SPRITES[view];
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      context.drawImage(image, (width-w)/2, height-h, w, h);
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
export function hitSprite(view: SpriteId, u: number, v: number) {
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
