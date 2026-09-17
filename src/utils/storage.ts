import { del, get, set } from 'idb-keyval';

import type { PersistedEnvelope } from '@/types';

const STORAGE_VERSION = 1;
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 365;

const prefixed = (key: string) => `reswap:${key}`;

export const STORAGE_KEYS = {
  currentUserId: prefixed('current-user-id'),
  users: prefixed('users'),
  items: prefixed('items'),
  exchanges: prefixed('exchanges'),
  appointments: prefixed('appointments'),
  theme: prefixed('theme'),
  lastClean: prefixed('last-clean'),
};

const now = () => Date.now();

const envelope = <T>(payload: T, ttl = DEFAULT_TTL): PersistedEnvelope<T> => ({
  version: STORAGE_VERSION,
  expiresAt: now() + ttl,
  payload,
});

const toPlain = <T>(payload: T): T => JSON.parse(JSON.stringify(payload)) as T;

const isExpired = <T>(data: PersistedEnvelope<T> | null) => {
  if (!data) return false;
  return Boolean(data.expiresAt && data.expiresAt < now());
};

const parseLocal = <T>(key: string): PersistedEnvelope<T> | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedEnvelope<T>;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

const writeLocal = <T>(key: string, payload: T, ttl?: number) => {
  localStorage.setItem(key, JSON.stringify(envelope(payload, ttl)));
};

export class StorageConflictError extends Error {
  constructor(key: string, expectedRevision: number | null, actualRevision: number | null) {
    super(`存储版本冲突（key=${key}, 期望版本=${expectedRevision ?? '空'}, 实际版本=${actualRevision ?? '空'}）`);
    this.name = 'StorageConflictError';
  }
}

interface RevisionedDoc {
  revision?: number;
}

export const readLocalPayload = <T>(key: string): T | null => {
  const localEnvelope = parseLocal<T>(key);
  if (isExpired(localEnvelope)) return null;
  if (localEnvelope?.version === STORAGE_VERSION) return localEnvelope.payload;
  return null;
};

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const localEnvelope = parseLocal<T>(key);
    if (isExpired(localEnvelope)) {
      await this.remove(key);
      return fallback;
    }
    if (localEnvelope?.version === STORAGE_VERSION) {
      return localEnvelope.payload;
    }

    const indexedEnvelope = await get<PersistedEnvelope<T>>(key);
    if (isExpired(indexedEnvelope ?? null)) {
      await this.remove(key);
      return fallback;
    }
    if (indexedEnvelope?.version === STORAGE_VERSION) {
      writeLocal(key, indexedEnvelope.payload);
      return indexedEnvelope.payload;
    }
    return fallback;
  },

  async set<T>(key: string, payload: T, ttl?: number): Promise<T> {
    const plainPayload = toPlain(payload);
    const packed = envelope(plainPayload, ttl);
    localStorage.setItem(key, JSON.stringify(packed));
    await set(key, packed);
    return plainPayload;
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
    await del(key);
  },

  // 乐观并发 + 原子提交：
  // 1. 提交前重读 localStorage（其他标签页的写入立即可见），校验文档 revision 必须与读取时一致；
  // 2. 同一同步执行段内完成"写入 + 回读校验"，中途没有 await，杜绝同进程交叉写入；
  // 3. 回读内容与待写不一致则立刻回滚到旧信封并抛出；
  // 4. 最后才写 IndexedDB，失败时用旧信封回滚 localStorage，保证双存储最终一致。
  // 任一步失败：新旧状态都不会被部分落盘（全部回滚）。
  async commitChecked<T extends RevisionedDoc>(key: string, expectedRevision: number | null, next: T): Promise<T> {
    const freshEnvelope = parseLocal<T>(key);
    const fresh = freshEnvelope?.version === STORAGE_VERSION ? freshEnvelope.payload : null;
    const freshRevision = fresh?.revision ?? null;
    if (freshRevision !== expectedRevision) {
      throw new StorageConflictError(key, expectedRevision, freshRevision);
    }

    const nextDoc = { ...toPlain(next), revision: (expectedRevision ?? 0) + 1 };
    const nextEnvelope = envelope(nextDoc);
    const previousEnvelope = localStorage.getItem(key);

    try {
      localStorage.setItem(key, JSON.stringify(nextEnvelope));
      const readBack = parseLocal<T & RevisionedDoc>(key);
      const readBackJson = JSON.stringify(readBack?.payload ?? null);
      if (readBack?.version !== STORAGE_VERSION || readBackJson !== JSON.stringify(nextDoc)) {
        if (previousEnvelope === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previousEnvelope);
        throw new Error('提交后回读不一致，已回滚');
      }
    } catch (error) {
      if (previousEnvelope === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previousEnvelope);
      throw error instanceof StorageConflictError
        ? error
        : new Error('本地原子提交失败，已回滚');
    }

    try {
      await set(key, nextEnvelope);
    } catch {
      if (previousEnvelope === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previousEnvelope);
      await del(key).catch(() => undefined);
      throw new Error('持久化到 IndexedDB 失败，已回滚');
    }
    return nextDoc;
  },

  async cleanExpired(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS);
    await Promise.all(
      keys.map(async (key) => {
        const localEnvelope = parseLocal<unknown>(key);
        if (isExpired(localEnvelope)) {
          await this.remove(key);
        }
      }),
    );
    localStorage.setItem(STORAGE_KEYS.lastClean, JSON.stringify(envelope(new Date().toISOString())));
  },

  createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  },
};
