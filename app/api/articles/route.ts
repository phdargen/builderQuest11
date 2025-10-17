import { NextResponse } from "next/server";
import { getArticles } from "@/lib/articles";

export async function GET() {
  try {
    const articles = await getArticles();
    return NextResponse.json(articles);
  } catch (error) {
    console.error("Failed to load articles:", error);
    return NextResponse.json(
      { error: "Failed to load articles" },
      { status: 500 }
    );
  }
}

