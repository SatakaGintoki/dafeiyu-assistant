import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { SPRITES, type Expression, type SpriteId } from './sprites';

/** Frame durations are deliberately asymmetric: a blink is brief, thought poses linger. */
export const sequences = {
  blink: [[1,70],[2,70],[3,110],[4,90],[1,100]],
  nod: [[1,140],[2,140],[3,180],[4,140],[1,180]],
  think: [[1,700],[2,450],[3,850],[4,500]],
} as const;

export function useExpression(mood:string, front:boolean, visible:boolean, nod:number) {
  const reduced = useReducedMotion();
  const [ready,setReady] = useState(false);
  const [frame,setFrame] = useState<SpriteId>('blink-1');
  useEffect(()=>{
    let alive=true;
    // Decode before playing: no blank flashes when a frame first appears.
    const images=Object.entries(SPRITES).filter(([id])=>id.includes('-')).map(([,sprite])=>{
      const image=new Image();image.src=sprite.src;return image.decode();
    });
    Promise.all(images).then(()=>{if(alive)setReady(true);},()=>{});
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    let stopped=false;
    const schedule=(fn:()=>void,ms:number)=>{timer=setTimeout(()=>{if(!stopped)fn();},ms);};
    setFrame(mood==='sleeping'?'blink-3':mood==='thinking'?'think-1':'blink-1');
    if(!ready||!front||!visible||reduced)return;
    const play=(name:Expression,index=0)=>{
      const steps=sequences[name];const [n,ms]=steps[index];
      setFrame(`${name}-${n}` as SpriteId);
      schedule(()=>{
        if(index+1<steps.length)play(name,index+1);
        else if(name==='think')play('think');
        else {setFrame('blink-1');schedule(()=>play('blink'),3500+Math.random()*3500);}
      },ms);
    };
    if(mood==='thinking')play('think');
    else if(mood!=='sleeping'){
      if(nod>0&&['idle','waiting'].includes(mood))play('nod');
      else schedule(()=>play('blink'),3500+Math.random()*3500);
    }
    return ()=>{stopped=true;clearTimeout(timer);};
  },[mood,front,visible,nod,ready,reduced]);
  return ready&&front ? frame : undefined;
}
