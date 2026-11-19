import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { GameError, type Game, type GameRepository, type RoleCode } from './domain.js';

const include = { participants: { orderBy: { id: 'asc' } }, phases: { orderBy: [{ cycle: 'asc' },{ startedAt: 'asc' }] } } satisfies Prisma.GameInclude;
type StoredGame = Prisma.GameGetPayload<{ include: typeof include }>;
function role(code: string): RoleCode {
  if (code==='VILLAGER' || code==='WEREWOLF' || code==='SEER') return code;
  throw new Error('Unsupported persisted role');
}
function map(game: StoredGame): Game {
  return { id: game.id,lobbyId: game.lobbyId,status: game.status,startedAt: game.startedAt,finishedAt: game.finishedAt,winner: game.winner,
    discussionDurationSeconds: game.discussionDurationSeconds,voteDurationSeconds: game.voteDurationSeconds,nightDurationSeconds: game.nightDurationSeconds,
    participants: game.participants.map((p) => ({ id: p.id,userId: p.userId,username: p.usernameSnapshot,role: role(p.roleCode),status: p.status,eliminatedAt: p.eliminatedAt })),
    phases: game.phases.map((p) => ({ id: p.id,type: p.type,cycle: p.cycle,startedAt: p.startedAt,deadline: p.deadline,resolvedAt: p.resolvedAt })) };
}
export function prismaGames(prisma: PrismaClient): GameRepository {
  return {
    find: async (id) => { const game=await prisma.game.findUnique({ where: { id },include });return game ? map(game) : null; },
    start: async (lobbyId,prepare) => {
      try {
        return await prisma.$transaction(async (tx) => {
          // Same parent-row lock as lobby join/leave: one coherent snapshot at launch.
          const rows=await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Lobby" WHERE id = ${lobbyId}::uuid FOR UPDATE`;
          if (!rows.length) throw new GameError('LOBBY_NOT_FOUND');
          const lobby=await tx.lobby.findUniqueOrThrow({ where: { id: lobbyId },include: {
            memberships: { where: { leftAt: null },select: { userId: true,user: { select: { username: true } } },orderBy: [{ joinedAt: 'asc' },{ id: 'asc' }] },
          } });
          const setup=prepare({ ...lobby,members: lobby.memberships.map((m) => ({ userId: m.userId,username: m.user.username })) });
          const game=await tx.game.create({ data: {
            lobbyId,status: 'IN_PROGRESS',startedAt: setup.startedAt,
            discussionDurationSeconds: lobby.discussionDurationSeconds,voteDurationSeconds: lobby.voteDurationSeconds,nightDurationSeconds: lobby.nightDurationSeconds,
            participants: { create: setup.participants.map((p) => ({ userId: p.userId,usernameSnapshot: p.username,roleCode: p.role,status: 'ALIVE' })) },
            phases: { create: { type: 'NIGHT',cycle: 1,startedAt: setup.startedAt,deadline: setup.deadline } },
          },include });
          await tx.lobby.update({ where: { id: lobbyId },data: { status: 'IN_GAME' } });
          return map(game);
        }, { isolationLevel: 'ReadCommitted',timeout: 10000 });
      } catch (error) {
        if (typeof error==='object' && error!==null && 'code' in error && error.code==='P2002') throw new GameError('GAME_ALREADY_STARTED');
        throw error;
      }
    },
  };
}
