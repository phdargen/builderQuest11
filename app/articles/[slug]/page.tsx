"use client";

import { useState, useEffect } from "react";
import { notFound } from "next/navigation";
import { useParams } from "next/navigation";
import { Article } from "@/lib/articles";
import { ArticleStats, RatingRecord } from "@/lib/redis";
import { useBaseAccount } from "@/app/providers";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import Avatar from "@/app/components/Avatar";

export default function ArticlePage() {
  const params = useParams();
  const slug = params.slug as string;
  const { universalAddress } = useBaseAccount();
  
  const [article, setArticle] = useState<Article | null>(null);
  const [stats, setStats] = useState<ArticleStats | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingRating, setSubmittingRating] = useState(false);

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
          <div
            className="article-hero-image"
            style={{ backgroundImage: `url(${article.imageUrl})` }}
          />
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
              <p style={{ fontSize: "0.9rem", color: "#666", margin: 0 }}>
                By {article.authorDisplayName} • {article.priceUsd} •{" "}
                {formatDate(article.uploadedAt)}
              </p>
              <p style={{ fontSize: "0.85rem", color: "#888", marginTop: "0.25rem", margin: 0 }}>
                {article.authorAddress}
              </p>
            </div>
          </div>
        </div>

        <article className="article-body">
          <ReactMarkdown>{article.body}</ReactMarkdown>
        </article>

        {/* Rating Section */}
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

