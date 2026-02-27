export type PendingPost = {
  id: string;
  content: string;
  media?: { type: "image" | "video"; uri: string; ratio?: number };
  isRoast: boolean;
  createdAt: string;
  tags?: string[];
  league?: string | null;
  progress?: number;
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
  return () => {
    listeners.delete(listener);
  };
};

export const addPendingPost = (post: PendingPost) => {
  pendingPosts = [post, ...pendingPosts];
  emit();
};

export const updatePendingPost = (
  id: string,
  updates: Partial<PendingPost>
) => {
  pendingPosts = pendingPosts.map((post) =>
    post.id === id ? { ...post, ...updates } : post
  );
  emit();
};

export const removePendingPost = (id: string) => {
  pendingPosts = pendingPosts.filter((post) => post.id !== id);
  emit();
};
