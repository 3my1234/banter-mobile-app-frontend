export type PendingPost = {
  id: string;
  content: string;
  media?: { type: "image" | "video"; uri: string; ratio?: number };
  isRoast: boolean;
  createdAt: string;
  tags?: string[];
  league?: string | null;
};

type Listener = (pending: PendingPost[]) => void;

let pendingPosts: PendingPost[] = [];
const listeners = new Set<Listener>();

const emit = () => {
  const snapshot = [...pendingPosts];
  listeners.forEach((listener) => listener(snapshot));
};

export const subscribePendingPosts = (listener: Listener) => {
  listeners.add(listener);
  listener([...pendingPosts]);
  return () => listeners.delete(listener);
};

export const addPendingPost = (post: PendingPost) => {
  pendingPosts = [post, ...pendingPosts];
  emit();
};

export const removePendingPost = (id: string) => {
  pendingPosts = pendingPosts.filter((post) => post.id !== id);
  emit();
};

