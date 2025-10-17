import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { promises as fs } from "fs";
import path from "path";

export interface Article {
  slug: string;
  title: string;
  teaser: string;
  body: string; // markdown
  imageUrl?: string;
  priceUsd: string;
  authorAddress: string;
  authorUsername: string; // Neynar username or truncated address
  authorDisplayName: string; // Neynar display name or truncated address
  authorPfpUrl: string | null; // Neynar profile picture URL
  uploadedAt: string; // ISO 8601 timestamp
}

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const LOCAL_STORAGE_PATH = path.join(process.cwd(), "articles.json");

// S3 Client (only initialized if not in debug mode)
let s3Client: S3Client | null = null;

if (!DEBUG_MODE) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME || "";

/**
 * Load all articles from storage (S3 or local file)
 */
export async function loadArticles(): Promise<Article[]> {
  if (DEBUG_MODE) {
    return loadArticlesFromLocal();
  } else {
    return loadArticlesFromS3();
  }
}

/**
 * Save an article to storage (S3 or local file)
 */
export async function saveArticle(article: Article): Promise<void> {
  const articles = await loadArticles();
  
  // Check if article with this slug already exists
  const existingIndex = articles.findIndex((a) => a.slug === article.slug);
  
  if (existingIndex >= 0) {
    // Update existing article
    articles[existingIndex] = article;
  } else {
    // Add new article
    articles.push(article);
  }

  if (DEBUG_MODE) {
    await saveArticlesToLocal(articles);
  } else {
    await saveArticlesToS3(articles);
  }
}

/**
 * Upload image to storage and return URL
 */
export async function uploadImage(
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const timestamp = Date.now();
  const uniqueFilename = `images/${timestamp}-${filename}`;

  if (DEBUG_MODE) {
    // Save to local public/uploads directory
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${timestamp}-${filename}`);
    await fs.writeFile(filePath, imageBuffer);
    return `/uploads/${timestamp}-${filename}`;
  } else {
    // Upload to S3
    if (!s3Client) {
      throw new Error("S3 client not initialized");
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: imageBuffer,
        ContentType: getContentType(filename),
      })
    );

    return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueFilename}`;
  }
}

// Local file operations
async function loadArticlesFromLocal(): Promise<Article[]> {
  try {
    const data = await fs.readFile(LOCAL_STORAGE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveArticlesToLocal(articles: Article[]): Promise<void> {
  await fs.writeFile(LOCAL_STORAGE_PATH, JSON.stringify(articles, null, 2));
}

// S3 operations
async function loadArticlesFromS3(): Promise<Article[]> {
  if (!s3Client) {
    throw new Error("S3 client not initialized");
  }

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: "articles.json",
      })
    );

    const data = await response.Body?.transformToString();
    return data ? JSON.parse(data) : [];
  } catch (error: any) {
    // If file doesn't exist, return empty array
    if (error.name === "NoSuchKey") {
      return [];
    }
    throw error;
  }
}

async function saveArticlesToS3(articles: Article[]): Promise<void> {
  if (!s3Client) {
    throw new Error("S3 client not initialized");
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: "articles.json",
      Body: JSON.stringify(articles, null, 2),
      ContentType: "application/json",
    })
  );
}

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return contentTypes[ext] || "application/octet-stream";
}

