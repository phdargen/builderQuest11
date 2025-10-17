import { NextRequest, NextResponse } from "next/server";
import { getUserInfo } from "@/lib/neynar";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Address parameter is required" },
      { status: 400 }
    );
  }

  try {
    const userInfo = await getUserInfo(address);
    return NextResponse.json({
      username: userInfo.username,
      displayName: userInfo.displayName,
      pfpUrl: userInfo.pfpUrl,
    });
  } catch (error) {
    console.error("Error fetching user info:", error);
    return NextResponse.json(
      { error: "Failed to fetch user info" },
      { status: 500 }
    );
  }
}

