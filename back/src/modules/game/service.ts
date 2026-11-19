import {personalChoice} from './engine.js';
import { randomInt } from 'node:crypto';
import { GameError, teamOf, type Game, type GameRepository, type RoleCode } from './domain.js';

export function roleDeck(count: number): RoleCode[] {
  if (!Number.isInteger(count) || count < 6 || count > 12) throw new GameError('PLAYER_COUNT_INVALID');
  const wolves = count <= 7 ? 1 : count <= 10 ? 2 : 3;
  return [...Array<RoleCode>(wolves).fill('WEREWOLF'), 'SEER', ...Array<RoleCode>(count-wolves-1).fill('VILLAGER')];
}
export function shuffledRoles(count: number, choose: (upperExclusive: number) => number = randomInt): RoleCode[] {
  const roles = roleDeck(count);
  for (let i=roles.length-1;i>0;i--) {
    const j=choose(i+1);
    if (!Number.isInteger(j) || j<0 || j>i) throw new Error('Invalid random source');
    [roles[i],roles[j]]=[roles[j]!,roles[i]!];
  }
  return roles;
}

export class GameService {
  constructor(private readonly repository: GameRepository, private readonly now: () => Date = () => new Date(),
    private readonly choose: (upperExclusive: number) => number = randomInt) {}

  async start(lobbyId: string, userId: string) {
    return this.repository.start(lobbyId, (lobby) => {
      if (!lobby.members.some((m) => m.userId === userId)) throw new GameError('LOBBY_NOT_FOUND');
      if (lobby.ownerId !== userId) throw new GameError('START_FORBIDDEN');
      if (lobby.status !== 'WAITING') throw new GameError('LOBBY_NOT_WAITING');
      if (lobby.members.length > lobby.capacity) throw new GameError('PLAYER_COUNT_INVALID');
      const roles=shuffledRoles(lobby.members.length,this.choose);
      const startedAt=this.now();
      return { startedAt, deadline: new Date(startedAt.getTime()+lobby.nightDurationSeconds*1000),
        participants: lobby.members.map((m,i) => ({ ...m,role: roles[i]! })) };
    });
  }

  async get(id: string, userId: string) {
    const game=await this.repository.find(id);
    if (!game || !game.participants.some((p) => p.userId===userId)) throw new GameError('GAME_NOT_FOUND');
    return game;
  }
  async personal(id: string, userId: string) {
    const game=await this.get(id,userId); const self=game.participants.find((p) => p.userId===userId)!;
    return { id: self.id,gameId: game.id,userId: self.userId,username: self.username,
      currentChoice: (()=>{const c=(game.choices??[]).find(c=>c.userId===userId&&game.phases.some(p=>p.id===c.phaseId&&p.resolvedAt===null));return c?personalChoice(c,game.id):null;})(),
      inspections: self.role==='SEER'?(game.choices??[]).filter(c=>c.userId===userId&&c.kind==='SEER_INSPECT'&&c.inspectionRole!==null).map(c=>({phaseId:c.phaseId,targetUserId:c.targetUserId,role:c.inspectionRole,createdAt:c.createdAt.toISOString()})):[],
      role: self.role,team: teamOf(self.role),status: self.status,
      teammates: self.role==='WEREWOLF' && self.status==='ALIVE'
        ? game.participants.filter((p) => p.role==='WEREWOLF' && p.status==='ALIVE' && p.userId!==userId)
          .map((p) => ({ id: p.id,userId: p.userId,username: p.username,status: p.status })) : [] };
  }
}

export function publicGame(game: Game) {
  const phase=game.phases.find((p) => p.resolvedAt===null);
  const phaseOrder={NIGHT:0,DAY_DISCUSSION:1,DAY_VOTE:2};
  const last=game.phases.filter(p=>p.resolvedAt!==null).sort((a,b)=>b.resolvedAt!.getTime()-a.resolvedAt!.getTime()||b.startedAt.getTime()-a.startedAt.getTime()||b.cycle-a.cycle||phaseOrder[b.type]-phaseOrder[a.type])[0];
  return { id: game.id,lastResolution:last?{phaseId:last.id,type:last.type,cycle:last.cycle,resolvedAt:last.resolvedAt!.toISOString(),eliminatedUserId:game.participants.find(p=>p.id===last.eliminatedParticipantId)?.userId??null}:null,lobbyId: game.lobbyId,status: game.status,startedAt: game.startedAt.toISOString(),
    finishedAt: game.finishedAt?.toISOString() ?? null,winner: game.winner,
    discussionDurationSeconds: game.discussionDurationSeconds,voteDurationSeconds: game.voteDurationSeconds,nightDurationSeconds: game.nightDurationSeconds,
    phase: phase ? { id: phase.id,type: phase.type,cycle: phase.cycle,startedAt: phase.startedAt.toISOString(),deadline: phase.deadline.toISOString() } : null,
    participants: game.participants.map((p) => ({ id: p.id,userId: p.userId,username: p.username,status: p.status,eliminatedAt: p.eliminatedAt?.toISOString() ?? null,...(game.status==='FINISHED'?{role:p.role,team:teamOf(p.role)}:{}) })),
    _links: { self: { href: `/api/games/${game.id}` },lobby: { href: `/api/lobbies/${game.lobbyId}` },participant: { href: `/api/games/${game.id}/participants/me` } } };
}
