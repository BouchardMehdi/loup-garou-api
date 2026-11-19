export type RoleCode = 'VILLAGER' | 'WEREWOLF' | 'SEER';
export type Team = 'VILLAGE' | 'WEREWOLVES';
export type GameStatus = 'IN_PROGRESS' | 'FINISHED';
export type ParticipantStatus = 'ALIVE' | 'DEAD';
export type PhaseType = 'NIGHT' | 'DAY_DISCUSSION' | 'DAY_VOTE';
export interface GameParticipant {
  id: string; userId: string; username: string; role: RoleCode; status: ParticipantStatus; eliminatedAt: Date | null;
}
export interface GamePhase {
  id: string; type: PhaseType; cycle: number; startedAt: Date; deadline: Date; resolvedAt: Date | null;
}
export interface Game {
  id: string; lobbyId: string; status: GameStatus; startedAt: Date; finishedAt: Date | null; winner: Team | null;
  discussionDurationSeconds: number; voteDurationSeconds: number; nightDurationSeconds: number;
  participants: GameParticipant[]; phases: GamePhase[];
}
export interface StartLobby {
  id: string; ownerId: string; status: string; capacity: number;
  discussionDurationSeconds: number; voteDurationSeconds: number; nightDurationSeconds: number;
  members: Array<{ userId: string; username: string }>;
}
export interface GameSetup {
  startedAt: Date; deadline: Date;
  participants: Array<{ userId: string; username: string; role: RoleCode }>;
}
export interface GameRepository {
  // prepare executes while the parent lobby is locked; all writes commit together.
  start(lobbyId: string, prepare: (lobby: StartLobby) => GameSetup): Promise<Game>;
  find(id: string): Promise<Game | null>;
}
export type GameErrorCode = 'GAME_NOT_FOUND' | 'LOBBY_NOT_FOUND' | 'START_FORBIDDEN' | 'LOBBY_NOT_WAITING' | 'PLAYER_COUNT_INVALID' | 'GAME_ALREADY_STARTED';
export class GameError extends Error {
  constructor(public readonly code: GameErrorCode) { super(code); }
}
export function teamOf(role: RoleCode): Team { return role === 'WEREWOLF' ? 'WEREWOLVES' : 'VILLAGE'; }
