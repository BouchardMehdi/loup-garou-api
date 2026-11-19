import {randomUUID} from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import {gameFixture,startTime} from './game.js';
import {settings,origin} from './lobbies.js';
import {createApp} from '../../src/app.js';
import {AccountService} from '../../src/modules/accounts/service.js';
import {GameEngine,EngineError,type EngineRepository,type Resolution} from '../../src/modules/game/engine.js';
import type {Game} from '../../src/modules/game/domain.js';

export function memoryEngine(data:Map<string,Game>,onFinish:(id:string)=>void=()=>{}){
  const locks=new Map<string,Promise<void>>();
  const repository:EngineRepository={
    dueGames:async(now,limit)=>[...data.values()].filter(g=>g.status==='IN_PROGRESS'&&g.phases.some(p=>p.resolvedAt===null&&p.deadline<=now)).map(g=>g.id).slice(0,limit),
    withLockedGame:async(id,work)=>{
      const previous=locks.get(id)??Promise.resolve();let release!:()=>void;const next=new Promise<void>(resolve=>{release=resolve;});locks.set(id,previous.then(()=>next));await previous;
      try{
        const saved=data.get(id);if(!saved)throw new EngineError('GAME_NOT_FOUND');const current=structuredClone(saved);
        const result=await work({game:structuredClone(current),reload:async()=>structuredClone(current),
          addChoice:async input=>{
            const choice={id:randomUUID(),phaseId:input.phaseId,userId:current.participants.find(p=>p.id===input.actorId)!.userId,kind:input.kind,targetUserId:current.participants.find(p=>p.id===input.targetId)?.userId??null,inspectionRole:input.inspectionRole,createdAt:input.at};
            (current.choices??=[]).push(choice);return structuredClone(choice);
          },
          resolve:async(r:Resolution)=>{
            const phase=current.phases.find(p=>p.id===r.phaseId)!;if(phase.resolvedAt)throw new Error('Duplicate resolution');
            phase.resolvedAt=r.at;phase.eliminatedParticipantId=r.eliminatedId;
            if(r.eliminatedId){const victim=current.participants.find(p=>p.id===r.eliminatedId)!;victim.status='DEAD';victim.eliminatedAt=r.at;}
            if(r.winner){current.status='FINISHED';current.winner=r.winner;current.finishedAt=r.at;}
            else if(r.next)current.phases.push({id:randomUUID(),...r.next,resolvedAt:null});
          },
        });
        data.set(id,current);if(current.status==='FINISHED')onFinish(current.lobbyId);return result;
      }finally{release();}
    },
  };return repository;
}

export async function engineFixture(){
  const f=await gameFixture();const ownerId=[...f.users.values()][0]!.id;
  const lobby=await f.service.create(ownerId,settings);for(const user of [...f.users.values()].slice(1,6))await f.service.join(lobby.lobby.id,user.id);
  const game=await f.games!.start(lobby.lobby.id,ownerId);let clock=startTime.getTime();
  const repository=memoryEngine(f.gameData,id=>{f.data.get(id)!.status='FINISHED';});const engine=new GameEngine(repository,()=>new Date(clock));
  const accounts=await AccountService.create({findById:async id=>f.users.get(id)??null,findByEmail:async email=>[...f.users.values()].find(u=>u.email===email)??null,create:async()=>{throw new Error('Unused');}},
    {hash:async p=>`hash:${p}`,verify:async(h,p)=>h===`hash:${p}`});
  const app=createApp({origin,trustProxyHops:0,checks:{database:async()=>{},redis:async()=>{}},games:f.games,engine,lobbies:f.service,
    accounts:{service:accounts,sessionStore:new session.MemoryStore(),limiter:{consume:async()=>({count:1,retryAfterMs:1000})},secret:'engine-unit-test-session-secret-at-least-32-characters',secureCookies:false,sameSite:'lax',ttlSeconds:3600,origin}});
  async function client(username:string){const agent=request.agent(app);const token=(await agent.get('/api/csrf')).body.csrfToken;
    const logged=await agent.post('/api/sessions').set('Origin',origin).set('X-CSRF-Token',token).send({email:`${username.toLowerCase()}@example.test`,password:'password'});
    return {agent,csrf:logged.body.csrfToken as string,post:(path:string,body:object)=>agent.post(path).set('Origin',origin).set('X-CSRF-Token',logged.body.csrfToken).send(body)};
  }
  return {...f,app,client,gameId:game.id,lobbyId:lobby.lobby.id,engine,repository,
    state:()=>f.gameData.get(game.id)!,phase:()=>f.gameData.get(game.id)!.phases.find(p=>p.resolvedAt===null)!,
    setTime:(time:Date)=>{clock=time.getTime();},now:()=>new Date(clock)};
}
