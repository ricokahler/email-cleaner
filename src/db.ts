import { JSONFilePreset } from 'lowdb/node';
import type { Message } from './messages';
import type { Classification } from './classify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const dbPath = path.resolve(rootDir, './db.json');

export interface Entry {
  id: string;
  message?: Message;
  classification?: Classification;
  unsubscribeLink?: string;
  markedUnsubscribed?: boolean;
}

export const db = await JSONFilePreset(dbPath, { entries: [] as Entry[] });

export async function ensure<TProperty extends keyof Entry>(
  id: string,
  property: TProperty,
  getter: () =>
    | NonNullable<Entry[TProperty]>
    | Promise<NonNullable<Entry[TProperty]>>,
): Promise<NonNullable<Entry[TProperty]>> {
  await db.read();
  const cached = db.data.entries.find((entry) => entry.id === id)?.[property];
  if (cached) return cached;

  const result = await getter();

  await db.update(({ entries }) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      entries.push({ id, [property]: result });
    } else {
      entries[index] = { ...entries[index], [property]: result };
    }
  });

  return result;
}

export async function set<TProperty extends keyof Entry>(
  id: string,
  property: TProperty,
  value: NonNullable<Entry[TProperty]>,
) {
  await db.read();

  await db.update(({ entries }) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      entries.push({ id, [property]: value });
    } else {
      entries[index] = { ...entries[index], [property]: value };
    }
  });
}

export async function isProcessed(id: string) {
  await db.read();
  const entry = db.data.entries.find((entry) => entry.id === id);

  if (!entry) return false;
  if (!entry.classification) return false;
  if (entry.classification !== 'promotional') return true;
  return !!entry.unsubscribeLink;
}
