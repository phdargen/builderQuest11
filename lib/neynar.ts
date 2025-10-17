/**
 * Neynar API utilities for fetching user display names and profile info
 */

import { getName, getAvatar } from '@coinbase/onchainkit/identity';
import { base } from 'viem/chains';

export interface NeynarUserInfo {
  username: string;
  displayName: string;
  pfpUrl: string | null;
}

interface NeynarUser {
  fid?: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
  verifications?: string[];
}

interface NeynarBulkUsersResponse {
  users: NeynarUser[];
}

/**
 * Try to fetch ENS name and avatar using OnchainKit as a fallback
 */
async function getOnchainKitUserInfo(address: string): Promise<NeynarUserInfo | null> {
  try {
    // Try with base chain first
    let ensName: string | null = null;
    try {
      ensName = await getName({ address: address as `0x${string}`, chain: base });
    } catch (error) {
      // If base chain fails, try mainnet
      try {
        ensName = await getName({ address: address as `0x${string}` });
      } catch (innerError) {
        console.log("OnchainKit getName failed:", innerError);
        return null;
      }
    }

    if (!ensName) {
      return null;
    }

    // Try to get avatar using the ENS name
    let pfpUrl: string | null = null;
    try {
      pfpUrl = await getAvatar({ ensName, chain: base });
    } catch (error) {
      // If base chain fails, try mainnet
      try {
        pfpUrl = await getAvatar({ ensName });
      } catch (innerError) {
        console.log("OnchainKit getAvatar failed on both base and mainnet:", innerError);
        // Continue without avatar - we still have the ENS name
      }
    }

    return {
      username: ensName,
      displayName: ensName,
      pfpUrl,
    };
  } catch (error) {
    console.error("Error fetching OnchainKit user info:", error);
    return null;
  }
}

/**
 * Fetch full user info from Neynar API using wallet address
 * Returns username, display name, and profile picture URL
 */
export async function getUserInfo(address: string): Promise<NeynarUserInfo> {
  const fallback: NeynarUserInfo = {
    username: truncateAddress(address),
    displayName: truncateAddress(address),
    pfpUrl: null,
  };

  if (!address) {
    return fallback;
  }

  try {
    const apiKey = process.env.NEYNAR_API_KEY;
    
    if (!apiKey) {
      console.warn("NEYNAR_API_KEY not configured, trying OnchainKit fallback");
      // Try OnchainKit as fallback before returning truncated address
      const onchainKitInfo = await getOnchainKitUserInfo(address);
      if (onchainKitInfo) {
        return onchainKitInfo;
      }
      return fallback;
    }

    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${address.toLowerCase()}`,
      {
        headers: {
          "accept": "application/json",
          "api_key": apiKey,
        },
      }
    );

    // Handle 404 - No Farcaster account linked to this address (common case)
    if (response.status === 404) {
      // Try OnchainKit as fallback before returning truncated address
      const onchainKitInfo = await getOnchainKitUserInfo(address);
      if (onchainKitInfo) {
        return onchainKitInfo;
      }
      return fallback;
    }

    if (!response.ok) {
      console.warn(`Neynar API error: ${response.status}`);
      // Try OnchainKit as fallback before returning truncated address
      const onchainKitInfo = await getOnchainKitUserInfo(address);
      if (onchainKitInfo) {
        return onchainKitInfo;
      }
      return fallback;
    }

    const data = await response.json() as Record<string, NeynarUser[]>;
    
    // The response is an object with addresses as keys
    const users = data[address.toLowerCase()];
    
    if (users && users.length > 0) {
      const user = users[0];
      return {
        username: user.username || truncateAddress(address),
        displayName: user.display_name || (user.username ? `@${user.username}` : truncateAddress(address)),
        pfpUrl: user.pfp_url || null,
      };
    }

    return fallback;
  } catch (error) {
    console.error("Error fetching user info from Neynar:", error);
    return fallback;
  }
}

/**
 * Fetch display name from Neynar API using wallet address
 * Falls back to truncated address if no display name found
 * @deprecated Use getUserInfo() instead for full user data
 */
export async function getDisplayName(address: string): Promise<string> {
  const userInfo = await getUserInfo(address);
  return userInfo.displayName;
}

/**
 * Truncate an Ethereum address for display
 */
function truncateAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Client-side user info fetcher (uses API route to avoid exposing API key)
 */
export async function getUserInfoClient(address: string): Promise<NeynarUserInfo> {
  const fallback: NeynarUserInfo = {
    username: truncateAddress(address),
    displayName: truncateAddress(address),
    pfpUrl: null,
  };

  if (!address) {
    return fallback;
  }

  try {
    const response = await fetch(`/api/display-name?address=${encodeURIComponent(address)}`);
    
    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();
    return {
      username: data.username || fallback.username,
      displayName: data.displayName || fallback.displayName,
      pfpUrl: data.pfpUrl || null,
    };
  } catch (error) {
    console.error("Error fetching user info:", error);
    return fallback;
  }
}

