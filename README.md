# Based News

A modern news platform demonstrating Base Account Sub Accounts integration with x402 payment protocol for micropayment-protected articles.

## Features

- **Micropayment Paywalls**: Articles protected by x402 protocol payments
- **Automatic Sub Account Creation**: Sub account is created automatically when users connect their wallet
- **No Repeated Approvals**: Payments are processed from the sub account without repeated wallet prompts
- **Auto Spend Permissions**: Sub accounts can access Universal Account balance when needed
- **Modern UI**: Clean, responsive NYT-inspired grid layout with blue gradient styling
- **Individual Article Pricing**: Each article can have custom pricing

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

2. Create a `.env` file with your seller address:

```bash
SELLER_ADDRESS=0xYourAddressHere
```

This is the address that will receive payments when users unlock articles.

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

1. **Connect Wallet**: Click "Connect Wallet" on the homepage
2. **Browse Articles**: View article cards with images, titles, teasers, and pricing
3. **Unlock Article**: Click on an article to view details, then click "Unlock Article"
4. **Payment**: The payment is processed automatically from your sub account
5. **Read**: Full article content is displayed after successful payment

## Configuration

### Article Content

Articles are defined in `lib/articles.ts`:

```tsx
export const ARTICLES = [
  {
    slug: "article-slug",
    title: "Article Title",
    teaser: "Brief description...",
    body: "Full article content...",
    imageUrl: "https://...",
    priceUsd: "$0.003",
  },
  // ... more articles
];
```

### Payment Routes

The middleware in `middleware.ts` automatically creates protected routes for each article:

```tsx
ARTICLES.forEach((article) => {
  articleRoutes[`/api/articles/${article.slug}`] = {
    price: article.priceUsd,
    network: "base-sepolia",
    config: {
      description: article.teaser,
    },
  };
});
```

### Getting Test USDC

To get USDC on Base Sepolia for testing:
1. Get Base Sepolia ETH from a faucet
2. Swap for USDC on a Base Sepolia DEX, or
3. Use the USDC faucet if available

## Architecture

- **Frontend**: Next.js 14 with React 18
- **Wallet Integration**: Base Account SDK with Sub Accounts
- **Payment**: x402 protocol with middleware protection
- **Network**: Base Sepolia (testnet)
- **Token**: USDC (6 decimals)

## Learn More

- [Base Account Documentation](https://docs.base.org/base-account)
- [Sub Accounts Guide](https://docs.base.org/base-account/improve-ux/sub-accounts)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Account SDK](https://github.com/base/account-sdk)

## License

MIT

