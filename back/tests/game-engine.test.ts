import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {engineFixture} from './helpers/engine.js';
import {GameEngine,phaseResolution,uniqueLeader,winnerOf} from '../src/modules/game/engine.js';
import {publicGame} from '../src/modules/game/service.js';
import {startGameScheduler} from '../src/modules/game/scheduler.js';
import {origin} from './helpers/lobbies.js';

function player(f:Awaited<ReturnType<typeof engineFixture>>,role:string){return f.state().participants.find(p=>p.role===role&&p.status==='ALIVE')!;}
async function passNight(f:Awaited<ReturnType<typeof engineFixture>>){const phase=f.phase().id;for(const p of f.state().participants.filter(p=>p.status==='ALIVE'&&p.role!=='VILLAGER'))await f.engine.submit(f.gameId,phase,p.userId,null,'night');}
async function debate(f:Awaited<ReturnType<typeof engineFixture>>){f.setTime(f.phase().deadline);await f.engine.advance(f.gameId);}

describe('pure game rules',()=>{
  it('uses only a unique plurality; null ballots do not count',()=>{
    expect(uniqueLeader([])).toBeNull();expect(uniqueLeader([{targetUserId:null}])).toBeNull();
    expect(uniqueLeader([{targetUserId:'a'},{targetUserId:'b'}])).toBeNull();
    expect(uniqueLeader([{targetUserId:'a'},{targetUserId:'a'},{targetUserId:'b'},{targetUserId:null}])).toBe('a');
  });
  it('detects village victory and wolf parity, counting only the living',async()=>{
    const f=await engineFixture();const wolf=player(f,'WEREWOLF');expect(winnerOf(f.state())).toBeNull();
    expect(winnerOf(f.state(),wolf.id)).toBe('VILLAGE');
    for(const p of f.state().participants.filter(p=>p.role!=='WEREWOLF').slice(0,4))p.status='DEAD';
    expect(winnerOf(f.state())).toBe('WEREWOLVES');
  });
  it('does not resolve a debate early or resolve a finished game',async()=>{
    const f=await engineFixture();await passNight(f);expect(f.phase().type).toBe('DAY_DISCUSSION');
    expect(phaseResolution(f.state(),f.now())).toBeNull();f.state().status='FINISHED';expect(phaseResolution(f.state(),new Date('2099-01-01'))).toBeNull();
  });
});

describe('actions, phases and persisted outcomes',()=>{
  it('waits for all night actors and returns a private inspection even when the seer is killed',async()=>{
    const f=await engineFixture();const wolf=player(f,'WEREWOLF');const seer=player(f,'SEER');const phase=f.phase().id;
    await f.engine.submit(f.gameId,phase,wolf.userId,seer.userId,'night');expect(f.phase().type).toBe('NIGHT');
    const inspection=await f.engine.submit(f.gameId,phase,seer.userId,wolf.userId,'night');expect(inspection.inspectionRole).toBe('WEREWOLF');
    expect(f.phase().type).toBe('DAY_DISCUSSION');expect(f.state().participants.find(p=>p.id===seer.id)!.status).toBe('DEAD');
    const personal=await f.games!.personal(f.gameId,seer.userId);expect(personal.inspections).toHaveLength(1);
    expect((await f.games!.personal(f.gameId,wolf.userId)).inspections).toEqual([]);
    expect(JSON.stringify(publicGame(f.state()))).not.toMatch(/"(role|roleCode|inspectionRole|targetUserId)":/);
  });
  it('does not wait for an already eliminated seer',async()=>{
    const f=await engineFixture();player(f,'SEER').status='DEAD';const wolf=player(f,'WEREWOLF');
    await f.engine.submit(f.gameId,f.phase().id,wolf.userId,null,'night');expect(f.phase().type).toBe('DAY_DISCUSSION');
  });
  it('supports explicit abstentions and village ties with no elimination and increments the cycle',async()=>{
    const f=await engineFixture();await passNight(f);await debate(f);expect(f.phase().type).toBe('DAY_VOTE');
    const phase=f.phase().id;const alive=f.state().participants;const targets=[alive[1]!,alive[0]!,alive[0]!,alive[1]!,alive[0]!,alive[1]!];
    for(let i=0;i<alive.length;i++)await f.engine.submit(f.gameId,phase,alive[i]!.userId,targets[i]!.userId,'vote');
    expect(f.phase()).toMatchObject({type:'NIGHT',cycle:2});expect(f.state().participants.every(p=>p.status==='ALIVE')).toBe(true);
    expect(f.state().phases.find(p=>p.id===phase)!.eliminatedParticipantId).toBeNull();
  });
  it('treats missing actions as no effect and gives the next phase a full duration on restart',async()=>{
    const f=await engineFixture();f.setTime(new Date(f.phase().deadline.getTime()+86400000));
    const restarted=new GameEngine(f.repository,f.now);expect(await restarted.tick()).toEqual({processed:1,failed:0});
    expect(f.phase().type).toBe('DAY_DISCUSSION');expect(f.phase().startedAt).toEqual(f.now());
    expect(f.phase().deadline.getTime()-f.now().getTime()).toBe(180000);expect(f.state().participants.every(p=>p.status==='ALIVE')).toBe(true);
  });
  it('commits an expired-phase resolution even when rejecting a late action at the exact deadline',async()=>{
    const f=await engineFixture();const phase=f.phase().id;f.setTime(f.phase().deadline);
    await expect(f.engine.submit(f.gameId,phase,player(f,'WEREWOLF').userId,null,'night')).rejects.toMatchObject({code:'PHASE_CLOSED'});
    expect(f.phase().type).toBe('DAY_DISCUSSION');expect(f.state().choices??[]).toHaveLength(0);
    expect(f.state().phases.find(p=>p.id===phase)!.resolvedAt).toEqual(f.now());
  });
  it('rejects forbidden actors and targets without recording a choice',async()=>{
    const f=await engineFixture();const phase=f.phase().id;const wolf=player(f,'WEREWOLF');const seer=player(f,'SEER');const villager=player(f,'VILLAGER');
    await expect(f.engine.submit(f.gameId,phase,villager.userId,null,'night')).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});
    await expect(f.engine.submit(f.gameId,phase,wolf.userId,wolf.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
    await expect(f.engine.submit(f.gameId,phase,seer.userId,seer.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
    await expect(f.engine.submit(f.gameId,phase,wolf.userId,randomUUID(),'night')).rejects.toMatchObject({code:'TARGET_NOT_FOUND'});
    await expect(f.engine.submit(f.gameId,phase,wolf.userId,null,'vote')).rejects.toMatchObject({code:'WRONG_PHASE'});
    f.state().participants.find(p=>p.id===villager.id)!.status='DEAD';await expect(f.engine.submit(f.gameId,phase,villager.userId,null,'night')).rejects.toMatchObject({code:'PLAYER_DEAD'});
    await expect(f.engine.submit(f.gameId,phase,wolf.userId,villager.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
    expect(f.state().choices??[]).toHaveLength(0);
  });
  it('records a final choice once under concurrent duplicate submissions and resolves a phase once',async()=>{
    const f=await engineFixture();const phase=f.phase().id;const wolf=player(f,'WEREWOLF');
    const results=await Promise.allSettled([f.engine.submit(f.gameId,phase,wolf.userId,null,'night'),f.engine.submit(f.gameId,phase,wolf.userId,null,'night')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.state().choices).toHaveLength(1);
    f.setTime(f.phase().deadline);const resolutions=await Promise.all([f.engine.advance(f.gameId),f.engine.advance(f.gameId)]);
    expect(resolutions.filter(Boolean)).toHaveLength(1);expect(f.state().phases).toHaveLength(2);
  });
  it('plays through village victory, freezes the result and reveals roles only after the end',async()=>{
    const f=await engineFixture();const wolf=player(f,'WEREWOLF');const seer=player(f,'SEER');const victim=player(f,'VILLAGER');const night=f.phase().id;
    await f.engine.submit(f.gameId,night,wolf.userId,victim.userId,'night');await f.engine.submit(f.gameId,night,seer.userId,wolf.userId,'night');await debate(f);
    const vote=f.phase().id;for(const p of f.state().participants.filter(p=>p.status==='ALIVE'))await f.engine.submit(f.gameId,vote,p.userId,p.id===wolf.id?null:wolf.userId,'vote');
    expect(f.state()).toMatchObject({status:'FINISHED',winner:'VILLAGE',finishedAt:f.now()});expect(f.state().phases.filter(p=>p.resolvedAt===null)).toHaveLength(0);
    expect(f.data.get(f.lobbyId)!.status).toBe('FINISHED');expect(publicGame(f.state()).participants.every(p=>'role'in p)).toBe(true);
    await expect(f.engine.submit(f.gameId,vote,seer.userId,null,'vote')).rejects.toMatchObject({code:'GAME_FINISHED'});
    expect(await f.engine.advance(f.gameId)).toBe(false);
  });
  it('finishes for the wolves at parity after multiple cycles',async()=>{
    const f=await engineFixture();const wolf=player(f,'WEREWOLF');const seer=player(f,'SEER');let night=f.phase().id;
    await f.engine.submit(f.gameId,night,seer.userId,null,'night');await f.engine.submit(f.gameId,night,wolf.userId,seer.userId,'night');
    for(let cycle=0;cycle<2;cycle++){
      await debate(f);const vote=f.phase().id;const victim=player(f,'VILLAGER');
      for(const p of f.state().participants.filter(p=>p.status==='ALIVE'))await f.engine.submit(f.gameId,vote,p.userId,p.id===victim.id?null:victim.userId,'vote');
      if(f.state().status==='FINISHED')break;
      night=f.phase().id;await f.engine.submit(f.gameId,night,wolf.userId,player(f,'VILLAGER').userId,'night');
    }
    expect(f.state()).toMatchObject({status:'FINISHED',winner:'WEREWOLVES'});
  });
});

describe('protected action HTTP resources',()=>{
  it('requires session/CSRF, persists private inspection results and supports reading only your own choices',async()=>{
    const f=await engineFixture();const seer=await f.client('Guest');const wolf=player(f,'WEREWOLF');const phase=f.phase().id;
    const url=`/api/games/${f.gameId}/phases/${phase}/night-actions`;
    expect((await request(f.app).post(url).send({targetUserId:wolf.userId})).status).toBe(403);
    expect((await seer.agent.post(url).set('Origin',origin).send({targetUserId:wolf.userId})).status).toBe(403);
    expect((await seer.post(url,{targetUserId:wolf.userId,kind:'WOLF_ATTACK'})).status).toBe(400);
    const result=await seer.post(url,{targetUserId:wolf.userId});expect(result.status).toBe(201);expect(result.body.inspection.role).toBe('WEREWOLF');
    expect((await seer.agent.get(result.headers.location!)).body).toEqual(result.body);
    const villager=await f.client('Other');expect((await villager.agent.get(result.headers.location!)).status).toBe(404);
    expect((await seer.agent.get(`/api/games/${f.gameId}/participants/me`)).body.currentChoice.id).toBe(result.body.id);
    expect((await seer.post(url,{targetUserId:null})).status).toBe(409);
    const outsider=await f.client('Seventh');expect((await outsider.agent.get(result.headers.location!)).status).toBe(404);
  });
});

describe('scheduler lifecycle',()=>{
  afterEach(()=>vi.useRealTimers());
  it('ticks immediately, prevents overlap and waits for in-flight work on stop',async()=>{
    vi.useFakeTimers();let release!:()=>void;let calls=0;
    const scheduler=startGameScheduler({tick:async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return {processed:0,failed:0};}},1000,()=>{});
    expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(3000);expect(calls).toBe(1);
    const stopped=scheduler.stop();release();await stopped;await vi.advanceTimersByTimeAsync(3000);expect(calls).toBe(1);
  });
});
