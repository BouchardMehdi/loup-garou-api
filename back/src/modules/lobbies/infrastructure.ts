import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { LobbyError, type Lobby, type LobbyRepository } from './domain.js';

const include = {
  game: { select: { id: true } },
  owner: { select: { id: true, username: true } },
  memberships: { where: { leftAt: null }, select: { id: true, userId: true, joinedAt: true,
    user: { select: { username: true } } }, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.LobbyInclude;
type StoredLobby = Prisma.LobbyGetPayload<{ include: typeof include }>;
function map(lobby: StoredLobby): Lobby {
  return { id: lobby.id, name: lobby.name, visibility: lobby.visibility, status: lobby.status,
    gameId: lobby.game?.id ?? null,
    capacity: lobby.capacity, owner: lobby.owner, invitationHash: lobby.invitationHash,
    discussionDurationSeconds: lobby.discussionDurationSeconds, voteDurationSeconds: lobby.voteDurationSeconds,
    nightDurationSeconds: lobby.nightDurationSeconds, createdAt: lobby.createdAt,
    members: lobby.memberships.map((m) => ({ id: m.id, userId: m.userId, username: m.user.username, joinedAt: m.joinedAt })) };
}

export function prismaLobbies(prisma: PrismaClient): LobbyRepository {
  return {
    create: async (ownerId, settings, invitationHash) => map(await prisma.lobby.create({
      data: { ...settings, ownerId, invitationHash, memberships: { create: { userId: ownerId } } }, include,
    })),
    find: async (id) => {
      const lobby = await prisma.lobby.findUnique({ where: { id }, include });
      return lobby ? map(lobby) : null;
    },
    listPublic: async (page, pageSize) => {
      const where = { visibility: 'PUBLIC', status: 'WAITING' } as const;
      const [total, lobbies] = await prisma.$transaction([
        prisma.lobby.count({ where }),
        prisma.lobby.findMany({ where, include, skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      ], { isolationLevel: 'RepeatableRead' });
      return { total, lobbies: lobbies.map(map) };
    },
    withLockedLobby: async (id, work) => prisma.$transaction(async (tx) => {
      // All membership mutations serialize on the parent row, across API instances.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw new LobbyError('LOBBY_NOT_FOUND');
      const read = async () => map(await tx.lobby.findUniqueOrThrow({ where: { id }, include }));
      return work({
        lobby: await read(),
        addMember: async (userId) => { await tx.lobbyMembership.create({ data: { lobbyId: id, userId } }); },
        leaveMember: async (membershipId) => { await tx.lobbyMembership.update({ where: { id: membershipId }, data: { leftAt: new Date() } }); },
        transferOwnership: async (ownerId) => { await tx.lobby.update({ where: { id }, data: { ownerId } }); },
        close: async () => { await tx.lobby.update({ where: { id }, data: { status: 'CLOSED' } }); },
        reload: read,
      });
    }, { isolationLevel: 'ReadCommitted', timeout: 10000 }),
  };
}
