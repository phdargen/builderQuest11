import { NextRequest, NextResponse } from "next/server";
import { recordRating, getUserRating } from "@/lib/redis";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const body = await req.json();
    const { universalAddress, score } = body;

    if (!universalAddress || score === undefined) {
      return NextResponse.json(
        { error: "universalAddress and score are required" },
        { status: 400 }
      );
    }

    if (score < 1 || score > 5) {
      return NextResponse.json(
        { error: "Score must be between 1 and 5" },
        { status: 400 }
      );
    }

    await recordRating(slug, universalAddress, score);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error recording rating:", error);
    return NextResponse.json(
      { error: "Failed to record rating" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const universalAddress = searchParams.get("universalAddress");

    if (!universalAddress) {
      return NextResponse.json(
        { error: "universalAddress query parameter is required" },
        { status: 400 }
      );
    }

    const rating = await getUserRating(slug, universalAddress);

    return NextResponse.json({ rating });
  } catch (error) {
    console.error("Error fetching rating:", error);
    return NextResponse.json(
      { error: "Failed to fetch rating" },
      { status: 500 }
    );
  }
}

