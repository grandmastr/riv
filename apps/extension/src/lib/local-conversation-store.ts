import type {
  ActionProposal,
  ConversationMessage,
  ConversationThread
} from '@riv/contracts';

export type LocalThreadDetail = {
  thread: ConversationThread;
  messages: ConversationMessage[];
  proposals: ActionProposal[];
};

export interface LocalConversationStore {
  listThreads(): Promise<ConversationThread[]>;
  getLatestThreadDetail(): Promise<LocalThreadDetail | null>;
  getThreadDetail(threadId: string): Promise<LocalThreadDetail | null>;
  upsertThread(thread: ConversationThread): Promise<void>;
  upsertMessage(message: ConversationMessage): Promise<void>;
  upsertProposal(proposal: ActionProposal): Promise<void>;
  removeProposal(threadId: string, proposalId: string): Promise<void>;
}

type DatabaseRecord = {
  id: string;
  threadId: string;
};

const DATABASE_NAME = 'riv-extension-local-conversations';
const DATABASE_VERSION = 1;
const THREADS_STORE = 'threads';
const MESSAGES_STORE = 'messages';
const PROPOSALS_STORE = 'proposals';
const THREAD_ID_INDEX = 'threadId';

function compareIsoAscending(left: string, right: string) {
  return left.localeCompare(right);
}

function sortThreads(threads: ConversationThread[]) {
  return [...threads].sort((left, right) =>
    compareIsoAscending(right.updatedAt, left.updatedAt)
  );
}

function sortMessages(messages: ConversationMessage[]) {
  return [...messages].sort((left, right) =>
    compareIsoAscending(left.createdAt, right.createdAt)
  );
}

function sortProposals(proposals: ActionProposal[]) {
  return [...proposals].sort((left, right) =>
    compareIsoAscending(left.createdAt, right.createdAt)
  );
}

function upsertById<T extends DatabaseRecord>(items: T[], nextItem: T) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index < 0) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[index] = nextItem;
  return nextItems;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export function createInMemoryConversationStore(): LocalConversationStore {
  const threads = new Map<string, ConversationThread>();
  const messages = new Map<string, ConversationMessage[]>();
  const proposals = new Map<string, ActionProposal[]>();

  return {
    async listThreads() {
      return sortThreads([...threads.values()]);
    },
    async getLatestThreadDetail() {
      const [latestThread] = sortThreads([...threads.values()]);

      if (!latestThread) {
        return null;
      }

      return {
        thread: latestThread,
        messages: sortMessages(messages.get(latestThread.id) ?? []),
        proposals: sortProposals(proposals.get(latestThread.id) ?? [])
      };
    },
    async getThreadDetail(threadId) {
      const thread = threads.get(threadId);

      if (!thread) {
        return null;
      }

      return {
        thread,
        messages: sortMessages(messages.get(threadId) ?? []),
        proposals: sortProposals(proposals.get(threadId) ?? [])
      };
    },
    async upsertThread(thread) {
      threads.set(thread.id, thread);
    },
    async upsertMessage(message) {
      const existing = messages.get(message.threadId) ?? [];
      messages.set(message.threadId, sortMessages(upsertById(existing, message)));
    },
    async upsertProposal(proposal) {
      const existing = proposals.get(proposal.threadId) ?? [];
      proposals.set(
        proposal.threadId,
        sortProposals(upsertById(existing, proposal))
      );
    },
    async removeProposal(threadId, proposalId) {
      const existing = proposals.get(threadId) ?? [];
      proposals.set(
        threadId,
        existing.filter((proposal) => proposal.id !== proposalId)
      );
    }
  };
}

export function createIndexedDbConversationStore(
  factory: IDBFactory
): LocalConversationStore {
  let databasePromise: Promise<IDBDatabase> | null = null;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);

        request.onupgradeneeded = () => {
          const database = request.result;

          if (!database.objectStoreNames.contains(THREADS_STORE)) {
            database.createObjectStore(THREADS_STORE, {
              keyPath: 'id'
            });
          }

          if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
            const messageStore = database.createObjectStore(MESSAGES_STORE, {
              keyPath: 'id'
            });
            messageStore.createIndex(THREAD_ID_INDEX, 'threadId', {
              unique: false
            });
          }

          if (!database.objectStoreNames.contains(PROPOSALS_STORE)) {
            const proposalStore = database.createObjectStore(PROPOSALS_STORE, {
              keyPath: 'id'
            });
            proposalStore.createIndex(THREAD_ID_INDEX, 'threadId', {
              unique: false
            });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB database open failed.'));
      });
    }

    return databasePromise;
  }

  async function getAllFromStore<T>(storeName: string) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    const result = await requestToPromise(request as IDBRequest<T[]>);
    await transactionDone(transaction);
    return result;
  }

  async function getAllByThreadId<T>(storeName: string, threadId: string) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction
      .objectStore(storeName)
      .index(THREAD_ID_INDEX)
      .getAll(IDBKeyRange.only(threadId));
    const result = await requestToPromise(request as IDBRequest<T[]>);
    await transactionDone(transaction);
    return result;
  }

  async function putRecord<T>(storeName: string, value: T) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  }

  async function deleteRecord(storeName: string, key: string) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  return {
    async listThreads() {
      const threads = await getAllFromStore<ConversationThread>(THREADS_STORE);
      return sortThreads(threads);
    },
    async getLatestThreadDetail() {
      const [thread] = await this.listThreads();

      if (!thread) {
        return null;
      }

      return this.getThreadDetail(thread.id);
    },
    async getThreadDetail(threadId) {
      const database = await openDatabase();
      const threadTransaction = database.transaction(THREADS_STORE, 'readonly');
      const threadRequest =
        threadTransaction.objectStore(THREADS_STORE).get(threadId);
      const thread = await requestToPromise(
        threadRequest as IDBRequest<ConversationThread | undefined>
      );
      await transactionDone(threadTransaction);

      if (!thread) {
        return null;
      }

      const [messages, proposals] = await Promise.all([
        getAllByThreadId<ConversationMessage>(MESSAGES_STORE, threadId),
        getAllByThreadId<ActionProposal>(PROPOSALS_STORE, threadId)
      ]);

      return {
        thread,
        messages: sortMessages(messages),
        proposals: sortProposals(proposals)
      };
    },
    async upsertThread(thread) {
      await putRecord(THREADS_STORE, thread);
    },
    async upsertMessage(message) {
      await putRecord(MESSAGES_STORE, message);
    },
    async upsertProposal(proposal) {
      await putRecord(PROPOSALS_STORE, proposal);
    },
    async removeProposal(_threadId, proposalId) {
      await deleteRecord(PROPOSALS_STORE, proposalId);
    }
  };
}

let conversationStoreSingleton: LocalConversationStore | null = null;

export function getConversationStore() {
  if (conversationStoreSingleton) {
    return conversationStoreSingleton;
  }

  if (typeof indexedDB === 'undefined') {
    conversationStoreSingleton = createInMemoryConversationStore();
    return conversationStoreSingleton;
  }

  conversationStoreSingleton = createIndexedDbConversationStore(indexedDB);
  return conversationStoreSingleton;
}
