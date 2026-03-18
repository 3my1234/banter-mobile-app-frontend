type Listener = (count: number) => void;

let unreadCount = 0;
const listeners = new Set<Listener>();

const broadcast = () => {
  for (const listener of listeners) {
    listener(unreadCount);
  }
};

export const getMessageUnreadCount = () => unreadCount;

export const setMessageUnreadCount = (count: number) => {
  unreadCount = Math.max(0, Number.isFinite(count) ? Math.trunc(count) : 0);
  broadcast();
};

export const incrementMessageUnreadCount = (delta = 1) => {
  setMessageUnreadCount(unreadCount + delta);
};

export const decrementMessageUnreadCount = (delta = 1) => {
  setMessageUnreadCount(unreadCount - delta);
};

export const subscribeMessageUnreadCount = (listener: Listener) => {
  listeners.add(listener);
  listener(unreadCount);
  return () => {
    listeners.delete(listener);
  };
};
