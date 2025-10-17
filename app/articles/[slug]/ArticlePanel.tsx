"use client";

import { useState } from "react";
import { useBaseAccount } from "@/app/providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const ERC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function ArticlePanel({ slug, priceUsd }: { slug: string; priceUsd: string }) {
  const { provider, connected, connect, loading: connectLoading, subAccountAddress } = useBaseAccount();
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (!connected) {
      setError("Please connect your wallet first");
      return;
    }

    if (!provider || !subAccountAddress) {
      setError("Provider not available");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Transfer USDC from sub account to itself (self-transfer) to trigger the auto-funding mechanism
      const priceValue = priceUsd.replace("$", "");
      const paymentAmount = parseUnits(priceValue, 6);
      
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [subAccountAddress as `0x${string}`, paymentAmount],
      });

      const callsId = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${baseSepolia.id.toString(16)}`,
            from: subAccountAddress,
            calls: [
              {
                to: USDC_BASE_SEPOLIA,
                data: transferData,
                value: "0x0",
              },
            ],
          },
        ],
      }) as string;

      console.log("Self-transfer transaction sent:", callsId);
      
      // Wait a bit for transaction to be processed
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds

      // Make the API call with the now-funded sub account
      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain: baseSepolia,
        transport: custom(provider),
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any);

      // Retry logic with exponential backoff
      const maxRetries = 5;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetchWithPayment(`/api/articles/${slug}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to unlock article: ${res.status} - ${errorText}`);
          }

          const json = await res.json();
          setBody(json.body);
          console.log("Article unlocked successfully");
          return; // Success, exit the function
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Payment attempt ${attempt}/${maxRetries} failed:`, lastError.message);

          if (attempt < maxRetries) {
            // Exponential backoff: 2^attempt seconds
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delayMs / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      // If we get here, all retries failed
      throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
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
          Click unlock to pay {priceUsd} USDC and access the full article.
        </p>
        <button 
          onClick={unlock} 
          disabled={loading}
          className="unlock-button"
        >
          {loading ? "Unlocking..." : `Unlock Article (${priceUsd})`}
        </button>
      </div>
    </div>
  );
}

