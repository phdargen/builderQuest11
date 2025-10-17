"use client";

import { useState, useEffect, useCallback } from "react";
import { useBaseAccount } from "@/app/providers";
import { baseSepolia } from "viem/chains";
import { encodeFunctionData, parseUnits, formatUnits, createPublicClient, http } from "viem";
import { fetchPermissions, getPermissionStatus, prepareRevokeCallData, requestSpendPermission, prepareSpendCallData } from "@base-org/account/spend-permission";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const ERC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export default function AdminPage() {
  const { provider, connected, universalAddress, subAccountAddress, connect, loading: connectLoading } = useBaseAccount();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [permissions, setPermissions] = useState<any[]>([]);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("1");
  const [universalBalance, setUniversalBalance] = useState<string | null>(null);
  const [subBalance, setSubBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [revokingPermissionId, setRevokingPermissionId] = useState<number | null>(null);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [allowanceAmount, setAllowanceAmount] = useState("10");
  const [periodInDays, setPeriodInDays] = useState("30");
  const [spendingFromPermission, setSpendingFromPermission] = useState<number | null>(null);
  const [spendAmount, setSpendAmount] = useState("1");

  const fetchBalances = useCallback(async () => {
    if (!universalAddress && !subAccountAddress) return;

    setBalanceLoading(true);
    try {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      if (universalAddress) {
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [universalAddress as `0x${string}`],
        });
        setUniversalBalance(formatUnits(balance as bigint, 6));
      }

      if (subAccountAddress) {
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS as `0x${string}`,
          abi: ERC20_ABI,
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

  useEffect(() => {
    if (connected && provider && universalAddress && subAccountAddress) {
      checkPermissions();
    }
  }, [connected, provider, universalAddress, subAccountAddress]);

  const checkPermissions = useCallback(async () => {
    if (!provider || !universalAddress || !subAccountAddress) return;

    setCheckingPermissions(true);
    try {
      const perms = await fetchPermissions({
        account: universalAddress,
        chainId: baseSepolia.id,
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
      console.log("permissionsWithStatus", permissionsWithStatus);

      setPermissions(permissionsWithStatus);
    } catch (err) {
      console.error("Error checking permissions:", err);
      setStatus(`Error checking permissions: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCheckingPermissions(false);
    }
  }, [provider, universalAddress, subAccountAddress]);

  const sendUSDC = useCallback(async () => {
    if (!provider || !subAccountAddress || !recipientAddress) {
      setStatus("Missing required fields");
      return;
    }

    if (parseFloat(usdcAmount) <= 0) {
      setStatus("Amount must be greater than 0");
      return;
    }

    setLoading(true);
    setStatus("Preparing USDC transfer...");

    try {
      const amountInUnits = parseUnits(usdcAmount, 6);

      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipientAddress as `0x${string}`, amountInUnits],
      });

      setStatus("Sending transaction...");

      const callsId = (await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0",
            atomicRequired: true,
            chainId: `0x${baseSepolia.id.toString(16)}`,
            from: subAccountAddress,
            calls: [
              {
                to: USDC_ADDRESS,
                data: data,
                value: "0x0",
              },
            ],
          },
        ],
      })) as string;

      setStatus(`✓ Transaction sent! Calls ID: ${callsId}`);
      setRecipientAddress("");
      setUsdcAmount("1");
    } catch (error) {
      console.error("Transaction failed:", error);
      setStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [provider, subAccountAddress, recipientAddress, usdcAmount]);

  const revokePermission = useCallback(async (permissionIndex: number) => {
    if (!provider || !subAccountAddress || !universalAddress) {
      setStatus("Missing provider or account addresses");
      return;
    }

    const permissionWithStatus = permissions[permissionIndex];
    if (!permissionWithStatus) {
      setStatus("Permission not found");
      return;
    }

    setRevokingPermissionId(permissionIndex);
    setStatus("Revoking spend permission...");

    try {
      // Refetch permissions to get the exact structure from fetchPermissions
      const freshPermissions = await fetchPermissions({
        account: universalAddress,
        chainId: baseSepolia.id,
        spender: subAccountAddress,
        provider,
      });

      // Find the matching permission
      const permission = freshPermissions[permissionIndex];
      if (!permission) {
        setStatus("Permission not found in fresh fetch");
        return;
      }

      console.log("Revoking permission:", permission);

      // Prepare revoke calls - this returns an array of call objects
      const revokeCalls = await prepareRevokeCallData(permission);

      console.log("Revoke calls prepared:", revokeCalls);

      // Make sure revokeCalls is an array
      const callsArray = Array.isArray(revokeCalls) ? revokeCalls : [revokeCalls];

      // Send the calls using wallet_sendCalls
      const result = await provider.request({
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

      console.log("Revoke transaction result:", result);
      setStatus(`✓ Spend permission revoked successfully!`);
      
      // Wait a bit for transaction to be processed
      setTimeout(async () => {
        await checkPermissions();
      }, 3000);
    } catch (error) {
      console.error("Revoke failed:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error
      });
      setStatus(`Error revoking permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setRevokingPermissionId(null);
    }
  }, [provider, subAccountAddress, universalAddress, permissions, checkPermissions]);

  const requestNewSpendPermission = useCallback(async () => {
    if (!provider || !universalAddress || !subAccountAddress) {
      setStatus("Missing provider or account addresses");
      return;
    }

    if (parseFloat(allowanceAmount) <= 0) {
      setStatus("Allowance amount must be greater than 0");
      return;
    }

    setRequestingPermission(true);
    setStatus("Requesting spend permission...");

    try {
      const permission = await requestSpendPermission({
        account: universalAddress,
        spender: subAccountAddress,
        token: USDC_ADDRESS,
        chainId: baseSepolia.id,
        allowance: parseUnits(allowanceAmount, 6),
        periodInDays: parseInt(periodInDays),
        provider,
      });

      console.log("Spend Permission created:", permission);
      setStatus(`✓ Spend permission requested successfully!`);
      await checkPermissions();
    } catch (error) {
      console.error("Request permission failed:", error);
      setStatus(`Error requesting permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setRequestingPermission(false);
    }
  }, [provider, universalAddress, subAccountAddress, allowanceAmount, periodInDays, checkPermissions]);

  const useSpendPermission = useCallback(async (permissionIndex: number) => {
    if (!provider || !subAccountAddress || !universalAddress) {
      setStatus("Missing provider or account addresses");
      return;
    }

    const permissionWithStatus = permissions[permissionIndex];
    if (!permissionWithStatus) {
      setStatus("Permission not found");
      return;
    }

    if (!permissionWithStatus.status?.isActive) {
      setStatus("Permission is not active");
      return;
    }

    const spendAmountInUnits = parseUnits(spendAmount, 6);
    if (permissionWithStatus.status.remainingSpend < spendAmountInUnits) {
      setStatus("Insufficient remaining spend allowance");
      return;
    }

    setSpendingFromPermission(permissionIndex);
    setStatus("Using spend permission to transfer USDC to sub account...");

    try {
      const freshPermissions = await fetchPermissions({
        account: universalAddress,
        chainId: baseSepolia.id,
        spender: subAccountAddress,
        provider,
      });

      const permission = freshPermissions[permissionIndex];
      if (!permission) {
        setStatus("Permission not found in fresh fetch");
        return;
      }

      // Prepare spend calls - this returns an array of call objects
      const spendCalls = await prepareSpendCallData(permission, spendAmountInUnits);

      console.log("Spend calls prepared:", spendCalls);

      // Make sure spendCalls is an array
      const callsArray = Array.isArray(spendCalls) ? spendCalls : [spendCalls];

      // Send the calls using wallet_sendCalls
      // Note: The calls will transfer USDC from universal account to sub account
      const result = await provider.request({
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

      console.log("Spend transaction result:", result);
      setStatus(`✓ Spent ${spendAmount} USDC using permission! Transaction sent.`);
      
      // Wait a bit for transaction to be processed
      setTimeout(async () => {
        await checkPermissions();
        await fetchBalances();
      }, 3000);
    } catch (error) {
      console.error("Spend failed:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error
      });
      setStatus(`Error spending with permission: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSpendingFromPermission(null);
    }
  }, [provider, subAccountAddress, universalAddress, permissions, spendAmount, checkPermissions, fetchBalances]);

  if (!connected) {
    return (
      <div className="container">
        <div className="card">
          <h1 className="title">Admin Panel</h1>
          <p className="subtitle">Connect your wallet to access admin features</p>
          <button onClick={connect} disabled={connectLoading} className="button">
            {connectLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1 className="title">Admin Panel</h1>

        <section className="card">
          <h2 className="section-title">Account Addresses</h2>
          <div className="info-row">
            <label className="info-label">Universal Account (Holder):</label>
            <code className="info-value">{universalAddress}</code>
          </div>
          <div className="info-row">
            <label className="info-label">Sub Account (Spender):</label>
            <code className="info-value">{subAccountAddress}</code>
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">USDC Balances</h2>
          <div className="info-row">
            <span className="info-label">Universal Account Balance:</span>
            <span className="info-value">{balanceLoading ? "Loading..." : universalBalance || "0"} USDC</span>
          </div>
          <div className="info-row">
            <span className="info-label">Sub Account Balance:</span>
            <span className="info-value">{balanceLoading ? "Loading..." : subBalance || "0"} USDC</span>
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Request New Spend Permission</h2>
          <p className="subtitle">Allow Sub Account to spend USDC from Universal Account</p>
          <div className="button-group">
            <div className="input-group">
              <label className="input-label">Allowance Amount (USDC per period):</label>
              <input
                type="number"
                value={allowanceAmount}
                onChange={(e) => setAllowanceAmount(e.target.value)}
                placeholder="10"
                step="0.01"
                min="0"
                className="input"
                disabled={requestingPermission}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Period (days):</label>
              <input
                type="number"
                value={periodInDays}
                onChange={(e) => setPeriodInDays(e.target.value)}
                placeholder="30"
                min="1"
                className="input"
                disabled={requestingPermission}
              />
            </div>

            <button
              onClick={requestNewSpendPermission}
              disabled={requestingPermission || parseFloat(allowanceAmount) <= 0}
              className="button"
            >
              {requestingPermission ? "Requesting..." : "Request Spend Permission"}
            </button>
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">Spend Permissions</h2>
          <button onClick={checkPermissions} disabled={checkingPermissions} className="button button-secondary">
            {checkingPermissions ? "Checking..." : "Refresh Permissions"}
          </button>

          {permissions.length === 0 ? (
            <p className="status-message">No spend permissions found</p>
          ) : (
            <div className="button-group">
              {permissions.map((perm, idx) => (
                <div key={idx} className="info-row">
                  <div>
                    <div className="info-label">Token:</div>
                    <code className="info-value">{perm.permission?.token}</code>
                  </div>
                  <div>
                    <div className="info-label">Allowance:</div>
                    <span className="info-value">
                      {perm.permission?.allowance ? formatUnits(BigInt(perm.permission.allowance), 6) : "0"} USDC
                    </span>
                  </div>
                  {perm.status && (
                    <>
                      <div>
                        <div className="info-label">Status:</div>
                        <span className={`info-value ${perm.status.isActive ? "success" : "error"}`}>
                          {perm.status.isActive ? "✓ Active" : "✗ Inactive"}
                        </span>
                      </div>
                      <div>
                        <div className="info-label">Remaining Spend:</div>
                        <span className="info-value">
                          {perm.status.remainingSpend
                            ? formatUnits(perm.status.remainingSpend, 6)
                            : "0"}{" "}
                          USDC
                        </span>
                      </div>
                      {perm.status.isActive && (
                        <div className="input-group" style={{ marginTop: "10px" }}>
                          <label className="input-label">Amount to Spend (USDC):</label>
                          <input
                            type="number"
                            value={spendAmount}
                            onChange={(e) => setSpendAmount(e.target.value)}
                            placeholder="1"
                            step="0.01"
                            min="0"
                            className="input"
                            disabled={spendingFromPermission === idx}
                          />
                          <button
                            onClick={() => useSpendPermission(idx)}
                            disabled={spendingFromPermission === idx || parseFloat(spendAmount) <= 0}
                            className="button"
                            style={{ marginTop: "5px" }}
                          >
                            {spendingFromPermission === idx ? "Spending..." : "Use Permission to Spend"}
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => revokePermission(idx)}
                        disabled={revokingPermissionId === idx}
                        className="button button-secondary"
                        style={{ marginTop: "10px" }}
                      >
                        {revokingPermissionId === idx ? "Revoking..." : "Revoke"}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Send USDC from Sub Account</h2>
          <div className="button-group">
            <div className="input-group">
              <label className="input-label">Recipient Address:</label>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="0x..."
                className="input"
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Amount (USDC):</label>
              <input
                type="number"
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                placeholder="1"
                step="0.01"
                min="0"
                className="input"
                disabled={loading}
              />
            </div>

            <button
              onClick={sendUSDC}
              disabled={loading || !recipientAddress || parseFloat(usdcAmount) <= 0}
              className="button"
            >
              {loading ? "Sending..." : `Send ${usdcAmount} USDC`}
            </button>
          </div>
        </section>

        <section className="card">
          <p className={`status-message ${status.includes("✓") ? "success" : status.includes("Error") ? "error" : ""}`}>
            {status}
          </p>
        </section>
      </div>
    </div>
  );
}
