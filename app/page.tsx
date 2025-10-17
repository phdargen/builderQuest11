"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARTICLES } from "@/lib/articles";
import { useBaseAccount } from "./providers";
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

export default function Home() {
  const router = useRouter();
  const { connected, connect, loading: connectLoading, provider, subAccountAddress } = useBaseAccount();
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const unlockArticle = async (slug: string, priceUsd: string) => {
    if (!connected) {
      setErrors(prev => ({ ...prev, [slug]: "Please connect your wallet first" }));
      return;
    }

    if (!provider || !subAccountAddress) {
      setErrors(prev => ({ ...prev, [slug]: "Provider not available" }));
      return;
    }

    setLoadingArticle(slug);
    setErrors(prev => ({ ...prev, [slug]: "" }));

    try {
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
      await new Promise(resolve => setTimeout(resolve, 3000));

      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain: baseSepolia,
        transport: custom(provider),
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any);
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

          console.log("Article unlocked successfully");
          router.push(`/articles/${slug}`);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Payment attempt ${attempt}/${maxRetries} failed:`, lastError.message);

          if (attempt < maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delayMs / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to unlock article";
      console.error("Payment error details:", err);
      setErrors(prev => ({ ...prev, [slug]: errorMsg }));
    } finally {
      setLoadingArticle(null);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1 className="site-title">Based News</h1>
        <p className="site-subtitle">Premium Blockchain & Tech Journalism</p>
        {!connected ? (
          <button
            onClick={connect}
            disabled={connectLoading}
            className="connect-button"
          >
            {connectLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        ) : (
          <div className="connected-badge">Connected ✓</div>
        )}
      </header>

      <main className="articles-grid">
        {ARTICLES.map((article) => (
          <div key={article.slug} className="article-card">
            {article.imageUrl && (
              <div
                className="article-image"
                style={{ backgroundImage: `url(${article.imageUrl})` }}
              />
            )}
            <div className="article-content">
              <h2 className="article-title">{article.title}</h2>
              <p className="article-teaser">{article.teaser}</p>
              <div className="article-footer-vertical">
                {errors[article.slug] && (
                  <div className="error-message">{errors[article.slug]}</div>
                )}
                <button
                  onClick={() => unlockArticle(article.slug, article.priceUsd)}
                  disabled={loadingArticle === article.slug || !connected}
                  className="unlock-button-small"
                >
                  {loadingArticle === article.slug ? "Unlocking..." : `${article.priceUsd} USDC`}
                </button>
              </div>
            </div>
          </div>
        ))}
      </main>

      <footer className="footer">
        <p>Powered by Base Account Sub Accounts + x402 Protocol</p>
        <p className="footer-note">All articles protected by micropayments on Base Sepolia</p>
      </footer>
    </div>
  );
}

