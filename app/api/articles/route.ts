import { NextResponse } from "next/server";
import { getArticles } from "@/lib/articles";

export async function GET() {
  try {
    const articles = await getArticles();
    // Remove body field from list - full body only available via paid endpoint
    const articlesWithoutBody = articles.map(({ body, ...rest }) => rest);
    return NextResponse.json(articlesWithoutBody);
  } catch (error) {
    console.error("Failed to load articles:", error);
    return NextResponse.json(
      { error: "Failed to load articles" },
      { status: 500 }
    );
  }
}

