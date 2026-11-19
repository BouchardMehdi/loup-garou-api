export type LobbyVisibility = 'PUBLIC' | 'PRIVATE';
export type LobbyStatus = 'WAITING' | 'IN_GAME' | 'FINISHED' | 'CLOSED';

export interface LobbySettings {
  name: string;
  visibility: LobbyVisibility;
  capacity: number;
  discussionDurationSeconds: number;
  voteDurationSeconds: number;
  nightDurationSeconds: number;
}
export interface LobbyMember {
  id: string;
  userId: string;
  username: string;
  joinedAt: Date;
}
export interface Lobby extends LobbySettings {
  id: string;
  status: LobbyStatus;
  owner: { id: string; username: string };
  invitationHash: string | null;
  createdAt: Date;
  members: LobbyMember[];
}
export interface LobbyTransaction {
  lobby: Lobby;
  addMember(userId: string): Promise<void>;
  leaveMember(id: string): Promise<void>;
  transferOwnership(userId: string): Promise<void>;
  close(): Promise<void>;
  reload(): Promise<Lobby>;
}
export interface LobbyRepository {
  create(ownerId: string, settings: LobbySettings, invitationHash: string | null): Promise<Lobby>;
  find(id: string): Promise<Lobby | null>;
  listPublic(page: number, pageSize: number): Promise<{ total: number; lobbies: Lobby[] }>;
  withLockedLobby<T>(id: string, work: (transaction: LobbyTransaction) => Promise<T>): Promise<T>;
}
export type LobbyErrorCode = 'LOBBY_NOT_FOUND' | 'INVALID_LOBBY' | 'LOBBY_FULL' | 'ALREADY_MEMBER' | 'LOBBY_NOT_WAITING';
export class LobbyError extends Error {
  constructor(public readonly code: LobbyErrorCode) { super(code); }
}
