"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Article } from "@/lib/articles";
import { ArticleStats } from "@/lib/redis";
import { useBaseAccount } from "./providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { base, baseSepolia } from "viem/chains";
import Link from "next/link";
import { getUserInfoClient, type NeynarUserInfo } from "@/lib/neynar";
import Avatar from "./components/Avatar";
import { erc20Abi } from "viem";

const USDC_BASE_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

type SortOption = "recent" | "popular" | "top-rated";

export default function Home() {
  const router = useRouter();
  const { connected, connect, loading: connectLoading, provider, subAccountAddress, universalAddress } = useBaseAccount();
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [statsMap, setStatsMap] = useState<Record<string, ArticleStats>>({});
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [userInfo, setUserInfo] = useState<NeynarUserInfo | null>(null);

  // Load articles and stats on mount
  useEffect(() => {
    async function fetchArticlesAndStats() {
      try {
        const [articlesRes, statsRes] = await Promise.all([
          fetch("/api/articles"),
          fetch("/api/articles/stats"),
        ]);
        
        if (articlesRes.ok) {
          const data = await articlesRes.json();
          setArticles(data);
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
    fetchArticlesAndStats();
  }, []);

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

  // Sort articles based on selected option
  const sortedArticles = [...articles].sort((a, b) => {
    if (sortBy === "recent") {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    } else if (sortBy === "popular") {
      const aStats = statsMap[a.slug] || { totalPurchases: 0 };
      const bStats = statsMap[b.slug] || { totalPurchases: 0 };
      return bStats.totalPurchases - aStats.totalPurchases;
    } else if (sortBy === "top-rated") {
      const aStats = statsMap[a.slug] || { averageScore: 0 };
      const bStats = statsMap[b.slug] || { averageScore: 0 };
      return (bStats.averageScore || 0) - (aStats.averageScore || 0);
    }
    return 0;
  });

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
        abi: erc20Abi,
        functionName: "transfer",
        args: [subAccountAddress as `0x${string}`, paymentAmount],
      });

      const callsId = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${chain.id.toString(16)}`,
            from: subAccountAddress,
            calls: [
              {
                to: USDC_BASE_ADDRESS,
                data: transferData,
                value: "0x0",
              },
            ],
            capabilities: {
              paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL as string },
            },
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
        chain,
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

  return (
    <div className="container">
      <header className="header">
        <h1 className="site-title">BasePost</h1>
        <p className="site-subtitle">A place to read, write and earn on Base</p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          {!connected ? (
            <button
              onClick={connect}
              disabled={connectLoading}
              className="connect-button"
            >
              {connectLoading ? "Connecting..." : "Login"}
            </button>
          ) : (
            <div className="connected-badge" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {userInfo && (
                <Avatar pfpUrl={userInfo.pfpUrl} displayName={userInfo.displayName} size={24} />
              )}
              {userInfo ? userInfo.displayName : "Connected"}
            </div>
          )}
          <Link href="/account">
            <button className="connect-button">
              My BasePosts
            </button>
          </Link>
          <Link href="/upload">
            <button className="connect-button">
              Publish
            </button>
          </Link>
        </div>
      </header>

      <div style={{ marginBottom: "32px", textAlign: "center" }}>
        <label style={{ marginRight: "12px", fontSize: "1rem", fontWeight: "500" }}>
          Sort by:
        </label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.3)",
            background: "rgba(0, 0, 0, 0.2)",
            color: "white",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          <option value="recent">Recent</option>
          <option value="popular">Popular</option>
          <option value="top-rated">Top Rated</option>
        </select>
      </div>

      <main className="articles-grid">
        {loadingArticles ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            Loading articles...
          </div>
        ) : articles.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            No articles yet. Be the first to upload!
          </div>
        ) : (
          sortedArticles.map((article) => {
            const stats = statsMap[article.slug] || {
              totalPurchases: 0,
              averageScore: null,
              lastPurchaseTimestamp: null,
              purchasedBy: [],
              recentPurchases: [],
              totalRatings: 0,
            };
            
            return (
            <div key={article.slug} className="article-card">
              <div className="article-image">
                <img 
                  src={article.imageUrl || '/basePost.png'} 
                  alt={article.title}
                />
              </div>
              <div className="article-content">
                <h2 className="article-title">{article.title}</h2>
                <p className="article-teaser">{article.teaser}</p>
                <div style={{ fontSize: "0.85rem", color: "#ccc", marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Avatar 
                    pfpUrl={article.authorPfpUrl} 
                    displayName={article.authorDisplayName} 
                    size={24} 
                  />
                  <span>By {article.authorDisplayName} • {formatDate(article.uploadedAt)}</span>
                </div>
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
                  {stats.recentPurchases && stats.recentPurchases.length > 0 && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "0.8rem", marginBottom: "6px", opacity: 0.8 }}>
                        Recent purchasers:
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {stats.recentPurchases.slice(0, 10).map((purchase) => (
                          <div
                            key={purchase.universalAddress}
                            title={purchase.displayName}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "4px 8px",
                              borderRadius: "8px",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              fontSize: "0.75rem",
                            }}
                          >
                            <Avatar 
                              pfpUrl={purchase.pfpUrl} 
                              displayName={purchase.displayName} 
                              size={20} 
                            />
                            <span>{purchase.displayName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
            );
          })
        )}
      </main>

      <footer className="footer">
        <p>BasePost - Powered by Base Sub Accounts + x402</p>
      </footer>
    </div>
  );
}

