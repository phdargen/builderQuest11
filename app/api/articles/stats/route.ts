import { NextResponse } from "next/server";
import { getArticles } from "@/lib/articles";
import { getMultipleArticlesStats } from "@/lib/redis";

export async function GET() {
  try {
    const articles = await getArticles();
    const slugs = articles.map((article) => article.slug);
    const statsMap = await getMultipleArticlesStats(slugs);

    return NextResponse.json(statsMap);
  } catch (error) {
    console.error("Failed to load article stats:", error);
    return NextResponse.json(
      { error: "Failed to load article stats" },
      { status: 500 }
    );
  }
}

