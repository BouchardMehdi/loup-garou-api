export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: { username: string; email: string; passwordHash: string }): Promise<User>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export class AccountError extends Error {
  constructor(public readonly code: 'ACCOUNT_EXISTS' | 'INVALID_CREDENTIALS') {
    super(code);
  }
}

export function personalProfile(user: User) {
  return { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt.toISOString() };
}
