"use client";

import React, { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBaseAccount } from "../providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getUserInfoClient } from "@/lib/neynar";
import { erc20Abi } from "viem";

const USDC_BASE_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

// Content limits (configurable via environment variables)
const MAX_TITLE_LENGTH = parseInt(process.env.NEXT_PUBLIC_MAX_TITLE_LENGTH || "150", 10);
const MAX_TEASER_LENGTH = parseInt(process.env.NEXT_PUBLIC_MAX_TEASER_LENGTH || "500", 10);
const MAX_BODY_LENGTH = parseInt(process.env.NEXT_PUBLIC_MAX_BODY_LENGTH || "50000", 10);
const MAX_IMAGE_SIZE_MB = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_SIZE_MB || "5", 10);
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

export default function UploadPage() {
  const router = useRouter();
  const { connected, provider, subAccountAddress, universalAddress } = useBaseAccount();
  
  const [title, setTitle] = useState("");
  const [teaser, setTeaser] = useState("");
  const [body, setBody] = useState("");
  const [priceUsd, setPriceUsd] = useState("0.01");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [userDisplayName, setUserDisplayName] = useState<string>("");
  const [urlError, setUrlError] = useState<string>("");

  // Fetch user display name when connected
  useEffect(() => {
    async function fetchDisplayName() {
      if (universalAddress && connected) {
        const userInfo = await getUserInfoClient(universalAddress);
        setUserDisplayName(userInfo.displayName);
      } else {
        setUserDisplayName("");
      }
    }
    fetchDisplayName();
  }, [universalAddress, connected]);

  // Validate image URL format
  const validateImageUrl = (url: string): string => {
    if (!url) return ""; // Empty is ok (optional field)
    
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return "URL must use http:// or https://";
      }
      return ""; // Valid
    } catch {
      return "Invalid URL format";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!connected) {
      setError("Please connect your wallet first");
      return;
    }

    if (!provider || !subAccountAddress) {
      setError("Provider not available");
      return;
    }

    // Validate content length
    if (title.length > MAX_TITLE_LENGTH) {
      setError(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
      return;
    }

    if (teaser.length > MAX_TEASER_LENGTH) {
      setError(`Teaser must be ${MAX_TEASER_LENGTH} characters or less`);
      return;
    }

    if (body.length > MAX_BODY_LENGTH) {
      setError(`Body must be ${MAX_BODY_LENGTH} characters or less`);
      return;
    }

    // Validate image size if file is selected
    if (imageFile && imageFile.size > MAX_IMAGE_SIZE_BYTES) {
      setError(`Image size must be ${MAX_IMAGE_SIZE_MB}MB or less`);
      return;
    }

    // Validate price format
    const priceValue = parseFloat(priceUsd);
    if (isNaN(priceValue) || priceValue <= 0) {
      setError("Price must be a valid positive number");
      return;
    }

    // Validate image URL format if provided
    if (imageUrl && urlError) {
      setError("Please fix the image URL error before submitting");
      return;
    }

    if (imageUrl) {
      try {
        const url = new URL(imageUrl);
        // Check if protocol is http or https
        if (!['https:'].includes(url.protocol)) {
          setError("url must use https://");
          return;
        }
        // Optional: Check if URL points to a common image format
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
        const pathname = url.pathname.toLowerCase();
        const hasImageExtension = imageExtensions.some(ext => pathname.endsWith(ext));
        
        if (!hasImageExtension && !pathname.includes('/image') && !url.hostname.includes('imgur') && !url.hostname.includes('cloudinary')) {
          console.warn("URL may not be an image - proceeding anyway");
          // Don't block, just warn - some image URLs don't have extensions (e.g., dynamic URLs)
        }
      } catch (err) {
        setError("Please enter a valid image URL (e.g., https://example.com/image.jpg)");
        return;
      }
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Self-transfer to ensure USDC balance
      const paymentAmount = parseUnits("0.10", 6); // $0.10 USDC
      
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [subAccountAddress as `0x${string}`, paymentAmount],
      });

      const callsId = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${chain.id.toString(16)}`,
            from: subAccountAddress,
            calls: [
              {
                to: USDC_BASE_ADDRESS as `0x${string}`,
                data: transferData,
                value: "0x0",
              },
            ],
          },
        ],
      }) as string;

      console.log("Self-transfer transaction sent:", callsId);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Create wallet client for payment
      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain,
        transport: custom(provider),
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any);

      // Prepare form data
      const formData = new FormData();
      formData.append("title", title);
      formData.append("teaser", teaser);
      formData.append("body", body);
      formData.append("priceUsd", `$${priceUsd}`); // Format with $ symbol
      formData.append("authorAddress", universalAddress);
      
      if (imageFile) {
        formData.append("image", imageFile);
      } else if (imageUrl) {
        formData.append("imageUrl", imageUrl);
      }

      // Upload with payment (retry logic)
      const maxRetries = 5;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetchWithPayment("/api/upload", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Upload failed: ${res.status} - ${errorText}`);
          }

          const result = await res.json();
          setSuccess(`Article uploaded successfully! Redirecting...`);
          
          // Redirect to homepage after 2 seconds
          setTimeout(() => {
            router.push("/");
          }, 2000);
          
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Upload attempt ${attempt}/${maxRetries} failed:`, lastError.message);

          if (attempt < maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delayMs / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to upload article";
      console.error("Upload error:", err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="container">
        <div className="article-container">
          <Link href="/" className="back-link">
            ← Back to Home
          </Link>
          <h1 className="article-page-title">Upload Article</h1>
          <p style={{ textAlign: "center", marginTop: "2rem" }}>
            Please connect your wallet to upload articles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="article-container">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        
        <h1 className="article-page-title">Upload New Article</h1>
        <div style={{ 
          textAlign: "center", 
          marginBottom: "2.5rem",
          background: "rgba(255, 255, 255, 0.15)",
          padding: "1rem",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.25)"
        }}>
          <p style={{ 
            fontSize: "1.2rem", 
            fontWeight: "600",
            margin: "0"
          }}>
            💰 Cost: $0.10
          </p>
          <p style={{ 
            fontSize: "0.95rem", 
            opacity: "0.9",
            margin: "0.5rem 0 0 0"
          }}>
            Your article will be listed immediately
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Title *</span>
              <span style={{ fontSize: "0.85rem", opacity: title.length > MAX_TITLE_LENGTH ? 1 : 0.7, color: title.length > MAX_TITLE_LENGTH ? "#ff6b6b" : "white" }}>
                {title.length}/{MAX_TITLE_LENGTH}
              </span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={MAX_TITLE_LENGTH}
              className="input"
              placeholder="Enter article title"
            />
          </div>

          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Teaser (Brief Description) *</span>
              <span style={{ fontSize: "0.85rem", opacity: teaser.length > MAX_TEASER_LENGTH ? 1 : 0.7, color: teaser.length > MAX_TEASER_LENGTH ? "#ff6b6b" : "white" }}>
                {teaser.length}/{MAX_TEASER_LENGTH}
              </span>
            </label>
            <textarea
              value={teaser}
              onChange={(e) => setTeaser(e.target.value)}
              required
              maxLength={MAX_TEASER_LENGTH}
              rows={3}
              className="input"
              style={{ fontFamily: "inherit", resize: "vertical" }}
              placeholder="Brief description that appears on article cards"
            />
          </div>

          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Body (Markdown Supported) *</span>
              <span style={{ fontSize: "0.85rem", opacity: body.length > MAX_BODY_LENGTH ? 1 : 0.7, color: body.length > MAX_BODY_LENGTH ? "#ff6b6b" : "white" }}>
                {body.length}/{MAX_BODY_LENGTH}
              </span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={MAX_BODY_LENGTH}
              rows={12}
              className="input"
              style={{ resize: "vertical" }}
              placeholder="Write your article content here. Markdown is supported."
            />
          </div>

          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem" }}>
              Price to Unlock in $ (minimum $0.01) *
            </label>
            <input
              type="number"
              value={priceUsd}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPriceUsd(e.target.value)}
              required
              min="0.01"
              step="0.01"
              className="input"
              style={{ width: "200px" }}
              placeholder="0.01"
            />
          </div>

          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem" }}>
              Image URL (Optional)
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => {
                const value = e.target.value;
                setImageUrl(value);
                setUrlError(validateImageUrl(value));
              }}
              disabled={!!imageFile}
              className="input"
              style={{
                borderColor: urlError ? "rgba(255, 107, 107, 0.5)" : undefined,
              }}
              placeholder="https://example.com/image.jpg"
            />
            {urlError && (
              <small style={{ display: "block", marginTop: "0.5rem", color: "#ff6b6b" }}>
                {urlError}
              </small>
            )}
            {imageUrl && !urlError && (
              <small style={{ display: "block", marginTop: "0.5rem", color: "#90ee90" }}>
                ✓ Valid URL
              </small>
            )}
          </div>

          <div className="input-group">
            <label className="input-label" style={{ color: "white", fontSize: "1rem" }}>
              Or Upload Image (Optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > MAX_IMAGE_SIZE_BYTES) {
                    setError(`Image size must be ${MAX_IMAGE_SIZE_MB}MB or less. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
                    e.target.value = ""; // Clear the file input
                    return;
                  }
                  setImageFile(file);
                  setImageUrl(""); // Clear URL if file is selected
                  setUrlError(""); // Clear URL error
                  setError(""); // Clear any previous errors
                }
              }}
              style={{
                color: "white",
                fontSize: "1rem",
              }}
            />
            <small style={{ display: "block", marginTop: "0.5rem", opacity: "0.8" }}>
              Max file size: {MAX_IMAGE_SIZE_MB}MB
              {imageFile && ` • Selected: ${(imageFile.size / (1024 * 1024)).toFixed(2)}MB`}
            </small>
          </div>

          <div style={{ 
            marginBottom: "1.5rem", 
            padding: "1.25rem", 
            background: "rgba(255, 255, 255, 0.1)", 
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.2)"
          }}>
            <label className="input-label" style={{ color: "white", fontSize: "1rem" }}>
              Author {userDisplayName && `(${userDisplayName})`}
            </label>
            <input
              type="text"
              value={universalAddress}
              disabled
              className="input"
              style={{
                opacity: "0.7",
                cursor: "not-allowed"
              }}
            />
          </div>

          {error && (
            <div className="error-message" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: "1rem",
              marginBottom: "1rem",
              background: "rgba(76, 175, 80, 0.2)",
              border: "1px solid rgba(76, 175, 80, 0.5)",
              borderRadius: "8px",
              color: "#90ee90",
            }}>
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="unlock-button-small"
            style={{ width: "100%", padding: "1rem", fontSize: "1.1rem" }}
          >
            {loading ? "Uploading..." : "Upload Article ($0.10 USDC)"}
          </button>
        </form>
      </div>
    </div>
  );
}

