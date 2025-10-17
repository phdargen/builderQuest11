"use client";

import { useState, useEffect } from "react";
import { notFound, useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { Article } from "@/lib/articles";
import { ArticleStats } from "@/lib/redis";
import { useBaseAccount } from "@/app/providers";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import Avatar from "@/app/components/Avatar";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getUserInfoClient, type NeynarUserInfo } from "@/lib/neynar";
import { erc20Abi } from "viem";

const USDC_BASE_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

export default function ArticlePage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { universalAddress, connected, connect, loading: connectLoading, provider, subAccountAddress } = useBaseAccount();
  
  const [article, setArticle] = useState<Article | null>(null);
  const [stats, setStats] = useState<ArticleStats | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [articleBody, setArticleBody] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string>("");
  const [userInfo, setUserInfo] = useState<NeynarUserInfo | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [articleRes, statsRes] = await Promise.all([
          fetch(`/api/articles`),
          fetch(`/api/articles/${slug}/stats`),
        ]);

        if (articleRes.ok) {
          const articles = await articleRes.json();
          const foundArticle = articles.find((a: Article) => a.slug === slug);
          if (foundArticle) {
            setArticle(foundArticle);
          }
        }

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        // Try to fetch the full article from the paid endpoint
        try {
          const paidArticleRes = await fetch(`/api/articles/${slug}`);
          if (paidArticleRes.ok) {
            const paidArticle = await paidArticleRes.json();
            setArticleBody(paidArticle.body);
            setShowPaywall(false);
          } else if (paidArticleRes.status === 402) {
            // Payment required - show paywall
            setShowPaywall(true);
          }
        } catch (err) {
          // If fetch fails, assume paywall needed
          console.log("Article not accessible, showing teaser");
          setShowPaywall(true);
        }

        // Fetch user's existing rating if connected
        if (universalAddress) {
          const ratingRes = await fetch(
            `/api/articles/${slug}/rating?universalAddress=${universalAddress}`
          );
          if (ratingRes.ok) {
            const { rating } = await ratingRes.json();
            if (rating) {
              setUserRating(rating.score);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [slug, universalAddress]);

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

  const unlockArticle = async () => {
    if (!connected) {
      setUnlockError("Please connect your wallet first");
      return;
    }

    if (!provider || !subAccountAddress) {
      setUnlockError("Provider not available");
      return;
    }

    if (!article) {
      setUnlockError("Article not loaded");
      return;
    }

    setUnlocking(true);
    setUnlockError("");

    try {
      const priceValue = article.priceUsd.replace("$", "");
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

          const paidArticle = await res.json();
          setArticleBody(paidArticle.body);
          setShowPaywall(false);
          console.log("Article unlocked successfully");
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
      setUnlockError(errorMsg);
    } finally {
      setUnlocking(false);
    }
  };

  const handleRatingClick = async (score: number) => {
    if (!universalAddress) {
      alert("Please connect your wallet to rate this article");
      return;
    }

    setSubmittingRating(true);
    try {
      const res = await fetch(`/api/articles/${slug}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universalAddress: universalAddress,
          score,
        }),
      });

      if (res.ok) {
        setUserRating(score);
        // Refresh stats
        const statsRes = await fetch(`/api/articles/${slug}/stats`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }
      } else {
        alert("Failed to submit rating");
      }
    } catch (error) {
      console.error("Failed to submit rating:", error);
      alert("Failed to submit rating");
    } finally {
      setSubmittingRating(false);
    }
  };

  if (loading) {
    return (
      <main className="article-page">
        <div className="article-container">
          <div style={{ textAlign: "center", padding: "4rem" }}>
            Loading...
          </div>
        </div>
      </main>
    );
  }

  if (!article) {
    return notFound();
  }

  const truncateAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const renderStars = () => {
    return (
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRatingClick(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(null)}
            disabled={submittingRating}
            style={{
              background: "none",
              border: "none",
              fontSize: "2rem",
              cursor: submittingRating ? "not-allowed" : "pointer",
              color:
                (hoverRating !== null && star <= hoverRating) ||
                (hoverRating === null && userRating !== null && star <= userRating)
                  ? "#ffd700"
                  : "#666",
              transition: "color 0.2s",
              padding: "4px",
            }}
          >
            ★
          </button>
        ))}
        {userRating !== null && (
          <span style={{ marginLeft: "12px", fontSize: "0.9rem", opacity: 0.8 }}>
            Your rating: {userRating}/5
          </span>
        )}
      </div>
    );
  };

  return (
    <main className="article-page">
      <div className="article-container">
        <Link href="/" className="back-link">
          ← Back to Articles
        </Link>

        {article.imageUrl && (
          <div className="article-hero-image">
            <img 
              src={article.imageUrl} 
              alt={article.title}
            />
          </div>
        )}

        <div className="article-header">
          <h1 className="article-page-title">{article.title}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "1rem" }}>
            <Avatar 
              pfpUrl={article.authorPfpUrl} 
              displayName={article.authorDisplayName} 
              size={48} 
            />
            <div>
              <p style={{ fontSize: "0.9rem", color: "#ccc", margin: 0 }}>
                By {article.authorDisplayName} • {article.priceUsd} •{" "}
                {formatDate(article.uploadedAt)}
              </p>
              <p style={{ fontSize: "0.85rem", color: "#aaa", marginTop: "0.25rem", margin: 0 }}>
                {article.authorAddress}
              </p>
            </div>
          </div>
        </div>

        <article className="article-body">
          {showPaywall ? (
            <>
              <div style={{ marginBottom: "2rem" }}>
                <ReactMarkdown>{article.teaser}</ReactMarkdown>
              </div>
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.1)",
                  backdropFilter: "blur(10px)",
                  borderRadius: "16px",
                  padding: "32px",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  textAlign: "center",
                }}
              >
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>
                  🔒 Full Article Locked
                </h3>
                <p style={{ marginBottom: "24px", opacity: 0.9 }}>
                  This article costs {article.priceUsd} to unlock.
                  <br />
                  {!connected ? "Connect your wallet to purchase and read the full content." : "Click below to unlock this article."}
                </p>
                {unlockError && (
                  <div style={{ 
                    color: "#ff6b6b", 
                    marginBottom: "16px", 
                    padding: "12px", 
                    background: "rgba(255, 107, 107, 0.1)",
                    borderRadius: "8px"
                  }}>
                    {unlockError}
                  </div>
                )}
                {!connected ? (
                  <button
                    onClick={connect}
                    disabled={connectLoading}
                    style={{
                      padding: "12px 24px",
                      borderRadius: "12px",
                      border: "none",
                      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                      color: "white",
                      fontSize: "1rem",
                      fontWeight: "600",
                      cursor: connectLoading ? "not-allowed" : "pointer",
                      opacity: connectLoading ? 0.7 : 1,
                    }}
                  >
                    {connectLoading ? "Connecting..." : "Connect Wallet"}
                  </button>
                ) : (
                  <button
                    onClick={unlockArticle}
                    disabled={unlocking}
                    style={{
                      padding: "12px 24px",
                      borderRadius: "12px",
                      border: "none",
                      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                      color: "white",
                      fontSize: "1rem",
                      fontWeight: "600",
                      cursor: unlocking ? "not-allowed" : "pointer",
                      opacity: unlocking ? 0.7 : 1,
                    }}
                  >
                    {unlocking ? "Unlocking..." : `Unlock for ${article.priceUsd}`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <ReactMarkdown>{articleBody || ""}</ReactMarkdown>
          )}
        </article>

        {/* Rating Section - Only show if user has access to the article */}
        {!showPaywall && (
          <div
            style={{
              marginTop: "32px",
              background: "rgba(255, 255, 255, 0.1)",
              backdropFilter: "blur(10px)",
              borderRadius: "16px",
              padding: "32px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Rate this article</h3>
            {renderStars()}
            {!universalAddress && (
              <p style={{ marginTop: "16px", fontSize: "0.9rem", opacity: 0.8 }}>
                Connect your wallet to rate this article
              </p>
            )}
          </div>
        )}

        {/* Stats Section */}
        {stats && (
          <div
            style={{
              marginTop: "24px",
              background: "rgba(255, 255, 255, 0.1)",
              backdropFilter: "blur(10px)",
              borderRadius: "16px",
              padding: "32px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Article Statistics</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <strong>Total Purchases:</strong> {stats.totalPurchases}
              </div>
              <div>
                <strong>Average Rating:</strong>{" "}
                {stats.averageScore !== null
                  ? `${stats.averageScore.toFixed(1)}/5 (${stats.totalRatings} ${
                      stats.totalRatings === 1 ? "rating" : "ratings"
                    })`
                  : "No ratings yet"}
              </div>
              {stats.recentPurchases && stats.recentPurchases.length > 0 && (
                <div>
                  <strong>Recent Purchasers:</strong>
                  <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "12px" }}>
                    {stats.recentPurchases.map((purchase) => (
                      <div
                        key={purchase.universalAddress}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          background: "rgba(255, 255, 255, 0.05)",
                          padding: "8px 12px",
                          borderRadius: "12px",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                        }}
                      >
                        <Avatar 
                          pfpUrl={purchase.pfpUrl} 
                          displayName={purchase.displayName} 
                          size={32} 
                        />
                        <span style={{ fontSize: "0.9rem" }}>{purchase.displayName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

