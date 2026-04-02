// Types for Supabase public schema
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  comments_count: number;
  is_for_sale: boolean;
  created_at: string;
}

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface PostReaction {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  actor_name: string;
  type: 'like' | 'comment' | 'follow';
  post_id: string | null;
  read: boolean;
  created_at: string;
  message: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: Profile;
      posts: Post;
      post_comments: PostComment;
      post_reactions: PostReaction;
      notifications: Notification;
    };
  };
}
