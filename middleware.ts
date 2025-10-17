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
            discoverable: true,
            description: "Upload an article to BasePost - A decentralized news platform where authors can publish and monetize content using x402 payments",
            inputSchema: {
              bodyType: "form-data",
              bodyFields: {
                title: {
                  type: "string",
                  description: "The title of the article",
                  required: true,
                },
                teaser: {
                  type: "string",
                  description: "A short teaser/preview of the article (shown before purchase)",
                  required: true,
                },
                body: {
                  type: "string",
                  description: "The full article content in markdown format",
                  required: true,
                },
                priceUsd: {
                  type: "string",
                  description: "The price to access this article (format: $0.10)",
                  required: true,
                },
                authorAddress: {
                  type: "string",
                  description: "The Ethereum/Base address of the article author (receives payments)",
                  required: true,
                },
                image: {
                  type: "file",
                  description: "Optional cover image for the article",
                },
                imageUrl: {
                  type: "string",
                  description: "Optional URL to an existing cover image (used if image file not provided)",
                },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  description: "Whether the upload was successful",
                },
                slug: {
                  type: "string",
                  description: "The generated URL slug for the article (derived from title)",
                },
                message: {
                  type: "string",
                  description: "Success message confirming upload",
                },
              },
              required: ["success", "slug", "message"],
            },
          },
        },
      },
      facilitatorConfig
    );
    return uploadMw(request);
  }
  
  // Handle article routes with author's address
  if (pathname.startsWith('/api/articles/')) {
    // Extract path parts to check for sub-routes
    const pathAfterArticles = pathname.split('/api/articles/')[1];
    const pathParts = pathAfterArticles.split('/');
    
    // Skip payment middleware for non-article routes:
    // - /api/articles (list all articles)
    // - /api/articles/stats (global stats)
    // - /api/articles/[slug]/purchase (purchase recording)
    // - /api/articles/[slug]/rating (rating endpoints)
    // - /api/articles/[slug]/stats (individual article stats)
    if (
      !pathAfterArticles || // /api/articles
      pathParts.length === 1 && pathParts[0] === 'stats' || // /api/articles/stats
      pathParts.length > 1 && (pathParts[1] === 'purchase' || pathParts[1] === 'rating' || pathParts[1] === 'stats')
    ) {
      return NextResponse.next();
    }
    
    // Only apply payment middleware to /api/articles/[slug] (exact match)
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
            discoverable: true,
            description: `BasePost by ${article.authorDisplayName || article.authorUsername}: ${article.teaser}`,
            outputSchema: {
              type: "object",
              properties: {
                body: {
                  type: "string",
                  description: "The full article content in markdown format",
                },
              },
              required: ["body"],
            },
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

