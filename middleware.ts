import { paymentMiddleware, Resource } from 'x402-next';
import { facilitator } from '@coinbase/x402';
import { getArticles } from './lib/articles';
import { NextRequest, NextResponse } from 'next/server';

const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL as Resource;

// Get seller address from environment
const sellerAddress = process.env.SELLER_ADDRESS as `0x${string}`;

if (!sellerAddress) {
  throw new Error('SELLER_ADDRESS environment variable is required');
}

// Dynamic middleware that loads article routes on each request
export async function middleware(request: NextRequest) {
  // Load articles dynamically
  const articles = await getArticles();
  
  // Create route configurations for each article
  const articleRoutes: Record<string, { price: string; network: "base-sepolia"; config?: any }> = {};

  articles.forEach((article) => {
    articleRoutes[`/api/articles/${article.slug}`] = {
      price: article.priceUsd,
      network: "base-sepolia",
      config: {
        description: article.teaser,
      },
    };
  });

  // Add upload route
  articleRoutes['/api/upload'] = {
    price: "$0.10",
    network: "base-sepolia",
    config: {
      description: "Upload an article to Based News",
    },
  };

  // Create and run payment middleware
  const paymentMw = paymentMiddleware(
    sellerAddress,
    articleRoutes,
    {url: facilitatorUrl}
  );

  return paymentMw(request);
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    '/articles/:path*',
    '/api/:path*',
  ],
  runtime: "nodejs"
};

