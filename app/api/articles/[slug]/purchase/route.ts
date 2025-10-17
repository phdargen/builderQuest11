import { NextRequest, NextResponse } from "next/server";
import { recordPurchase } from "@/lib/redis";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const body = await req.json();
    const { universalAddress, subAccountAddress, username, displayName, pfpUrl } = body;

    if (!universalAddress || !subAccountAddress) {
      return NextResponse.json(
        { error: "universalAddress and subAccountAddress are required" },
        { status: 400 }
      );
    }

    await recordPurchase(
      slug,
      universalAddress,
      subAccountAddress,
      username || universalAddress,
      displayName || universalAddress,
      pfpUrl || null
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error recording purchase:", error);
    return NextResponse.json(
      { error: "Failed to record purchase" },
      { status: 500 }
    );
  }
}

