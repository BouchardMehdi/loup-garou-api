import { randomBytes } from 'node:crypto';
import { AccountError, type PasswordHasher, type UserRepository } from './domain.js';

export class AccountService {
  private constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly dummyHash: string,
  ) {}

  static async create(users: UserRepository, passwords: PasswordHasher) {
    // Unknown accounts still perform a real password verification.
    return new AccountService(users, passwords, await passwords.hash(randomBytes(32).toString('hex')));
  }

  async register(input: { username: string; email: string; password: string }) {
    return this.users.create({ username: input.username.trim(), email: input.email.trim().toLowerCase(),
      passwordHash: await this.passwords.hash(input.password) });
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    const valid = await this.passwords.verify(user?.passwordHash ?? this.dummyHash, password);
    if (!user || !valid) throw new AccountError('INVALID_CREDENTIALS');
    return user;
  }

  async profile(id: string) {
    return this.users.findById(id);
  }
}
