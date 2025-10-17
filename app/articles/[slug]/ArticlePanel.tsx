"use client";

import { useState } from "react";
import { useBaseAccount } from "@/app/providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";

export function ArticlePanel({ slug }: { slug: string }) {
  const { provider, connected, connect, loading: connectLoading } = useBaseAccount();
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (!connected) {
      setError("Please connect your wallet first");
      return;
    }

    if (!provider) {
      setError("Provider not available");
      return;
    }

    console.log("Fetching article with url:", `/api/articles/${slug}`);

    try {
      setLoading(true);
      setError(null);

      // Get the accounts
      const accounts = (await provider.request({
        method: "eth_accounts",
        params: [],
      })) as string[];

      if (!accounts || accounts.length === 0) {
        setError("No accounts found");
        return;
      }

      // With defaultAccount: 'sub', the sub account is the first account
      const subAccountAddress = accounts[0];
      const universalAccountAddress = accounts[1];
      
      console.log("Sub Account:", subAccountAddress);
      console.log("Universal Account (signer):", universalAccountAddress);

      // Create wallet client with universal account (EOA) for signing
      // The provider handles routing through sub-account when configured with defaultAccount: 'sub'
      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain: baseSepolia,
        transport: custom(provider),
      });

      // Wrap fetch with payment handler
      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any );

      console.log("Making payment request...");
      // Make request to the protected API
      const res = await fetchWithPayment(`/api/articles/${slug}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Response error:", { status: res.status, body: errorText });
        throw new Error(`Failed to unlock article: ${res.status} - ${errorText}`);
      }

      const json = await res.json();
      setBody(json.body);
      console.log("Article unlocked successfully");
    } catch (err) {
      console.error("Payment error details:", err);
      setError(err instanceof Error ? err.message : "Failed to unlock article");
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <div className="article-panel">
        <div className="paywall-message">
          <p>Connect your wallet to unlock this article</p>
          <button 
            onClick={connect} 
            disabled={connectLoading}
            className="unlock-button"
          >
            {connectLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  if (body) {
    return (
      <article className="article-body">
        {body.split('\n\n').map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
      </article>
    );
  }

  return (
    <div className="article-panel">
      <div className="paywall-message">
        <p>This article is protected by a micropayment.</p>
        <p className="paywall-note">
          Payment will be processed from your Sub Account using USDC on Base Sepolia.
          No repeated approvals needed!
        </p>
        {error && <p className="error-message">{error}</p>}
        <button 
          onClick={unlock} 
          disabled={loading}
          className="unlock-button"
        >
          {loading ? "Unlocking..." : "Unlock Article"}
        </button>
      </div>
    </div>
  );
}

