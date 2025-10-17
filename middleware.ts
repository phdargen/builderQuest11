import { paymentMiddleware, Resource } from 'x402-next';
import { facilitator } from '@coinbase/x402';
import { getArticle } from './lib/articles';
import { NextRequest, NextResponse } from 'next/server';

const network = (process.env.NEXT_PUBLIC_NETWORK || "base-sepolia") as "base-sepolia" | "base";
const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL as Resource;

// Get seller address from environment (for upload fees)
const sellerAddress = process.env.SELLER_ADDRESS as `0x${string}`;

if (!sellerAddress) {
  throw new Error('SELLER_ADDRESS environment variable is required');
}

// Facilitator config
const facilitatorConfig = network === "base-sepolia" ? {url: facilitatorUrl} : facilitator;

// Conditional middleware that routes payments based on the request path
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Handle upload route with global seller address (platform fee)
  if (pathname === '/api/upload') {
    const uploadMw = paymentMiddleware(
      sellerAddress,
      {
        '/api/upload': {
          price: "$0.10",
          network: network,
          config: {
            description: "Upload an article to Base Post",
          },
        },
      },
      facilitatorConfig
    );
    return uploadMw(request);
  }
  
  // Handle article routes with author's address
  if (pathname.startsWith('/api/articles/')) {
    // Extract slug from pathname (e.g., /api/articles/my-article or /api/articles/my-article/purchase)
    const pathParts = pathname.split('/api/articles/')[1].split('/');
    const slug = pathParts[0];
    
    // Load the specific article
    const article = await getArticle(slug);
    
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }
    
    // Create payment middleware for this article using the author's address
    const articleMw = paymentMiddleware(
      article.authorAddress as `0x${string}`,
      {
        [`/api/articles/${slug}`]: {
          price: article.priceUsd,
          network: network,
          config: {
            description: article.teaser,
          },
        },
      },
      facilitatorConfig
    );
    return articleMw(request);
  }
  
  // Default: allow other requests through
  return NextResponse.next();
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    '/articles/:path*',
    '/api/:path*',
  ],
  runtime: "nodejs"
};

