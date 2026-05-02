type LiveChatMessage = {
  id: string;
  hostUserId: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  message: string;
  createdAt: string;
};

const MAX_CHAT_MESSAGES_PER_HOST = 120;

const globalStore = globalThis as typeof globalThis & {
  __liveChatByHost?: Map<string, LiveChatMessage[]>;
};

function getStore() {
  if (!globalStore.__liveChatByHost) {
    globalStore.__liveChatByHost = new Map<string, LiveChatMessage[]>();
  }

  return globalStore.__liveChatByHost;
}

export function listLiveChatMessages(hostUserId: string) {
  return getStore().get(hostUserId) || [];
}

export function appendLiveChatMessage(message: LiveChatMessage) {
  const store = getStore();
  const previous = store.get(message.hostUserId) || [];
  const next = [...previous, message];

  if (next.length > MAX_CHAT_MESSAGES_PER_HOST) {
    next.splice(0, next.length - MAX_CHAT_MESSAGES_PER_HOST);
  }

  store.set(message.hostUserId, next);
  return next;
}

export function clearLiveChatMessages(hostUserId: string) {
  getStore().delete(hostUserId);
}

export type { LiveChatMessage };
