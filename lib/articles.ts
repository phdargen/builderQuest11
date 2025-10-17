import { loadArticles, Article } from "./storage";

// Cache articles to avoid repeated storage reads
let articlesCache: Article[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get all articles from storage (with caching)
 */
export async function getArticles(): Promise<Article[]> {
  const now = Date.now();
  
  // Return cached articles if cache is fresh
  if (articlesCache && now - cacheTimestamp < CACHE_TTL) {
    return articlesCache;
  }

  // Load from storage and update cache
  articlesCache = await loadArticles();
  cacheTimestamp = now;
  
  return articlesCache;
}

/**
 * Get a single article by slug
 */
export async function getArticle(slug: string): Promise<Article | undefined> {
  const articles = await getArticles();
  return articles.find((article) => article.slug === slug);
}

/**
 * Invalidate the cache (call after saving a new article)
 */
export function invalidateCache() {
  articlesCache = null;
  cacheTimestamp = 0;
}

export type { Article };

