export type Drink = {
  id: string; sourceRow: number; brand: string; category: string; name: string;
  price: number | null; priceText: string; calories: number | null;
  caffeineText: string; caffeineMin: number | null; caffeineMax: number | null;
  taste: string; notes: string; tea: string[]; milk: string[]; toppings: string[];
  noMilk: boolean; richness: number | null; status: string; allergensVerified: boolean;
};
export type Filters = {
  brand?: string; maxPrice?: number; maxCalories?: number; maxCaffeine?: number;
  milk?: 'any' | 'none' | 'fresh' | 'plant'; tea?: string; topping?: string;
};
export type RecommendInput = { query: string; filters: Filters; likedIds: string[]; dislikedIds: string[]; excludedIds: string[]; limit: number };
export type Understanding = { filters: Filters; warnings: string[]; blocked: boolean; preferences: string[] };
export type Scored = { drink: Drink; score: number };
