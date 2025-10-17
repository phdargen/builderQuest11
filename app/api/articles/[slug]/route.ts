import { NextRequest } from "next/server";
import { getArticle } from "@/lib/articles";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  // Find the article in the data
  const article = await getArticle(slug);

  if (!article) {
    return new Response("Article not found", { status: 404 });
  }

  return Response.json({ body: article.body });
}

