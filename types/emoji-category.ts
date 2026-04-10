// Types for emoji categories
export interface EmojiCategory {
  id: string;
  name: string;
  order: number;
}

export interface EmojiCategoryMap {
  [categoryId: string]: {
    id: string;
    name: string;
    order: number;
    emojiIds: string[];
  };
}
