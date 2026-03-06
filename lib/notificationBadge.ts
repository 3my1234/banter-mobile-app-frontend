type Listener = (count: number) => void;

let unreadCount = 0;
const listeners = new Set<Listener>();

const broadcast = () => {
  for (const listener of listeners) {
    listener(unreadCount);
  }
};

export const getNotificationUnreadCount = () => unreadCount;

export const setNotificationUnreadCount = (count: number) => {
  unreadCount = Math.max(0, Number.isFinite(count) ? Math.trunc(count) : 0);
  broadcast();
};

export const incrementNotificationUnreadCount = (delta = 1) => {
  setNotificationUnreadCount(unreadCount + delta);
};

export const decrementNotificationUnreadCount = (delta = 1) => {
  setNotificationUnreadCount(unreadCount - delta);
};

export const subscribeNotificationUnreadCount = (listener: Listener) => {
  listeners.add(listener);
  listener(unreadCount);
  return () => {
    listeners.delete(listener);
  };
};
