import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { LobbyError, type Lobby, type LobbyRepository, type LobbySettings } from './domain.js';

function hash(code: string) { return createHash('sha256').update(code.trim().toUpperCase()).digest('hex'); }

function validateSettings(settings: LobbySettings) {
  const durations = [settings.discussionDurationSeconds, settings.voteDurationSeconds, settings.nightDurationSeconds];
  if (settings.name.trim().length < 3 || settings.name.trim().length > 80 || Array.from(settings.name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      !['PUBLIC', 'PRIVATE'].includes(settings.visibility) || !Number.isInteger(settings.capacity) ||
      settings.capacity < 6 || settings.capacity > 12 || durations.some((n) => !Number.isInteger(n) || n < 30 || n > 300)) {
    throw new LobbyError('INVALID_LOBBY');
  }
}

export class LobbyService {
  constructor(private readonly repository: LobbyRepository) {}

  async create(ownerId: string, settings: LobbySettings) {
    validateSettings(settings);
    const invitationCode = settings.visibility === 'PRIVATE' ? randomBytes(12).toString('hex').toUpperCase() : undefined;
    const lobby = await this.repository.create(ownerId, { ...settings, name: settings.name.trim() }, invitationCode ? hash(invitationCode) : null);
    return { lobby, ...(invitationCode ? { invitationCode } : {}) };
  }

  async list(page: number, pageSize: number) {
    return this.repository.listPublic(page, pageSize);
  }

  async get(id: string, userId: string) {
    const lobby = await this.repository.find(id);
    if (!lobby || !(lobby.members.some((m) => m.userId === userId) ||
        (lobby.visibility === 'PUBLIC' && lobby.status === 'WAITING'))) throw new LobbyError('LOBBY_NOT_FOUND');
    return lobby;
  }

  async join(id: string, userId: string, invitationCode?: string) {
    return this.repository.withLockedLobby(id, async (tx) => {
      const lobby = tx.lobby;
      const member = lobby.members.find((m) => m.userId === userId);
      if (lobby.visibility === 'PRIVATE' && !member) {
        const candidate = hash(invitationCode ?? '');
        const expected = lobby.invitationHash;
        if (!expected || candidate.length !== expected.length ||
            !timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) throw new LobbyError('LOBBY_NOT_FOUND');
      }
      if (lobby.status !== 'WAITING') throw new LobbyError('LOBBY_NOT_WAITING');
      if (member) throw new LobbyError('ALREADY_MEMBER');
      if (lobby.members.length >= lobby.capacity) throw new LobbyError('LOBBY_FULL');
      await tx.addMember(userId);
      return tx.reload();
    });
  }

  async leave(id: string, userId: string) {
    await this.repository.withLockedLobby(id, async (tx) => {
      const member = tx.lobby.members.find((m) => m.userId === userId);
      if (!member) throw new LobbyError('LOBBY_NOT_FOUND');
      if (tx.lobby.status !== 'WAITING') throw new LobbyError('LOBBY_NOT_WAITING');
      const remaining = tx.lobby.members.filter((m) => m.userId !== userId)
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id));
      await tx.leaveMember(member.id);
      if (!remaining.length) await tx.close();
      else if (tx.lobby.owner.id === userId) await tx.transferOwnership(remaining[0]!.userId);
    });
  }
}

// Explicit projection: no hash, invitation code, email or membership history.
export function lobbySummary(lobby: Lobby) {
  return { id: lobby.id, name: lobby.name, visibility: lobby.visibility, status: lobby.status,
    capacity: lobby.capacity, memberCount: lobby.members.length, owner: lobby.owner,
    discussionDurationSeconds: lobby.discussionDurationSeconds,
    voteDurationSeconds: lobby.voteDurationSeconds, nightDurationSeconds: lobby.nightDurationSeconds,
    createdAt: lobby.createdAt.toISOString() };
}
