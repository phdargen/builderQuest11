import { NextRequest, NextResponse } from "next/server";
import { saveArticle, uploadImage } from "@/lib/storage";
import { invalidateCache } from "@/lib/articles";
import { getUserInfo } from "@/lib/neynar";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract form fields
    const title = formData.get("title") as string;
    const teaser = formData.get("teaser") as string;
    const body = formData.get("body") as string;
    const priceUsd = formData.get("priceUsd") as string;
    const authorAddress = formData.get("authorAddress") as string;
    const imageFile = formData.get("image") as File | null;
    const imageUrl = formData.get("imageUrl") as string | null;

    // Validate required fields
    if (!title || !teaser || !body || !priceUsd || !authorAddress) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate price format (should be like "$0.10")
    if (!priceUsd.startsWith("$") || isNaN(parseFloat(priceUsd.substring(1)))) {
      return NextResponse.json(
        { error: "Invalid price format. Use format like $0.10" },
        { status: 400 }
      );
    }

    // Validate author address format
    if (!authorAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json(
        { error: "Invalid Ethereum address format" },
        { status: 400 }
      );
    }

    // Generate slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Handle image upload if provided
    let finalImageUrl = imageUrl || "";
    if (imageFile && imageFile.size > 0) {
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      finalImageUrl = await uploadImage(imageBuffer, imageFile.name);
    }

    // Fetch full user info from Neynar
    const userInfo = await getUserInfo(authorAddress);

    // Save article
    const article = {
      slug,
      title,
      teaser,
      body,
      imageUrl: finalImageUrl,
      priceUsd,
      authorAddress,
      authorUsername: userInfo.username,
      authorDisplayName: userInfo.displayName,
      authorPfpUrl: userInfo.pfpUrl,
      uploadedAt: new Date().toISOString(),
    };

    await saveArticle(article);
    
    // Invalidate the articles cache
    invalidateCache();

    return NextResponse.json({
      success: true,
      slug,
      message: "Article uploaded successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload article" },
      { status: 500 }
    );
  }
}

