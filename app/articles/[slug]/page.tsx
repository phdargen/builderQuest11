import { notFound } from "next/navigation";
import { getArticle } from "@/lib/articles";
import { ArticlePanel } from "./ArticlePanel";
import Link from "next/link";

export default async function ArticlePage({ 
  params 
}: { 
  params: Promise<{ slug: string }> 
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  
  if (!article) {
    return notFound();
  }
  
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
          <p className="article-unlock-info">
            Unlock full article: {article.priceUsd} USDC on Base Sepolia
          </p>
        </div>
        
        <ArticlePanel slug={slug} priceUsd={article.priceUsd} />
      </div>
    </main>
  );
}

