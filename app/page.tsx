"use client";

import Link from "next/link";
import { ARTICLES } from "@/lib/articles";
import { useBaseAccount } from "./providers";

export default function Home() {
  const { connected, connect, loading } = useBaseAccount();

  return (
    <div className="container">
      <header className="header">
        <h1 className="site-title">Based News</h1>
        <p className="site-subtitle">Premium Blockchain & Tech Journalism</p>
        {!connected ? (
          <button
            onClick={connect}
            disabled={loading}
            className="connect-button"
          >
            {loading ? "Connecting..." : "Connect Wallet"}
          </button>
        ) : (
          <div className="connected-badge">Connected ✓</div>
        )}
      </header>

      <main className="articles-grid">
        {ARTICLES.map((article) => (
          <Link
            key={article.slug}
            href={`/articles/${article.slug}`}
            className="article-card"
          >
            {article.imageUrl && (
              <div
                className="article-image"
                style={{ backgroundImage: `url(${article.imageUrl})` }}
              />
            )}
            <div className="article-content">
              <h2 className="article-title">{article.title}</h2>
              <p className="article-teaser">{article.teaser}</p>
              <div className="article-footer">
                <span className="article-price">Unlock: {article.priceUsd} USDC</span>
                <span className="read-more">Read More →</span>
              </div>
            </div>
          </Link>
        ))}
      </main>

      <footer className="footer">
        <p>Powered by Base Account Sub Accounts + x402 Protocol</p>
        <p className="footer-note">All articles protected by micropayments on Base Sepolia</p>
      </footer>
    </div>
  );
}

