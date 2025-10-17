import { NextRequest, NextResponse } from "next/server";
import { getArticleStats } from "@/lib/redis";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const stats = await getArticleStats(slug);

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching article stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch article stats" },
      { status: 500 }
    );
  }
}

