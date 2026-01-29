/**
 * Temporary in-memory key storage for development
 * In production, use encrypted database storage or hardware security modules
 */

interface StoredKeys {
  userId: string;
  metaAddress: {
    spendingPublicKey: string;
    viewingPublicKey: string;
    address: string;
  };
  spendingPrivateKey: string; // Base64 encoded
  viewingPrivateKey: string;  // Base64 encoded
  createdAt: number;
}

// Global storage (in production, use encrypted database)
const keyStorage = new Map<string, StoredKeys>();

export function storeUserKeys(userId: string, keys: Omit<StoredKeys, 'userId' | 'createdAt'>): void {
  keyStorage.set(userId, {
    userId,
    ...keys,
    createdAt: Date.now()
  });
}

export function getUserKeys(userId: string): StoredKeys | undefined {
  return keyStorage.get(userId);
}

export function deleteUserKeys(userId: string): boolean {
  return keyStorage.delete(userId);
}

export function getAllStoredUserIds(): string[] {
  return Array.from(keyStorage.keys());
}
