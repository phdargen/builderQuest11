"use client";

import { createBaseAccountSDK } from "@base-org/account";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { base, baseSepolia } from "viem/chains";

const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

interface BaseAccountContextType {
  provider: ReturnType<ReturnType<typeof createBaseAccountSDK>["getProvider"]> | null;
  connected: boolean;
  universalAddress: string;
  subAccountAddress: string;
  connect: () => Promise<void>;
  loading: boolean;
}

const BaseAccountContext = createContext<BaseAccountContextType>({
  provider: null,
  connected: false,
  universalAddress: "",
  subAccountAddress: "",
  connect: async () => {},
  loading: false,
});

export function useBaseAccount() {
  return useContext(BaseAccountContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ReturnType<
    ReturnType<typeof createBaseAccountSDK>["getProvider"]
  > | null>(null);
  const [connected, setConnected] = useState(false);
  const [universalAddress, setUniversalAddress] = useState("");
  const [subAccountAddress, setSubAccountAddress] = useState("");
  const [loading, setLoading] = useState(false);

  // Initialize SDK with quickstart configuration
  useEffect(() => {
    const initializeSDK = async () => {
      try {
        const sdkInstance = createBaseAccountSDK({
          appName: "BasePost",
          appLogoUrl: process.env.NEXT_PUBLIC_URL+"/basePost.png" as string,
          appChainIds: [chain.id],
          // Quickstart configuration for sub accounts with spend permissions
          subAccounts: {
            creation: "on-connect",
            defaultAccount: "sub",
            funding: "spend-permissions", // This enables automatic spend permissions
          },
          paymasterUrls: {
            [chain.id]: process.env.NEXT_PUBLIC_PAYMASTER_URL as string,
          },
        });

        const providerInstance = sdkInstance.getProvider();
        setProvider(providerInstance);
      } catch (error) {
        console.error("SDK initialization failed:", error);
      }
    };

    initializeSDK();
  }, []);

  const connect = async () => {
    if (!provider) {
      console.error("Provider not initialized");
      return;
    }

    setLoading(true);

    try {
      // With quickstart config, this will automatically create a sub account
      await provider.request({
        method: "wallet_connect",
        params: [],
      });

      const accounts = (await provider.request({
        method: "eth_requestAccounts",
        params: [],
      })) as string[];

      // With defaultAccount: 'sub', the sub account is the first account
      const subAddr = accounts[0];
      const universalAddr = accounts[1];

      setSubAccountAddress(subAddr);
      setUniversalAddress(universalAddr);
      setConnected(true);

      console.log("Connected - Sub Account:", subAddr);
      console.log("Connected - Universal Account:", universalAddr);
    } catch (error) {
      console.error("Connection failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseAccountContext.Provider
      value={{
        provider,
        connected,
        universalAddress,
        subAccountAddress,
        connect,
        loading,
      }}
    >
      {children}
    </BaseAccountContext.Provider>
  );
}

