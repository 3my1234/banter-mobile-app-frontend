type FollowListener = (userId: string, isFollowing: boolean) => void;

const listeners = new Set<FollowListener>();
const state: Record<string, boolean> = {};

export const getFollowStatus = (userId: string) => state[userId];

export const setFollowStatus = (userId: string, isFollowing: boolean) => {
  if (!userId) return;
  state[userId] = isFollowing;
  listeners.forEach((listener) => listener(userId, isFollowing));
};

export const subscribeFollowStatus = (listener: FollowListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
