import type { GameEngine } from './engine.js';

export function startGameScheduler(engine:Pick<GameEngine,'tick'>,intervalMs:number,onError:()=>void){
  let stopped=false;let running:Promise<unknown>|undefined;
  function run(){
    if(stopped||running)return;
    running=engine.tick(()=>onError()).catch(()=>onError()).finally(()=>{running=undefined;});
  }
  const timer=setInterval(run,intervalMs);timer.unref();run();
  return {async stop(){stopped=true;clearInterval(timer);await running;}};
}
