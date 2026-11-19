import { teamOf,type Game,type GameChoice,type GamePhase,type RoleCode,type Team } from './domain.js';

export type EngineErrorCode='CHOICE_NOT_FOUND'|'GAME_NOT_FOUND'|'GAME_FINISHED'|'PHASE_CLOSED'|'WRONG_PHASE'|'PLAYER_DEAD'|'ROLE_FORBIDDEN'|'TARGET_NOT_FOUND'|'TARGET_FORBIDDEN'|'CHOICE_ALREADY_SUBMITTED';
export class EngineError extends Error { constructor(public readonly code:EngineErrorCode){super(code);} }
export interface Resolution {
  phaseId:string;at:Date;eliminatedId:string|null;winner:Team|null;
  next:{type:GamePhase['type'];cycle:number;startedAt:Date;deadline:Date}|null;
}
export interface EngineTransaction {
  game:Game;
  addChoice(input:{phaseId:string;actorId:string;targetId:string|null;kind:GameChoice['kind'];inspectionRole:RoleCode|null;at:Date}):Promise<GameChoice>;
  resolve(input:Resolution):Promise<void>;
  reload():Promise<Game>;
}
export interface EngineRepository {
  withLockedGame<T>(id:string,work:(tx:EngineTransaction)=>Promise<T>):Promise<T>;
  dueGames(now:Date,limit:number):Promise<string[]>;
}
export function winnerOf(game:Game,eliminatedId:string|null=null):Team|null{
  const alive=game.participants.filter(p=>p.status==='ALIVE' && p.id!==eliminatedId);
  const wolves=alive.filter(p=>teamOf(p.role)==='WEREWOLVES').length;
  if(wolves===0)return 'VILLAGE';
  if(wolves>=alive.length-wolves)return 'WEREWOLVES';
  return null;
}
export function uniqueLeader(choices:Array<{targetUserId:string|null}>):string|null{
  const counts=new Map<string,number>();
  for(const c of choices)if(c.targetUserId)counts.set(c.targetUserId,(counts.get(c.targetUserId)??0)+1);
  let best=0;let target:string|null=null;let tied=false;
  for(const [id,count]of counts){if(count>best){best=count;target=id;tied=false;}else if(count===best)tied=true;}
  return tied?null:target;
}
export function phaseResolution(game:Game,at:Date):Resolution|null{
  if(game.status!=='IN_PROGRESS')return null;
  const phase=game.phases.find(p=>p.resolvedAt===null);if(!phase)return null;
  const choices=(game.choices??[]).filter(c=>c.phaseId===phase.id);
  const expected=game.participants.filter(p=>p.status==='ALIVE' && (phase.type==='DAY_VOTE'||(phase.type==='NIGHT'&&p.role!=='VILLAGER')));
  const allPlayed=phase.type!=='DAY_DISCUSSION' && expected.every(p=>choices.some(c=>c.userId===p.userId));
  if(at.getTime()<phase.deadline.getTime()&&!allPlayed)return null;
  const ballots=choices.filter(c=>phase.type==='NIGHT'?c.kind==='WOLF_ATTACK':phase.type==='DAY_VOTE'&&c.kind==='VILLAGE_VOTE');
  const target=uniqueLeader(ballots);const eliminatedId=target?game.participants.find(p=>p.userId===target&&p.status==='ALIVE')?.id??null:null;
  const winner=phase.type==='DAY_DISCUSSION'?null:winnerOf(game,eliminatedId);
  const nextType=phase.type==='NIGHT'?'DAY_DISCUSSION':phase.type==='DAY_DISCUSSION'?'DAY_VOTE':'NIGHT';
  const seconds=nextType==='NIGHT'?game.nightDurationSeconds:nextType==='DAY_DISCUSSION'?game.discussionDurationSeconds:game.voteDurationSeconds;
  return {phaseId:phase.id,at,eliminatedId,winner,next:winner?null:{type:nextType,cycle:phase.cycle+(phase.type==='DAY_VOTE'?1:0),startedAt:at,deadline:new Date(at.getTime()+seconds*1000)}};
}

export class GameEngine {
  constructor(private readonly repository:EngineRepository,private readonly now:()=>Date=()=>new Date()){}
  async advance(id:string){
    return this.repository.withLockedGame(id,async tx=>{
      const resolution=phaseResolution(tx.game,this.now());if(!resolution)return false;
      await tx.resolve(resolution);return true;
    });
  }
  async tick(onError:(id:string)=>void=()=>{}){
    const ids=await this.repository.dueGames(this.now(),50);let failed=0;
    for(const id of ids){try{await this.advance(id);}catch{failed++;onError(id);}}
    return {processed:ids.length,failed};
  }
  async submit(gameId:string,phaseId:string,userId:string,targetUserId:string|null,type:'night'|'vote'){
    const outcome=await this.repository.withLockedGame(gameId,async tx=>{
      if(!tx.game.participants.some(p=>p.userId===userId))throw new EngineError('GAME_NOT_FOUND');
      const at=this.now();
      const expired=tx.game.phases.find(p=>p.resolvedAt===null);
      if(expired && expired.deadline.getTime()<=at.getTime()){
        const resolution=phaseResolution(tx.game,at);if(resolution){await tx.resolve(resolution);tx.game=await tx.reload();}
      }
      // Return rule failures rather than throwing: an overdue resolution must stay committed.
      try{
        const game=tx.game;if(game.status!=='IN_PROGRESS')throw new EngineError('GAME_FINISHED');
        const phase=game.phases.find(p=>p.resolvedAt===null);
        if(!phase||phase.id!==phaseId||phase.deadline.getTime()<=at.getTime())throw new EngineError('PHASE_CLOSED');
        if((type==='night'&&phase.type!=='NIGHT')||(type==='vote'&&phase.type!=='DAY_VOTE'))throw new EngineError('WRONG_PHASE');
        const actor=game.participants.find(p=>p.userId===userId)!;
        if(actor.status!=='ALIVE')throw new EngineError('PLAYER_DEAD');
        if(type==='night'&&actor.role==='VILLAGER')throw new EngineError('ROLE_FORBIDDEN');
        if((game.choices??[]).some(c=>c.phaseId===phaseId&&c.userId===userId))throw new EngineError('CHOICE_ALREADY_SUBMITTED');
        const target=targetUserId===null?null:game.participants.find(p=>p.userId===targetUserId);
        if(targetUserId!==null&&!target)throw new EngineError('TARGET_NOT_FOUND');
        if(target&&(target.status!=='ALIVE'||target.id===actor.id||(type==='night'&&actor.role==='WEREWOLF'&&target.role==='WEREWOLF')))throw new EngineError('TARGET_FORBIDDEN');
        const kind=type==='vote'?'VILLAGE_VOTE':actor.role==='WEREWOLF'?'WOLF_ATTACK':'SEER_INSPECT';
        const choice=await tx.addChoice({phaseId,actorId:actor.id,targetId:target?.id??null,kind,inspectionRole:kind==='SEER_INSPECT'?target?.role??null:null,at});
        tx.game=await tx.reload();const resolution=phaseResolution(tx.game,at);if(resolution)await tx.resolve(resolution);
        return {choice,error:null};
      }catch(error){if(error instanceof EngineError)return {choice:null,error};throw error;}
    });
    if(outcome.error)throw outcome.error;
    return outcome.choice!;
  }
}

export function personalChoice(choice:GameChoice,gameId:string){
  const route=choice.kind==='VILLAGE_VOTE'?'votes':'night-actions';
  return {id:choice.id,gameId,phaseId:choice.phaseId,kind:choice.kind,targetUserId:choice.targetUserId,submittedAt:choice.createdAt.toISOString(),
    inspection:choice.inspectionRole?{targetUserId:choice.targetUserId,role:choice.inspectionRole}:null,
    _links:{self:{href:`/api/games/${gameId}/phases/${choice.phaseId}/${route}/me`},game:{href:`/api/games/${gameId}`}}};
}
