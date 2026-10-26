export interface FriendUser {
  id: string;
  name: string;
  email: string;
}

export interface FriendEntry {
  friendshipId: string;
  user: FriendUser;
  since: string;
}

export interface FriendRequest {
  id: string;
  user: FriendUser;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface FriendsOverview {
  friends: FriendEntry[];
  requests: FriendRequest[];
}

export interface ActivityEvent {
  id: string;
  type: 'clip' | 'annotation' | 'friend';
  actor: { id: string; name: string };
  clipId?: string;
  clipTitle?: string;
  text?: string;
  at: string;
}
