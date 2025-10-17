"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Article } from "@/lib/articles";
import { ArticleStats } from "@/lib/redis";
import { useBaseAccount } from "../providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, parseUnits, encodeFunctionData, formatUnits, createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import Link from "next/link";
import { getUserInfoClient, type NeynarUserInfo } from "@/lib/neynar";
import Avatar from "../components/Avatar";
import { erc20Abi } from "viem";
import { fetchPermissions, getPermissionStatus, prepareRevokeCallData, requestSpendPermission, prepareSpendCallData } from "@base-org/account/spend-permission";

const USDC_BASE_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

export default function AccountPage() {
  const router = useRouter();
  const { connected, connect, loading: connectLoading, provider, subAccountAddress, universalAddress } = useBaseAccount();
  const [loadingArticle, setLoadingArticle] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [myArticles, setMyArticles] = useState<Article[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [statsMap, setStatsMap] = useState<Record<string, ArticleStats>>({});
  const [userInfo, setUserInfo] = useState<NeynarUserInfo | null>(null);
  
  // Admin features state
  const [universalBalance, setUniversalBalance] = useState<string | null>(null);
  const [subBalance, setSubBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  const [revokingPermissionId, setRevokingPermissionId] = useState<number | null>(null);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [allowanceAmount, setAllowanceAmount] = useState("10");
  const [periodInDays, setPeriodInDays] = useState("30");
  const [spendingFromPermission, setSpendingFromPermission] = useState<number | null>(null);
  const [spendAmount, setSpendAmount] = useState("1");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("1");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendStatus, setSendStatus] = useState("Ready");

  // Load articles and stats
  useEffect(() => {
    async function fetchArticlesAndStats() {
      try {
        const [articlesRes, statsRes] = await Promise.all([
          fetch("/api/articles"),
          fetch("/api/articles/stats"),
        ]);
        
        if (articlesRes.ok) {
          const allArticles = await articlesRes.json();
          // Filter for user's articles
          if (universalAddress) {
            const filtered = allArticles.filter(
              (article: Article) => article.authorAddress.toLowerCase() === universalAddress.toLowerCase()
            );
            setMyArticles(filtered);
          }
        }

        if (statsRes.ok) {
          const stats = await statsRes.json();
          setStatsMap(stats);
        }
      } catch (error) {
        console.error("Failed to load articles and stats:", error);
      } finally {
        setLoadingArticles(false);
      }
    }
    
    if (universalAddress) {
      fetchArticlesAndStats();
    } else {
      setLoadingArticles(false);
    }
  }, [universalAddress]);

  // Fetch user info when connected
  useEffect(() => {
    async function fetchUserInfo() {
      if (universalAddress && connected) {
        const info = await getUserInfoClient(universalAddress);
        setUserInfo(info);
      } else {
        setUserInfo(null);
      }
    }
    fetchUserInfo();
  }, [universalAddress, connected]);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!universalAddress && !subAccountAddress) return;

    setBalanceLoading(true);
    try {
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      if (universalAddress) {
        const balance = await publicClient.readContract({
          address: USDC_BASE_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [universalAddress as `0x${string}`],
        });
        setUniversalBalance(formatUnits(balance as bigint, 6));
      }

      if (subAccountAddress) {
        const balance = await publicClient.readContract({
          address: USDC_BASE_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [subAccountAddress as `0x${string}`],
        });
        setSubBalance(formatUnits(balance as bigint, 6));
      }
    } catch (err) {
      console.error("Error fetching balances:", err);
    } finally {
      setBalanceLoading(false);
    }
  }, [universalAddress, subAccountAddress]);

  useEffect(() => {
    if (connected && (universalAddress || subAccountAddress)) {
      fetchBalances();
      const interval = setInterval(fetchBalances, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [connected, universalAddress, subAccountAddress, fetchBalances]);

  // Check permissions
  const checkPermissions = useCallback(async () => {
    if (!provider || !universalAddress || !subAccountAddress) return;

    setCheckingPermissions(true);
    try {
      const perms = await fetchPermissions({
        account: universalAddress,
        chainId: chain.id,
        spender: subAccountAddress,
        provider,
      });

      const permissionsWithStatus = await Promise.all(
        perms.map(async (perm) => {
          try {
            const status = await getPermissionStatus(perm);
            return { ...perm, status };
          } catch (err) {
            return { ...perm, status: null, error: err };
          }
        })
      );

      setPermissions(permissionsWithStatus);
    } catch (err) {
      console.error("Error checking permissions:", err);
    } finally {
      setCheckingPermissions(false);
    }
  }, [provider, universalAddress, subAccountAddress]);

  useEffect(() => {
    if (connected && provider && universalAddress && subAccountAddress) {
      checkPermissions();
    }
  }, [connected, provider, universalAddress, subAccountAddress, checkPermissions]);

  const unlockArticle = async (slug: string, priceUsd: string) => {
    if (!connected) {
      setErrors(prev => ({ ...prev, [slug]: "Please connect your wallet first" }));
      return;
    }

    if (!provider || !subAccountAddress) {
      setErrors(prev => ({ ...prev, [slug]: "Provider not available" }));
      return;
    }

    setLoadingArticle(slug);
    setErrors(prev => ({ ...prev, [slug]: "" }));

    try {
      const priceValue = priceUsd.replace("$", "");
      const paymentAmount = parseUnits(priceValue, 6);
      
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
            capabilities: {
              paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL as string },
            },
          },
        ],
      }) as string;

      console.log("Self-transfer transaction sent:", callsId);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Record the purchase with user info
      if (universalAddress && userInfo) {
        try {
          await fetch(`/api/articles/${slug}/purchase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              universalAddress: universalAddress,
              subAccountAddress,
              username: userInfo.username,
              displayName: userInfo.displayName,
              pfpUrl: userInfo.pfpUrl,
            }),
          });
        } catch (err) {
          console.error("Failed to record purchase:", err);
        }
      }

      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain,
        transport: custom(provider),
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any);
      const maxRetries = 5;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetchWithPayment(`/api/articles/${slug}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to unlock article: ${res.status} - ${errorText}`);
          }

          console.log("Article unlocked successfully");
          router.push(`/articles/${slug}`);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Payment attempt ${attempt}/${maxRetries} failed:`, lastError.message);

          if (attempt < maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delayMs / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to unlock article";
      console.error("Payment error details:", err);
      setErrors(prev => ({ ...prev, [slug]: errorMsg }));
    } finally {
      setLoadingArticle(null);
    }
  };

  const sendUSDC = useCallback(async () => {
    if (!provider || !subAccountAddress || !recipientAddress) {
      setSendStatus("Missing required fields");
      return;
    }

    if (parseFloat(usdcAmount) <= 0) {
      setSendStatus("Amount must be greater than 0");
      return;
    }

    setSendLoading(true);
    setSendStatus("Preparing USDC transfer...");

    try {
      const amountInUnits = parseUnits(usdcAmount, 6);

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipientAddress as `0x${string}`, amountInUnits],
      });

      setSendStatus("Sending transaction...");

      const callsId = (await provider.request({
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
                data: data,
                value: "0x0",
              },
            ],
            capabilities: {
              paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL as string },
            },
          },
        ],
      })) as string;

      setSendStatus(`✓ Transaction sent! Calls ID: ${callsId}`);
      setRecipientAddress("");
      setUsdcAmount("1");
      setTimeout(() => fetchBalances(), 3000);
    } catch (error) {
      console.error("Transaction failed:", error);
      setSendStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSendLoading(false);
    }
  }, [provider, subAccountAddress, recipientAddress, usdcAmount, fetchBalances]);

  const revokePermission = useCallback(async (permissionIndex: number) => {
    if (!provider || !subAccountAddress || !universalAddress) {
      setSendStatus("Missing provider or account addresses");
      return;
    }

    const permissionWithStatus = permissions[permissionIndex];
    if (!permissionWithStatus) {
      setSendStatus("Permission not found");
      return;
    }

    setRevokingPermissionId(permissionIndex);
    setSendStatus("Revoking spend permission...");

    try {
      const freshPermissions = await fetchPermissions({
        account: universalAddress,
        chainId: chain.id,
        spender: subAccountAddress,
        provider,
      });

      const permission = freshPermissions[permissionIndex];
      if (!permission) {
        setSendStatus("Permission not found in fresh fetch");
        return;
      }

      const revokeCalls = await prepareRevokeCallData(permission);
      const callsArray = Array.isArray(revokeCalls) ? revokeCalls : [revokeCalls];

      await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${chain.id.toString(16)}`,
            from: subAccountAddress,
            calls: callsArray.map(call => ({
              to: call.to,
              data: call.data,
              value: call.value || "0x0",
            })),
            capabilities: {
              paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL as string },
            },
          },
        ],
      });

      setSendStatus(`✓ Spend permission revoked successfully!`);
      setTimeout(async () => {
        await checkPermissions();
      }, 3000);
    } catch (error) {
      console.error("Revoke failed:", error);
      setSendStatus(`Error revoking permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setRevokingPermissionId(null);
    }
  }, [provider, subAccountAddress, universalAddress, permissions, checkPermissions]);

  const requestNewSpendPermission = useCallback(async () => {
    if (!provider || !universalAddress || !subAccountAddress) {
      setSendStatus("Missing provider or account addresses");
      return;
    }

    if (parseFloat(allowanceAmount) <= 0) {
      setSendStatus("Allowance amount must be greater than 0");
      return;
    }

    setRequestingPermission(true);
    setSendStatus("Requesting spend permission...");

    try {
      await requestSpendPermission({
        account: universalAddress,
        spender: subAccountAddress,
        token: USDC_BASE_ADDRESS as `0x${string}`,
        chainId: chain.id,
        allowance: parseUnits(allowanceAmount, 6),
        periodInDays: parseInt(periodInDays),
        provider,
      });

      setSendStatus(`✓ Spend permission requested successfully!`);
      await checkPermissions();
    } catch (error) {
      console.error("Request permission failed:", error);
      setSendStatus(`Error requesting permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setRequestingPermission(false);
    }
  }, [provider, universalAddress, subAccountAddress, allowanceAmount, periodInDays, checkPermissions]);

  const useSpendPermission = useCallback(async (permissionIndex: number) => {
    if (!provider || !subAccountAddress || !universalAddress) {
      setSendStatus("Missing provider or account addresses");
      return;
    }

    const permissionWithStatus = permissions[permissionIndex];
    if (!permissionWithStatus) {
      setSendStatus("Permission not found");
      return;
    }

    if (!permissionWithStatus.status?.isActive) {
      setSendStatus("Permission is not active");
      return;
    }

    const spendAmountInUnits = parseUnits(spendAmount, 6);
    if (permissionWithStatus.status.remainingSpend < spendAmountInUnits) {
      setSendStatus("Insufficient remaining spend allowance");
      return;
    }

    setSpendingFromPermission(permissionIndex);
    setSendStatus("Using spend permission to transfer USDC to sub account...");

    try {
      const freshPermissions = await fetchPermissions({
        account: universalAddress,
        chainId: chain.id,
        spender: subAccountAddress,
        provider,
      });

      const permission = freshPermissions[permissionIndex];
      if (!permission) {
        setSendStatus("Permission not found in fresh fetch");
        return;
      }

      const spendCalls = await prepareSpendCallData(permission, spendAmountInUnits);
      const callsArray = Array.isArray(spendCalls) ? spendCalls : [spendCalls];

      await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${chain.id.toString(16)}`,
            from: subAccountAddress,
            calls: callsArray.map(call => ({
              to: call.to,
              data: call.data,
              value: call.value || "0x0",
            })),
            capabilities: {
              paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL as string },
            },
          },
        ],
      });

      setSendStatus(`✓ Spent ${spendAmount} USDC using permission! Transaction sent.`);
      setTimeout(async () => {
        await checkPermissions();
        await fetchBalances();
      }, 3000);
    } catch (error) {
      console.error("Spend failed:", error);
      setSendStatus(`Error spending with permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSpendingFromPermission(null);
    }
  }, [provider, subAccountAddress, universalAddress, permissions, spendAmount, checkPermissions, fetchBalances]);

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    });
  };

  const renderStars = (score: number | null) => {
    if (score === null) return <span style={{ fontSize: "0.85rem", color: "#ccc" }}>No ratings</span>;
    const fullStars = Math.floor(score);
    const hasHalfStar = score % 1 >= 0.5;
    const stars = [];
    
    for (let i = 0; i < fullStars; i++) {
      stars.push("★");
    }
    if (hasHalfStar) {
      stars.push("☆");
    }
    
    return (
      <span style={{ color: "#ffd700", fontSize: "0.9rem" }}>
        {stars.join("")} {score.toFixed(1)}
      </span>
    );
  };

  const calculateEarnings = (article: Article) => {
    const stats = statsMap[article.slug] || { totalPurchases: 0 };
    const priceValue = parseFloat(article.priceUsd.replace("$", ""));
    return priceValue * stats.totalPurchases;
  };

  const calculateTotalEarnings = () => {
    return myArticles.reduce((total, article) => {
      return total + calculateEarnings(article);
    }, 0);
  };

  if (!connected) {
    return (
      <div className="container">
        <header className="header">
          <h1 className="site-title">My BasePosts</h1>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={connect}
              disabled={connectLoading}
              className="connect-button"
            >
              {connectLoading ? "Connecting..." : "Login"}
            </button>
            <Link href="/">
              <button className="connect-button">
                Back to Home
              </button>
            </Link>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="header">
        <h1 className="site-title">My BasePosts</h1>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <div className="connected-badge" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {userInfo && (
              <Avatar pfpUrl={userInfo.pfpUrl} displayName={userInfo.displayName} size={24} />
            )}
            {userInfo ? userInfo.displayName : "Connected"}
          </div>
          <Link href="/">
            <button className="connect-button">
              Back to Home
            </button>
          </Link>
          <Link href="/upload">
            <button className="connect-button">
              Publish
            </button>
          </Link>
        </div>
        {universalAddress && (
          <div style={{ 
            marginTop: "24px", 
            fontSize: "0.9rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "16px",
          }}>
            <div style={{
              padding: "20px",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}>
              <div style={{ fontSize: "0.85rem", opacity: 0.7, fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Base Account
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", opacity: 0.9 }}>
                {universalAddress}
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "#4ade80", marginTop: "4px" }}>
                {balanceLoading ? "..." : `${universalBalance || "0"}`} <span style={{ fontSize: "1rem", opacity: 0.8 }}>USDC</span>
              </div>
            </div>

            <div style={{
              padding: "20px",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}>
              <div style={{ fontSize: "0.85rem", opacity: 0.7, fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Sub Account
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", opacity: 0.9 }}>
                {subAccountAddress}
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "700", color: "#4ade80", marginTop: "4px" }}>
                {balanceLoading ? "..." : `${subBalance || "0"}`} <span style={{ fontSize: "1rem", opacity: 0.8 }}>USDC</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Earnings Summary */}
      {myArticles.length > 0 && (
        <div
          style={{
            marginBottom: "32px",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "16px",
            padding: "32px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Total Earnings</h2>
          <p style={{ fontSize: "2.5rem", fontWeight: "bold", color: "#4ade80" }}>
            ${calculateTotalEarnings().toFixed(2)} USDC
          </p>
          <p style={{ fontSize: "1rem", opacity: 0.8, marginTop: "8px" }}>
            From {myArticles.length} {myArticles.length === 1 ? "article" : "articles"}
          </p>
        </div>
      )}

      <main className="articles-grid">
        {loadingArticles ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            Loading your articles...
          </div>
        ) : myArticles.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            <Link href="/upload">
              <button className="connect-button">
                Publish Your First Article
              </button>
            </Link>
          </div>
        ) : (
          myArticles.map((article) => {
            const stats = statsMap[article.slug] || {
              totalPurchases: 0,
              averageScore: null,
              lastPurchaseTimestamp: null,
              purchasedBy: [],
              totalRatings: 0,
            };
            const earnings = calculateEarnings(article);
            
            return (
            <div key={article.slug} className="article-card">
              {article.imageUrl && (
                <div className="article-image">
                  <img 
                    src={article.imageUrl} 
                    alt={article.title}
                  />
                </div>
              )}
              <div className="article-content">
                <h2 className="article-title">{article.title}</h2>
                <p className="article-teaser">{article.teaser}</p>
                <p style={{ fontSize: "0.85rem", color: "#ccc", marginTop: "0.5rem" }}>
                  Published {formatDate(article.uploadedAt)}
                </p>
                <div style={{ 
                  fontSize: "0.85rem", 
                  marginTop: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  opacity: 0.9
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>📊 {stats.totalPurchases} purchases</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {renderStars(stats.averageScore)}
                    {stats.totalRatings > 0 && (
                      <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                        ({stats.totalRatings} {stats.totalRatings === 1 ? "rating" : "ratings"})
                      </span>
                    )}
                  </div>
                  {stats.recentPurchases && stats.recentPurchases.length > 0 && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "0.8rem", marginBottom: "6px", opacity: 0.8 }}>
                        Recent purchasers:
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {stats.recentPurchases.slice(0, 10).map((purchase) => (
                          <div
                            key={purchase.universalAddress}
                            title={purchase.displayName}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "4px 8px",
                              borderRadius: "8px",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              fontSize: "0.75rem",
                            }}
                          >
                            <Avatar 
                              pfpUrl={purchase.pfpUrl} 
                              displayName={purchase.displayName} 
                              size={20} 
                            />
                            <span>{purchase.displayName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: "8px",
                    marginTop: "8px",
                    padding: "8px",
                    background: "rgba(74, 222, 128, 0.2)",
                    borderRadius: "8px",
                  }}>
                    <span style={{ fontWeight: "600", color: "#4ade80" }}>
                      💰 Earned: ${earnings.toFixed(2)} USDC
                    </span>
                  </div>
                </div>
                <div className="article-footer-vertical">
                  {errors[article.slug] && (
                    <div className="error-message">{errors[article.slug]}</div>
                  )}
                  <button
                    onClick={() => unlockArticle(article.slug, article.priceUsd)}
                    disabled={loadingArticle === article.slug}
                    className="unlock-button-small"
                  >
                    {loadingArticle === article.slug ? "Unlocking..." : `View Article (${article.priceUsd})`}
                  </button>
                </div>
              </div>
            </div>
            );
          })
        )}
      </main>

      {/* Admin Features */}
      {myArticles.length > 0 && (
        <>
          {/* Request New Spend Permission */}
          <div style={{
            marginTop: "48px",
            marginBottom: "32px",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "16px",
            padding: "32px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Request New Spend Permission</h2>
            <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "24px" }}>
              Allow Sub Account to spend USDC from Base Account
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
                  Allowance Amount (USDC per period):
                </label>
                <input
                  type="number"
                  value={allowanceAmount}
                  onChange={(e) => setAllowanceAmount(e.target.value)}
                  placeholder="10"
                  step="0.01"
                  min="0"
                  disabled={requestingPermission}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    background: "rgba(0, 0, 0, 0.2)",
                    color: "white",
                    fontSize: "1rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
                  Period (days):
                </label>
                <input
                  type="number"
                  value={periodInDays}
                  onChange={(e) => setPeriodInDays(e.target.value)}
                  placeholder="30"
                  min="1"
                  disabled={requestingPermission}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    background: "rgba(0, 0, 0, 0.2)",
                    color: "white",
                    fontSize: "1rem",
                  }}
                />
              </div>
              <button
                onClick={requestNewSpendPermission}
                disabled={requestingPermission || parseFloat(allowanceAmount) <= 0}
                className="connect-button"
                style={{ width: "fit-content" }}
              >
                {requestingPermission ? "Requesting..." : "Request Spend Permission"}
              </button>
            </div>
          </div>

          {/* Spend Permissions */}
          <div style={{
            marginBottom: "32px",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "16px",
            padding: "32px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "1.5rem", margin: 0 }}>Spend Permissions</h2>
              <button 
                onClick={checkPermissions} 
                disabled={checkingPermissions}
                className="connect-button"
              >
                {checkingPermissions ? "Checking..." : "Refresh"}
              </button>
            </div>

            {permissions.length === 0 ? (
              <p style={{ fontSize: "0.9rem", opacity: 0.7 }}>No spend permissions found</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                {permissions.map((perm, idx) => (
                  <div 
                    key={idx} 
                    style={{
                      padding: "24px",
                      background: "rgba(0, 0, 0, 0.2)",
                      borderRadius: "12px",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <strong>Token:</strong>{" "}
                        <code style={{ fontSize: "0.85rem" }}>{perm.permission?.token}</code>
                      </div>
                      <div>
                        <strong>Allowance:</strong>{" "}
                        {perm.permission?.allowance ? formatUnits(BigInt(perm.permission.allowance), 6) : "0"} USDC
                      </div>
                      {perm.status && (
                        <>
                          <div>
                            <strong>Status:</strong>{" "}
                            <span style={{ color: perm.status.isActive ? "#4ade80" : "#f87171" }}>
                              {perm.status.isActive ? "✓ Active" : "✗ Inactive"}
                            </span>
                          </div>
                          <div>
                            <strong>Remaining Spend:</strong>{" "}
                            {perm.status.remainingSpend ? formatUnits(perm.status.remainingSpend, 6) : "0"} USDC
                          </div>
                          {perm.status.isActive && (
                            <div style={{ marginTop: "16px" }}>
                              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
                                Amount to Spend (USDC):
                              </label>
                              <input
                                type="number"
                                value={spendAmount}
                                onChange={(e) => setSpendAmount(e.target.value)}
                                placeholder="1"
                                step="0.01"
                                min="0"
                                disabled={spendingFromPermission === idx}
                                style={{
                                  width: "100%",
                                  padding: "12px",
                                  borderRadius: "8px",
                                  border: "1px solid rgba(255, 255, 255, 0.3)",
                                  background: "rgba(0, 0, 0, 0.2)",
                                  color: "white",
                                  fontSize: "1rem",
                                  marginBottom: "12px",
                                }}
                              />
                              <button
                                onClick={() => useSpendPermission(idx)}
                                disabled={spendingFromPermission === idx || parseFloat(spendAmount) <= 0}
                                className="connect-button"
                                style={{ width: "fit-content", marginRight: "12px" }}
                              >
                                {spendingFromPermission === idx ? "Spending..." : "Use Permission to Spend"}
                              </button>
                            </div>
                          )}
                          <button
                            onClick={() => revokePermission(idx)}
                            disabled={revokingPermissionId === idx}
                            className="connect-button"
                            style={{ width: "fit-content", marginTop: "12px" }}
                          >
                            {revokingPermissionId === idx ? "Revoking..." : "Revoke Permission"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Send USDC */}
          <div style={{
            marginBottom: "32px",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "16px",
            padding: "32px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Send USDC from Sub Account</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
                  Recipient Address:
                </label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="0x..."
                  disabled={sendLoading}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    background: "rgba(0, 0, 0, 0.2)",
                    color: "white",
                    fontSize: "1rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
                  Amount (USDC):
                </label>
                <input
                  type="number"
                  value={usdcAmount}
                  onChange={(e) => setUsdcAmount(e.target.value)}
                  placeholder="1"
                  step="0.01"
                  min="0"
                  disabled={sendLoading}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.3)",
                    background: "rgba(0, 0, 0, 0.2)",
                    color: "white",
                    fontSize: "1rem",
                  }}
                />
              </div>
              <button
                onClick={sendUSDC}
                disabled={sendLoading || !recipientAddress || parseFloat(usdcAmount) <= 0}
                className="connect-button"
                style={{ width: "fit-content" }}
              >
                {sendLoading ? "Sending..." : `Send ${usdcAmount} USDC`}
              </button>
              {sendStatus && (
                <p style={{ 
                  fontSize: "0.9rem", 
                  color: sendStatus.includes("✓") ? "#4ade80" : sendStatus.includes("Error") ? "#f87171" : "white",
                  marginTop: "8px"
                }}>
                  {sendStatus}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <footer className="footer">
        <p>BasePost - Powered by Base Sub Accounts + x402</p>
      </footer>
    </div>
  );
}

