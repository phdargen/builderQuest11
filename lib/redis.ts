import { Redis } from '@upstash/redis';

// Initialize Redis client with environment variables
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export interface PurchaseRecord {
  universalAddress: string;
  subAccountAddress: string;
  username: string;
  displayName: string;
  pfpUrl: string | null;
  timestamp: number;
}

export interface RatingRecord {
  score: number;
  timestamp: number;
}

export interface ArticleStats {
  totalPurchases: number; // Total number of purchases (includes repeat purchases)
  uniquePurchasers: number; // Number of unique purchasers
  lastPurchaseTimestamp: number | null;
  purchasedBy: string[];
  recentPurchases: PurchaseRecord[]; // Last 10 purchases with user info
  averageScore: number | null;
  totalRatings: number;
}

// Helper function to record a purchase
export async function recordPurchase(
  slug: string,
  universalAddress: string,
  subAccountAddress: string,
  username: string,
  displayName: string,
  pfpUrl: string | null
): Promise<void> {
  const record: PurchaseRecord = {
    universalAddress,
    subAccountAddress,
    username,
    displayName,
    pfpUrl,
    timestamp: Date.now(),
  };
  
  // Store latest purchase info per user (hash key = universalAddress)
  // and increment total purchase counter
  await Promise.all([
    redis.hset(
      `article:${slug}:purchases`,
      { [universalAddress]: JSON.stringify(record) }
    ),
    redis.incr(`article:${slug}:purchase_count`)
  ]);
}

// Helper function to record or update a rating
export async function recordRating(
  slug: string,
  universalAddress: string,
  score: number
): Promise<void> {
  if (score < 1 || score > 5) {
    throw new Error('Score must be between 1 and 5');
  }

  const record: RatingRecord = {
    score,
    timestamp: Date.now(),
  };
  
  await redis.hset(
    `article:${slug}:ratings`,
    { [universalAddress]: JSON.stringify(record) }
  );
}

// Helper function to get a user's rating for an article
export async function getUserRating(
  slug: string,
  universalAddress: string
): Promise<RatingRecord | null> {
  const rating = await redis.hget(`article:${slug}:ratings`, universalAddress);
  if (!rating) return null;
  // Handle both string and already-parsed object formats
  return typeof rating === 'string' ? JSON.parse(rating) as RatingRecord : rating as RatingRecord;
}

// Helper function to get stats for a single article
export async function getArticleStats(slug: string): Promise<ArticleStats> {
  const [purchases, ratings, purchaseCount] = await Promise.all([
    redis.hgetall(`article:${slug}:purchases`),
    redis.hgetall(`article:${slug}:ratings`),
    redis.get(`article:${slug}:purchase_count`),
  ]);

  const purchaseRecords = purchases as Record<string, any> || {};
  const ratingRecords = ratings as Record<string, any> || {};

  const purchasedBy = Object.keys(purchaseRecords);
  const uniquePurchasers = purchasedBy.length;
  const totalPurchases = (purchaseCount as number) || 0;

  // Parse all purchase records and sort by timestamp (most recent first)
  const allPurchases: PurchaseRecord[] = Object.values(purchaseRecords)
    .map((record) => {
      // Handle both string and already-parsed object formats
      return typeof record === 'string' ? JSON.parse(record) : record;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const recentPurchases = allPurchases.slice(0, 10); // Last 10 purchases

  let lastPurchaseTimestamp: number | null = null;
  if (allPurchases.length > 0) {
    lastPurchaseTimestamp = allPurchases[0].timestamp;
  }

  const ratingValues = Object.values(ratingRecords);
  const totalRatings = ratingValues.length;
  let averageScore: number | null = null;

  if (totalRatings > 0) {
    const sum = ratingValues.reduce(
      (acc, record) => {
        // Handle both string and already-parsed object formats
        const ratingData = typeof record === 'string' ? JSON.parse(record) : record;
        return acc + ratingData.score;
      },
      0
    );
    averageScore = sum / totalRatings;
  }

  return {
    totalPurchases,
    uniquePurchasers,
    lastPurchaseTimestamp,
    purchasedBy,
    recentPurchases,
    averageScore,
    totalRatings,
  };
}

// Helper function to get stats for multiple articles efficiently using pipeline
export async function getMultipleArticlesStats(
  slugs: string[]
): Promise<Record<string, ArticleStats>> {
  if (slugs.length === 0) {
    return {};
  }

  const pipeline = redis.pipeline();

  slugs.forEach((slug) => {
    pipeline.hgetall(`article:${slug}:purchases`);
    pipeline.hgetall(`article:${slug}:ratings`);
    pipeline.get(`article:${slug}:purchase_count`);
  });

  const results = await pipeline.exec();
  const statsMap: Record<string, ArticleStats> = {};

  slugs.forEach((slug, index) => {
    const purchasesIndex = index * 3;
    const ratingsIndex = index * 3 + 1;
    const purchaseCountIndex = index * 3 + 2;

    // Upstash pipeline results might be wrapped or unwrapped
    let purchasesData = results[purchasesIndex];
    let ratingsData = results[ratingsIndex];
    let purchaseCountData = results[purchaseCountIndex];
    
    // Check if results are wrapped (e.g., { result: data } or { data: ... })
    if (purchasesData && typeof purchasesData === 'object' && 'result' in purchasesData) {
      purchasesData = (purchasesData as any).result;
    }
    if (ratingsData && typeof ratingsData === 'object' && 'result' in ratingsData) {
      ratingsData = (ratingsData as any).result;
    }
    if (purchaseCountData && typeof purchaseCountData === 'object' && 'result' in purchaseCountData) {
      purchaseCountData = (purchaseCountData as any).result;
    }

    const purchases = (purchasesData as Record<string, any>) || {};
    const ratings = (ratingsData as Record<string, any>) || {};

    const purchasedBy = Object.keys(purchases);
    const uniquePurchasers = purchasedBy.length;
    const totalPurchases = (purchaseCountData as number) || 0;

    // Parse all purchase records and sort by timestamp (most recent first)
    const allPurchases: PurchaseRecord[] = Object.values(purchases)
      .map((record) => {
        // Handle both string and already-parsed object formats
        return typeof record === 'string' ? JSON.parse(record) : record;
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    const recentPurchases = allPurchases.slice(0, 10); // Last 10 purchases

    let lastPurchaseTimestamp: number | null = null;
    if (allPurchases.length > 0) {
      lastPurchaseTimestamp = allPurchases[0].timestamp;
    }

    const ratingValues = Object.values(ratings);
    const totalRatings = ratingValues.length;
    let averageScore: number | null = null;

    if (totalRatings > 0) {
      const sum = ratingValues.reduce(
        (acc, record) => {
          // Handle both string and already-parsed object formats
          const ratingData = typeof record === 'string' ? JSON.parse(record) : record;
          return acc + ratingData.score;
        },
        0
      );
      averageScore = sum / totalRatings;
    }

    statsMap[slug] = {
      totalPurchases,
      uniquePurchasers,
      lastPurchaseTimestamp,
      purchasedBy,
      recentPurchases,
      averageScore,
      totalRatings,
    };
  });

  return statsMap;
}

export default redis;

