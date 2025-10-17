import { paymentMiddleware, Resource } from 'x402-next';
import { facilitator } from '@coinbase/x402';
import { ARTICLES } from './lib/articles';

const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL as Resource;

// Get seller address from environment
const sellerAddress = process.env.SELLER_ADDRESS as `0x${string}`;

if (!sellerAddress) {
  throw new Error('SELLER_ADDRESS environment variable is required');
}

// Create route configurations for each article
const articleRoutes: Record<string, { price: string; network: "base-sepolia"; config?: any }> = {};

ARTICLES.forEach((article) => {
  articleRoutes[`/api/articles/${article.slug}`] = {
    price: article.priceUsd,
    network: "base-sepolia",
    config: {
      description: article.teaser,
    },
  };
});

// Configure payment middleware
export const middleware = paymentMiddleware(
  sellerAddress,
  articleRoutes,
  {url: facilitatorUrl}
);

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    '/articles/:path*',
    '/api/:path*',
  ],
  runtime: "nodejs"
};

