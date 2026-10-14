export type Drink = {
  milkDescription?: string; milkConflict?: boolean;
  sourceSheet?: string; cupSize?: string; region?: string; volumeMl?: number | null;
  priceEstimated?: boolean; caloriesEstimated?: boolean; caffeineEstimated?: boolean; fillMethod?: string; reviewStatus?: string;
  id: string; sourceRow: number; brand: string; category: string; name: string;
  price: number | null; priceText: string; calories: number | null;
  caffeineText: string; caffeineMin: number | null; caffeineMax: number | null;
  taste: string; notes: string; tea: string[]; milk: string[]; toppings: string[];
  noMilk: boolean; richness: number | null; status: string; allergensVerified: boolean;
};
export type Filters = {
  excludedToppings?:string[];milkTea?:boolean;
  brand?: string; excludedBrands?: string[]; maxPrice?: number; maxCalories?: number; maxCaffeine?: number;
  priceExclusive?:boolean; caloriesExclusive?:boolean; caffeineExclusive?:boolean;
  milk?: 'any' | 'none' | 'fresh' | 'plant'; tea?: string; topping?: string; toppings?: string[];
};
export type RecommendInput = { query: string; filters: Filters; likedIds: string[]; dislikedIds: string[]; excludedIds: string[]; limit: number };
export type Understanding = { filters: Filters; warnings: string[]; blocked: boolean; preferences: string[] };
export type Scored = { drink: Drink; score: number };
