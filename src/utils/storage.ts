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

  /**
   * 单 key 原子事务：读取最新快照 -> 交由 mutator 产生下一版 -> 一次性整体写回。
   *
   * - 同标签页内通过按 key 串行的 Promise 队列互斥，杜绝两个操作交错读到旧快照；
   * - 多标签页通过 expectedRevision 乐观锁：提交前重新读取，revision 已被其他
   *   标签页推进则整个事务回滚重试，保证「两个时段不会同时生效」；
   * - mutator 内抛错即放弃写回（全部回滚），不会出现预约与时段占用写一半。
   *
   * 注意：localStorage 的 setItem 对单个 key 是原子的，预约记录与时段占用打包在
   * 同一个 key 的同一个 envelope 内，因此「预约 + 双方确认 + 时段占用」一次落盘。
   */
  async transaction<T>(
    key: string,
    fallback: T,
    mutator: (snapshot: T) => T | Promise<T>,
    options: { getRevision?: (snapshot: T) => number; bumpRevision?: (snapshot: T, next: T) => T } = {},
  ): Promise<T> {
    const queue = transactionQueues.get(key) ?? Promise.resolve();
    const run = queue.then(async () => {
      const beforeRead = await this.get<T>(key, fallback);
      const expectedRevision = options.getRevision?.(beforeRead) ?? 0;
      const next = await mutator(beforeRead);
      if (options.getRevision) {
        const latest = await this.get<T>(key, fallback);
        if (options.getRevision(latest) !== expectedRevision) {
          throw new Error('数据已被其他页面更新，请刷新后重试');
        }
      }
      const committed = options.bumpRevision ? options.bumpRevision(beforeRead, next) : next;
      await this.set(key, committed);
      return committed;
    });
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    transactionQueues.set(key, tail);
    return run;
  },
};

const transactionQueues = new Map<string, Promise<void>>();
