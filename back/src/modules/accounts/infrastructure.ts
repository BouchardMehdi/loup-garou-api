import argon2 from 'argon2';
import { AccountError, type PasswordHasher, type UserRepository } from './domain.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

export const argonPasswords: PasswordHasher = {
  hash: (password) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  verify: (hash, password) => argon2.verify(hash, password),
};

export function prismaUsers(prisma: PrismaClient): UserRepository {
  return {
    findById: (id) => prisma.user.findUnique({ where: { id } }),
    findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
    create: async (input) => {
      try {
        return await prisma.user.create({ data: { ...input, usernameKey: input.username.toLowerCase() } });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          throw new AccountError('ACCOUNT_EXISTS');
        }
        throw error;
      }
    },
  };
}
