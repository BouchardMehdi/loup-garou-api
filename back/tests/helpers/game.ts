import { randomUUID } from 'node:crypto';
import { lobbyFixture } from './lobbies.js';
import type { Game,GameRepository } from '../../src/modules/game/domain.js';
import { GameService } from '../../src/modules/game/service.js';

export const startTime=new Date('2026-11-19T12:00:00.000Z');
export async function gameFixture() {
  const gameData=new Map<string,Game>();
  const f=await lobbyFixture((memory) => {
    const repository: GameRepository={
      find: async (id) => gameData.has(id) ? structuredClone(gameData.get(id)!) : null,
      start: async (id,prepare) => memory.repo.withLockedLobby(id,async (tx) => {
        const l=tx.lobby;
        const setup=prepare({ ...l,ownerId: l.owner.id,members: l.members.map((m) => ({userId: m.userId,username: m.username})) });
        const game: Game={ id: randomUUID(),lobbyId: id,status: 'IN_PROGRESS',startedAt: setup.startedAt,finishedAt: null,winner: null,
          discussionDurationSeconds: l.discussionDurationSeconds,voteDurationSeconds: l.voteDurationSeconds,nightDurationSeconds: l.nightDurationSeconds,
          participants: setup.participants.map((p) => ({ ...p,id: randomUUID(),status: 'ALIVE',eliminatedAt: null })),
          phases: [{ id: randomUUID(),type: 'NIGHT',cycle: 1,startedAt: setup.startedAt,deadline: setup.deadline,resolvedAt: null }] };
        gameData.set(game.id,game); memory.data.get(id)!.status='IN_GAME';memory.data.get(id)!.gameId=game.id;
        return structuredClone(game);
      }),
    };
    return new GameService(repository,() => startTime,(upper) => upper-1);
  });
  return { ...f,gameData };
}
