# Based News

A modern news platform demonstrating Base Account Sub Accounts integration with x402 payment protocol for micropayment-protected articles.

## Features

- **User Article Uploads**: Anyone can upload articles for $0.10 USDC
- **Dynamic Content Loading**: Articles loaded from AWS S3 or local storage (debug mode)
- **Markdown Support**: Article bodies support full markdown formatting
- **Author Attribution**: Every article displays the author's wallet address
- **Micropayment Paywalls**: Articles protected by x402 protocol payments
- **Automatic Sub Account Creation**: Sub account is created automatically when users connect their wallet
- **No Repeated Approvals**: Payments are processed from the sub account without repeated wallet prompts
- **Auto Spend Permissions**: Sub accounts can access Universal Account balance when needed
- **Modern UI**: Clean, responsive NYT-inspired grid layout with blue gradient styling
- **Individual Article Pricing**: Each article can have custom pricing
- **Image Upload**: Optional image upload with S3 or local storage
- **Reputation System**: Track purchases and ratings with Redis
- **Article Ratings**: Users can rate articles 1-5 stars (one rating per universal account)
- **Article Statistics**: View purchase count, average ratings, and buyer addresses
- **Smart Sorting**: Sort articles by recent, popular (most purchases), or top-rated
- **Author Dashboard**: View your published articles and total earnings
- **Neynar Integration**: Display Farcaster usernames/display names for article authors and connected users

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Base Account (create one at [account.base.app](https://account.base.app))
- USDC on Base Sepolia testnet for reading articles

### Installation

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with required environment variables:

```bash
# Required: Address that receives payments
SELLER_ADDRESS=0xYourAddressHere

# Debug mode - use local storage instead of AWS S3
DEBUG_MODE=true

# AWS S3 Configuration (only required if DEBUG_MODE=false)
# AWS_REGION=us-east-1
# AWS_S3_BUCKET_NAME=your-bucket-name
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: x402 Facilitator URL
# NEXT_PUBLIC_FACILITATOR_URL=

# Upstash Redis Configuration (for reputation system)
UPSTASH_REDIS_URL=your-upstash-redis-url
UPSTASH_REDIS_TOKEN=your-upstash-redis-token

# Neynar API Configuration (for Farcaster display names)
# Get your API key at https://neynar.com
NEYNAR_API_KEY=your-neynar-api-key

# Content Upload Limits (optional, defaults shown)
NEXT_PUBLIC_MAX_TITLE_LENGTH=150
NEXT_PUBLIC_MAX_TEASER_LENGTH=500
NEXT_PUBLIC_MAX_BODY_LENGTH=50000
NEXT_PUBLIC_MAX_IMAGE_SIZE_MB=5
```

**Debug Mode**: When `DEBUG_MODE=true`, articles are stored in a local `articles.json` file and images in `public/uploads/`. Perfect for development and testing without AWS credentials.

**Content Limits**: Configure maximum lengths for article content and image upload sizes. All limits have reasonable defaults if not specified.

3. Run the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## How It Works

### Base Account Sub Accounts

This app uses the **quickstart configuration** from the Base Account SDK:

```tsx
const sdk = createBaseAccountSDK({
  subAccounts: {
    creation: 'on-connect',    // Auto-create sub account on connect
    defaultAccount: 'sub',      // Use sub account for transactions by default
  }
});
```

When users connect their wallet:
1. A sub account is automatically created for your app
2. All subsequent transactions are sent from the sub account
3. No repeated approval prompts are needed
4. The sub account can access the Universal Account's USDC balance via Spend Permissions

### x402 Payment Protocol

Articles are protected by the x402 protocol:
- Middleware intercepts requests to article API routes
- Payment validation happens automatically
- Each article can have individual pricing
- Payments are processed in USDC on Base Sepolia

### Key Benefits

- **Frictionless UX**: Users only approve the connection once, then can unlock articles without repeated prompts
- **Seamless funding**: No need to manually fund the sub account - it accesses the Universal Account balance
- **Micropayments**: Perfect for low-cost content like news articles ($0.002 - $0.005 per article)
- **Developer friendly**: Simple integration with middleware and protected API routes

## Usage

### Reading Articles

1. **Connect Wallet**: Click "Connect Wallet" on the homepage
2. **Browse Articles**: View article cards with images, titles, teasers, pricing, stats, and author addresses
3. **Sort Articles**: Use the dropdown to sort by Recent, Popular (most purchases), or Top Rated
4. **Unlock Article**: Click the price button on any article card
5. **Payment**: The payment is processed automatically from your sub account
6. **Read & Rate**: Full article content with markdown formatting is displayed after successful payment
7. **Rate Article**: Give the article 1-5 stars to help other readers

### Uploading Articles

1. **Connect Wallet**: Ensure your wallet is connected
2. **Click "List Content"**: Navigate to the upload form
3. **Fill in Article Details**:
   - **Title**: Your article headline (max 150 characters)
   - **Teaser**: Brief description (max 500 characters, shows on article cards)
   - **Body**: Full article content (max 50,000 characters, markdown supported)
   - **Price**: How much readers pay to unlock (e.g., $0.003)
   - **Image**: Optional - upload a file (max 5MB) or provide a URL
4. **Submit**: Pay $0.10 USDC to upload your article
5. **Published**: Your article appears immediately on the homepage

**Note**: Character counters and file size validation are displayed in real-time as you type/upload. All limits are configurable via environment variables.

### Managing Your Articles

1. **Click "My Account"**: View your author dashboard
2. **View Earnings**: See total earnings from all your articles
3. **Article Performance**: Check purchases, ratings, and earnings per article
4. **Track Success**: Monitor which articles perform best

## Configuration

### Article Storage

Articles are stored dynamically based on the `DEBUG_MODE` environment variable:

- **Debug Mode (`DEBUG_MODE=true`)**: Articles stored in `articles.json` at project root, images in `public/uploads/`
- **Production Mode (`DEBUG_MODE=false`)**: Articles stored in AWS S3 bucket at `articles.json`, images in `images/` prefix

Article structure:
```typescript
{
  slug: string;           // Auto-generated from title
  title: string;
  teaser: string;
  body: string;           // Markdown content
  imageUrl?: string;
  priceUsd: string;       // Format: "$0.003"
  authorAddress: string;  // Uploader's universal account address
}
```

### Payment Routes

The middleware in `middleware.ts` dynamically loads articles and creates protected routes:

- **Article unlock**: `/api/articles/[slug]` - Price set by article author
- **Article upload**: `/api/upload` - Fixed at $0.10 USDC

### AWS S3 Setup (Production)

To use AWS S3 for article storage in production:

1. **Create an S3 Bucket**:
   - Go to AWS S3 Console
   - Create a new bucket (e.g., `basednews-articles`)
   - Enable public read access for the bucket or configure CloudFront

2. **Create IAM User**:
   - Go to AWS IAM Console
   - Create a new user with programmatic access
   - Attach policy with `s3:PutObject`, `s3:GetObject` permissions for your bucket

3. **Configure Environment Variables**:
   ```bash
   DEBUG_MODE=false
   AWS_REGION=us-east-1
   AWS_S3_BUCKET_NAME=basednews-articles
   AWS_ACCESS_KEY_ID=your-access-key
   AWS_SECRET_ACCESS_KEY=your-secret-key
   ```

4. **Bucket Permissions**: Ensure the bucket allows public read access to the `articles.json` and `images/` objects, or configure proper CORS settings.

### Neynar API Setup (Optional)

To display Farcaster usernames instead of wallet addresses:

1. **Get an API Key**:
   - Go to [Neynar](https://neynar.com)
   - Sign up and create an API key
   
2. **Configure Environment Variable**:
   ```bash
   NEYNAR_API_KEY=your-neynar-api-key
   ```

3. **Fallback Behavior**: If the API key is not configured, the app will display truncated wallet addresses instead of usernames.

### Getting Test USDC

To get USDC on Base Sepolia for testing:
1. Get Base Sepolia ETH from a faucet
2. Swap for USDC on a Base Sepolia DEX, or
3. Use the USDC faucet if available

## Architecture

- **Frontend**: Next.js 14 with React 18
- **Wallet Integration**: Base Account SDK with Sub Accounts
- **Payment**: x402 protocol with middleware protection
- **Storage**: AWS S3 (production) or local file system (debug mode)
- **Database**: Upstash Redis for reputation system (purchases & ratings)
- **Content Rendering**: React Markdown for article bodies
- **Network**: Base Sepolia (testnet)
- **Token**: USDC (6 decimals)

## Reputation System

The app uses Redis to track article performance:

### Data Stored
- **Purchases**: Universal account address, sub-account address, username, display name, profile picture URL, timestamp
- **Ratings**: Score (1-5), timestamp, one per universal account

### Features
- Automatic purchase recording after successful payment
- Interactive star rating system on article pages
- Real-time statistics on article cards
- Author earnings dashboard
- Sorting by popularity and ratings

### Redis Structure
```
article:{slug}:purchases → Hash of universalAddress → JSON{
  universalAddress,
  subAccountAddress,
  username,
  displayName,
  pfpUrl,
  timestamp
}
article:{slug}:ratings → Hash of universalAddress → JSON{score, timestamp}
```

## Neynar Integration (Display Names & Profile Pictures)

The app integrates with Neynar to display Farcaster usernames, display names, and profile pictures:

### Features
- **Article Authors**: Profile picture and display name shown on article cards and detail pages
- **Connected Users**: Avatar and display name displayed in header badge
- **Recent Purchasers**: Last 10 purchasers shown with avatars on article pages
- **Default Avatars**: Initials shown in colored circles when no profile picture available
- **All Avatars Rounded**: Consistent circular avatar design throughout the app

### Data Stored
For each article:
- `authorUsername`: Farcaster username or truncated address
- `authorDisplayName`: Farcaster display name or truncated address
- `authorPfpUrl`: Profile picture URL (null if unavailable)

For each purchase (in Redis):
- Username, display name, and profile picture of purchaser
- Displayed as "Recent Purchasers" section on article pages (last 10)

### Fallback Behavior
- **No Farcaster Account**: Shows truncated address (0x1234...5678)
- **No Profile Picture**: Shows initials in colored circle
- **API Error**: Gracefully falls back to address display

## Learn More

- [Base Account Documentation](https://docs.base.org/base-account)
- [Sub Accounts Guide](https://docs.base.org/base-account/improve-ux/sub-accounts)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Account SDK](https://github.com/base/account-sdk)

## License

MIT

