"use client";

import { useState, useEffect } from "react";
import { useBaseAccount } from "@/app/providers";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, custom, createPublicClient, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { requestSpendPermission, getPermissionStatus, fetchPermissions, prepareSpendCallData } from "@base-org/account/spend-permission";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export function ArticlePanel({ slug, priceUsd }: { slug: string; priceUsd: string }) {
  const { provider, connected, connect, loading: connectLoading, subAccountAddress, universalAddress } = useBaseAccount();
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(false);

  // Check for existing spend permission when connected
  useEffect(() => {
    if (connected && provider && subAccountAddress && universalAddress) {
      checkSpendPermission();
    }
  }, [connected, subAccountAddress, universalAddress]);

  async function checkSpendPermission() {
    if (!provider || !subAccountAddress || !universalAddress) return;

    setCheckingPermission(true);
    try {
      // Check if spend permission already exists
      console.log("Checking spend permission...");
      const permissions = await fetchPermissions({
        account: universalAddress,
        chainId: baseSepolia.id,
        spender: subAccountAddress,
        provider,
      });

      if (permissions.length > 0) {
        const permission = permissions[0];
        const status = await getPermissionStatus(permission);
        
        if (status.isActive && status.remainingSpend > BigInt(0)) {
          console.log("Active spend permission found:", permission);
          setHasPermission(true);
          return;
        }
      }
      
      setHasPermission(false);
    } catch (err) {
      console.error("Error checking permission:", err);
      setHasPermission(false);
    } finally {
      setCheckingPermission(false);
    }
  }

  async function setupSpendPermission() {
    if (!provider || !subAccountAddress || !universalAddress) {
      setError("Provider not available");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log("Requesting spend permission...");
      console.log("Universal Account (holder):", universalAddress);
      console.log("Sub Account (spender):", subAccountAddress);

      // Request spend permission: universal account gives permission to sub account
      const permission = await requestSpendPermission({
        account: universalAddress, // The account holding the USDC
        spender: subAccountAddress, // The sub-account that will spend
        token: USDC_BASE_SEPOLIA,
        chainId: baseSepolia.id,
        allowance: BigInt(10_000_000), // $10 worth of USDC (6 decimals)
        periodInDays: 30,
        provider,
      });

      console.log("Spend permission granted:", permission);
      setHasPermission(true);
    } catch (err) {
      console.error("Failed to setup spend permission:", err);
      setError(err instanceof Error ? err.message : "Failed to setup spend permission");
    } finally {
      setLoading(false);
    }
  }

  async function unlock() {
    if (!connected) {
      setError("Please connect your wallet first");
      return;
    }

    if (!hasPermission) {
      setError("Please setup spend permission first");
      return;
    }

    if (!provider || !subAccountAddress || !universalAddress) {
      setError("Provider not available");
      return;
    }

    console.log("Fetching article with url:", `/api/articles/${slug}`);

    try {
      setLoading(true);
      setError(null);

      // Step 1: Use spend permission to fund sub account
      console.log("Funding sub account using spend permission...");
      
      // Fetch the spend permission
      const permissions = await fetchPermissions({
        account: universalAddress,
        chainId: baseSepolia.id,
        spender: subAccountAddress,
        provider,
      });

      if (permissions.length === 0) {
        throw new Error("No spend permission found");
      }

      const permission = permissions[0];
      const status = await getPermissionStatus(permission);
      
      if (!status.isActive) {
        throw new Error("Spend permission is not active");
      }

      // Transfer amount for the article based on the article price
      const priceValue = priceUsd.replace("$", "");
      const paymentAmount = parseUnits(priceValue, 6);
      
      if (status.remainingSpend < paymentAmount) {
        throw new Error("Insufficient remaining spend allowance");
      }

      // Prepare spend calls to transfer USDC from universal to sub account
      const spendCalls = await prepareSpendCallData(permission, paymentAmount);
      const callsArray = Array.isArray(spendCalls) ? spendCalls : [spendCalls];

      console.log("Sending spend permission transaction...");
      
      // Send the transaction to fund sub account
      const txHash = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${baseSepolia.id.toString(16)}`,
            from: subAccountAddress,
            calls: callsArray.map(call => ({
              to: call.to,
              data: call.data,
              value: call.value || "0x0",
            })),
          },
        ],
      }) as string;

      console.log("Spend permission transaction sent:", txHash);

      // Step 2: Wait for transaction to be confirmed
      console.log("Waiting for transaction confirmation...");
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

    //   const receipt = await publicClient.waitForTransactionReceipt({
    //     hash: txHash as `0x${string}`,
    //   });

    //   console.log("Transaction confirmed:", receipt.transactionHash);

      // Step 3: Make the API call with the now-funded sub account
      const walletClient = createWalletClient({
        account: subAccountAddress as `0x${string}`,
        chain: baseSepolia,
        transport: custom(provider),
      });

      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as any);

      console.log("Making payment request...");
      // Make request to the protected API
      const res = await fetchWithPayment(`/api/articles/${slug}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Response error:", { status: res.status, body: errorText });
        throw new Error(`Failed to unlock article: ${res.status} - ${errorText}`);
      }

      const json = await res.json();
      setBody(json.body);
      console.log("Article unlocked successfully");
    } catch (err) {
      console.error("Payment error details:", err);
      setError(err instanceof Error ? err.message : "Failed to unlock article");
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <div className="article-panel">
        <div className="paywall-message">
          <p>Connect your wallet to unlock this article</p>
          <button 
            onClick={connect} 
            disabled={connectLoading}
            className="unlock-button"
          >
            {connectLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  if (body) {
    return (
      <article className="article-body">
        {body.split('\n\n').map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
      </article>
    );
  }

  if (checkingPermission) {
    return (
      <div className="article-panel">
        <div className="paywall-message">
          <p>Checking spend permissions...</p>
        </div>
      </div>
    );
  }

  if (!hasPermission) {
    return (
      <div className="article-panel">
        <div className="paywall-message">
          <p>Setup spend permission to enable frictionless payments</p>
          <p className="paywall-note">
            Your sub-account needs permission to spend USDC from your universal account.
            This is a one-time setup.
          </p>
          {error && <p className="error-message">{error}</p>}
          <button 
            onClick={setupSpendPermission} 
            disabled={loading}
            className="unlock-button"
          >
            {loading ? "Setting up..." : "Setup Spend Permission"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="article-panel">
      <div className="paywall-message">
        <p>This article is protected by a micropayment.</p>
        <p className="paywall-note">
          ✅ Spend permission active - payments from your sub-account!
        </p>
        {error && <p className="error-message">{error}</p>}
        <button 
          onClick={unlock} 
          disabled={loading}
          className="unlock-button"
        >
          {loading ? "Unlocking..." : "Unlock Article"}
        </button>
      </div>
    </div>
  );
}

