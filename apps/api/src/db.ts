import { PrismaClient, type Prisma } from '@prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
