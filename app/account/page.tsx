"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Article } from "@/lib/articles";
import { ArticleStats } from "@/lib/redis";
import { useBaseAccount } from "../providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";
import Link from "next/link";
import { getUserInfoClient, type NeynarUserInfo } from "@/lib/neynar";
import Avatar from "../components/Avatar";

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

export default function AccountPage() {
  const router = useRouter();
  const { connected, connect, loading: connectLoading, provider, subAccountAddress, universalAddress } = useBaseAccount();
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [myArticles, setMyArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [statsMap, setStatsMap] = useState<Record<string, ArticleStats>>({});
  const [userInfo, setUserInfo] = useState<NeynarUserInfo | null>(null);

  // Load articles and stats
  useEffect(() => {
    async function fetchArticlesAndStats() {
      try {
        const [articlesRes, statsRes] = await Promise.all([
          fetch("/api/articles"),
          fetch("/api/articles/stats"),
        ]);
        
        if (articlesRes.ok) {
          const allArticles = await articlesRes.json();
          // Filter for user's articles
          if (universalAddress) {
            const filtered = allArticles.filter(
              (article: Article) => article.authorAddress.toLowerCase() === universalAddress.toLowerCase()
            );
            setMyArticles(filtered);
          }
        }

        if (statsRes.ok) {
          const stats = await statsRes.json();
          setStatsMap(stats);
        }
      } catch (error) {
        console.error("Failed to load articles and stats:", error);
      } finally {
        setLoadingArticles(false);
      }
    }
    
    if (universalAddress) {
      fetchArticlesAndStats();
    } else {
      setLoadingArticles(false);
    }
  }, [universalAddress]);

  // Fetch user info when connected
  useEffect(() => {
    async function fetchUserInfo() {
      if (universalAddress && connected) {
        const info = await getUserInfoClient(universalAddress);
        setUserInfo(info);
      } else {
        setUserInfo(null);
      }
    }
    fetchUserInfo();
  }, [universalAddress, connected]);

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

      // Record the purchase with user info
      if (universalAddress && userInfo) {
        try {
          await fetch(`/api/articles/${slug}/purchase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              universalAddress: universalAddress,
              subAccountAddress,
              username: userInfo.username,
              displayName: userInfo.displayName,
              pfpUrl: userInfo.pfpUrl,
            }),
          });
        } catch (err) {
          console.error("Failed to record purchase:", err);
        }
      }

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

  const truncateAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    });
  };

  const renderStars = (score: number | null) => {
    if (score === null) return <span style={{ fontSize: "0.85rem", color: "#ccc" }}>No ratings</span>;
    const fullStars = Math.floor(score);
    const hasHalfStar = score % 1 >= 0.5;
    const stars = [];
    
    for (let i = 0; i < fullStars; i++) {
      stars.push("★");
    }
    if (hasHalfStar) {
      stars.push("☆");
    }
    
    return (
      <span style={{ color: "#ffd700", fontSize: "0.9rem" }}>
        {stars.join("")} {score.toFixed(1)}
      </span>
    );
  };

  const calculateEarnings = (article: Article) => {
    const stats = statsMap[article.slug] || { totalPurchases: 0 };
    const priceValue = parseFloat(article.priceUsd.replace("$", ""));
    return priceValue * stats.totalPurchases;
  };

  const calculateTotalEarnings = () => {
    return myArticles.reduce((total, article) => {
      return total + calculateEarnings(article);
    }, 0);
  };

  if (!connected) {
    return (
      <div className="container">
        <header className="header">
          <h1 className="site-title">My Account</h1>
          <p className="site-subtitle">View your published articles and earnings</p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={connect}
              disabled={connectLoading}
              className="connect-button"
            >
              {connectLoading ? "Connecting..." : "Connect Wallet"}
            </button>
            <Link href="/">
              <button className="connect-button" style={{ background: "#666" }}>
                Back to Home
              </button>
            </Link>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="header">
        <h1 className="site-title">My Account</h1>
        <p className="site-subtitle">Your published articles and earnings</p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <div className="connected-badge" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {userInfo && (
              <Avatar pfpUrl={userInfo.pfpUrl} displayName={userInfo.displayName} size={24} />
            )}
            {userInfo ? userInfo.displayName : "Connected"}
          </div>
          <Link href="/">
            <button className="connect-button">
              Back to Home
            </button>
          </Link>
          <Link href="/upload">
            <button className="connect-button">
              List Content
            </button>
          </Link>
        </div>
        {universalAddress && (
          <div style={{ marginTop: "16px", fontSize: "0.9rem", opacity: 0.9 }}>
            <p>{userInfo && `${userInfo.displayName} • `}Universal Account: {universalAddress}</p>
          </div>
        )}
      </header>

      {/* Earnings Summary */}
      {myArticles.length > 0 && (
        <div
          style={{
            marginBottom: "32px",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "16px",
            padding: "32px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Total Earnings</h2>
          <p style={{ fontSize: "2.5rem", fontWeight: "bold", color: "#4ade80" }}>
            ${calculateTotalEarnings().toFixed(2)} USDC
          </p>
          <p style={{ fontSize: "1rem", opacity: 0.8, marginTop: "8px" }}>
            From {myArticles.length} {myArticles.length === 1 ? "article" : "articles"}
          </p>
        </div>
      )}

      <main className="articles-grid">
        {loadingArticles ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            Loading your articles...
          </div>
        ) : myArticles.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            <Link href="/upload">
              <button className="connect-button">
                Publish Your First Article
              </button>
            </Link>
          </div>
        ) : (
          myArticles.map((article) => {
            const stats = statsMap[article.slug] || {
              totalPurchases: 0,
              averageScore: null,
              lastPurchaseTimestamp: null,
              purchasedBy: [],
              totalRatings: 0,
            };
            const earnings = calculateEarnings(article);
            
            return (
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
                <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.5rem" }}>
                  Published {formatDate(article.uploadedAt)}
                </p>
                <div style={{ 
                  fontSize: "0.85rem", 
                  marginTop: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  opacity: 0.9
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>📊 {stats.totalPurchases} purchases</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {renderStars(stats.averageScore)}
                    {stats.totalRatings > 0 && (
                      <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                        ({stats.totalRatings} {stats.totalRatings === 1 ? "rating" : "ratings"})
                      </span>
                    )}
                  </div>
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: "8px",
                    marginTop: "8px",
                    padding: "8px",
                    background: "rgba(74, 222, 128, 0.2)",
                    borderRadius: "8px",
                  }}>
                    <span style={{ fontWeight: "600", color: "#4ade80" }}>
                      💰 Earned: ${earnings.toFixed(2)} USDC
                    </span>
                  </div>
                </div>
                <div className="article-footer-vertical">
                  {errors[article.slug] && (
                    <div className="error-message">{errors[article.slug]}</div>
                  )}
                  <button
                    onClick={() => unlockArticle(article.slug, article.priceUsd)}
                    disabled={loadingArticle === article.slug}
                    className="unlock-button-small"
                  >
                    {loadingArticle === article.slug ? "Unlocking..." : `View Article (${article.priceUsd})`}
                  </button>
                </div>
              </div>
            </div>
            );
          })
        )}
      </main>

      <footer className="footer">
        <p>Powered by Base Account Sub Accounts + x402 Protocol</p>
        <p className="footer-note">All articles protected by micropayments on Base Sepolia</p>
      </footer>
    </div>
  );
}

