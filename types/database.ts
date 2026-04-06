// Types for Supabase public schema
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface ProfileThemeSettings {
  background_color?: string | null;
  text_color?: string | null;
  highlight_color?: string | null;
  font_style?: string | null;
  youtube_urls?: string[] | null;
  music_player_urls?: string[] | null;
  custom_emojis?: string[] | null;
}

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  theme_settings: ProfileThemeSettings | null;
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

export interface UserFollow {
  follower_id: string;
  followed_id: string;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string | null;
  reported_user_id: string | null;
  reason: string;
  created_at: string;
}

export interface Suggestion {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  message: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: Profile;
      posts: Post;
      post_comments: PostComment;
      post_reactions: PostReaction;
      notifications: Notification;
      user_follows: UserFollow;
      reports: Report;
      suggestions: Suggestion;
    };
  };
}
