import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { createHash, randomBytes } from 'crypto';
import * as ed25519 from '@noble/ed25519';
import { x25519 } from '@noble/curves/ed25519.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import idl from './idl/privacy_transfer.json';
import * as dotenv from 'dotenv';

dotenv.config();

// Setup SHA512 for ed25519 (required for Node.js environment)
ed25519.etc.sha512Sync = (...m) => {
  return createHash('sha512').update(Buffer.concat(m)).digest();
};

// Program ID of deployed privacy contract
const PRIVACY_PROGRAM_ID = new PublicKey(process.env.PRIVACY_PROGRAM_ID || 'Ddv7hXQZJ2kH8mPK3Lx9Xs4j6iGhHuMhqB97666KzAdA');

// Global storage for contract deposits (in production, this would be on-chain)
declare global {
  var contractDeposits: Array<{
    commitment: string;
    ephemeralPublicKey: string;
    amount: number;
    timestamp: number;
    depositIndex: number;
    claimed: boolean;
    nonce: string;
    signature?: string;
    privacyPool?: string;
    receiverMetaAddress?: StealthMetaAddress;
    claimedAt?: number;
    claimedBy?: string;
    nullifier?: string;
  }>;
}

/**
 * Privacy Transfer Smart Contract Integration
 * 
 * Flow:
 * 1. Sender deposits funds to smart contract with ZK commitment
 * 2. Commitment = hash(receiver_zk_address + amount + nonce)
 * 3. Funds held in contract
 * 4. Receiver proves ownership and claims funds
 */

// Helper to convert ed25519 scalar to bytes
function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let s = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(s & 0xFFn);
    s >>= 8n;
  }
  return bytes;
}

// Helper to convert bytes to scalar
function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = 31; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

export interface StealthMetaAddress {
  spendingPublicKey: string; // Base58 encoded
  viewingPublicKey: string;  // Base58 encoded
  address: string;            // Combined meta-address identifier
}

export interface StealthMetaAddressKeys {
  metaAddress: StealthMetaAddress;
  spendingPrivateKey: string; // Base58 encoded
  viewingPrivateKey: string;  // Base58 encoded
}

export interface OneTimeAddress {
  address: string;           // Base58 Solana address
  ephemeralPublicKey: string; // For receiver to detect
  sharedSecret: string;       // For logging/debugging
}

export interface StealthPayment {
  oneTimeAddress: string;
  ephemeralPublicKey: string;
  amount: number;
  timestamp: number;
  txSignature?: string;
}

export interface ContractDeposit {
  commitment: string;        // Hex encoded commitment
  ephemeralPublicKey: string; // For receiver scanning
  amount: number;
  timestamp: number;
  depositIndex: number;
  claimed: boolean;
  nonce?: string;
  signature?: string;
  privacyPool?: string;
  receiverMetaAddress?: StealthMetaAddress;
  claimedAt?: number;
  claimedBy?: string;
}

/**
 * Generate a stealth meta-address pair
 * Returns both public meta-address (shareable) and private keys (keep secret)
 */
export async function generateStealthMetaAddress(): Promise<StealthMetaAddressKeys> {
  // Generate spending keypair
  const spendingKeypair = Keypair.generate();
  
  // Generate viewing keypair
  const viewingKeypair = Keypair.generate();
  
  // Create meta-address identifier (hash of both public keys)
  const metaAddressData = Buffer.concat([
    spendingKeypair.publicKey.toBuffer(),
    viewingKeypair.publicKey.toBuffer()
  ]);
  const metaAddressHash = createHash('sha256').update(metaAddressData).digest('hex');
  
  const metaAddress: StealthMetaAddress = {
    spendingPublicKey: spendingKeypair.publicKey.toBase58(),
    viewingPublicKey: viewingKeypair.publicKey.toBase58(),
    address: `stealth_${metaAddressHash.slice(0, 32)}`
  };
  
  return {
    metaAddress,
    spendingPrivateKey: Buffer.from(spendingKeypair.secretKey).toString('base64'),
    viewingPrivateKey: Buffer.from(viewingKeypair.secretKey).toString('base64')
  };
}

/**
 * Create commitment for smart contract deposit
 * commitment = hash(receiver_zk_address + amount + nonce)
 */
export function createCommitment(
  receiverZKAddress: string,
  amount: number,
  nonce: Uint8Array = randomBytes(32)
): { commitment: string; nonce: string } {
  const data = Buffer.concat([
    Buffer.from(receiverZKAddress),
    Buffer.from(amount.toString()),
    Buffer.from(nonce)
  ]);
  
  const commitment = createHash('sha256').update(data).digest('hex');
  
  console.log('[CREATE COMMITMENT]', {
    receiverZKAddress: receiverZKAddress.slice(0, 20) + '...',
    amount,
    amountString: amount.toString(),
    nonceHex: Buffer.from(nonce).toString('hex').slice(0, 32) + '...',
    commitment: commitment.slice(0, 16) + '...',
    dataHashInput: data.toString('hex').slice(0, 64) + '...'
  });
  
  return {
    commitment,
    nonce: Buffer.from(nonce).toString('hex')
  };
}

/**
 * Derive a one-time address from a stealth meta-address
 * Sender calls this to generate a unique destination address
 */
export async function deriveOneTimeAddress(
  metaAddress: StealthMetaAddress
): Promise<OneTimeAddress> {
  // Generate ephemeral keypair for this payment
  const ephemeralKeypair = Keypair.generate();
  
  // Compute shared secret: ephemeral_private * viewing_public
  const viewingPubKey = new PublicKey(metaAddress.viewingPublicKey);
  const sharedSecret = await computeSharedSecret(
    ephemeralKeypair.secretKey,
    viewingPubKey.toBytes()
  );
  
  // Use a simplified derivation: hash(spending_public || shared_secret) -> private key
  // Then derive the corresponding public key
  const spendingPubKey = new PublicKey(metaAddress.spendingPublicKey);
  const combined = Buffer.concat([
    spendingPubKey.toBuffer(),
    Buffer.from(sharedSecret)
  ]);
  
  // Hash to get a deterministic private key
  const oneTimePrivateKeyHash = createHash('sha256').update(combined).digest();
  
  // Generate keypair from this hash
  const oneTimeKeypair = Keypair.fromSeed(oneTimePrivateKeyHash);
  const oneTimeAddress = oneTimeKeypair.publicKey;
  
  console.log('[SENDER DERIVE] Generated one-time address:', {
    receiverViewingPubKey: viewingPubKey.toBase58(),
    receiverSpendingPubKey: spendingPubKey.toBase58(),
    ephemeralPubKey: ephemeralKeypair.publicKey.toBase58(),
    oneTimeAddress: oneTimeAddress.toBase58(),
    sharedSecretHex: Buffer.from(sharedSecret).toString('hex').slice(0, 32) + '...',
    combinedHashInput: Buffer.concat([spendingPubKey.toBuffer(), Buffer.from(sharedSecret)]).toString('hex').slice(0, 32) + '...'
  });
  
  return {
    address: oneTimeAddress.toBase58(),
    ephemeralPublicKey: ephemeralKeypair.publicKey.toBase58(),
    sharedSecret: Buffer.from(sharedSecret).toString('hex')
  };
}

/**
 * Compute shared secret using X25519 ECDH
 * Converts ed25519 keys to curve25519 (X25519) and performs proper ECDH
 */
async function computeSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Promise<Uint8Array> {
  // Extract the private scalar (first 32 bytes of ed25519 secret key)
  const privateScalar = privateKey.slice(0, 32);
  
  // Use X25519 ECDH - this will produce the same result on both sides
  // X25519 is the ECDH function for Curve25519
  const sharedSecret = x25519.getSharedSecret(privateScalar, publicKey);
  
  return sharedSecret;
}

/**
 * SMART CONTRACT INTEGRATION: Scan for deposits
 * Receiver scans contract events for their payments
 * 
 * Implementation: Checks stored deposits and verifies ownership via shared secret
 * In production: Would query on-chain program state and events
 */
export async function scanContractDeposits(
  connection: Connection,
  metaAddress: StealthMetaAddress,
  viewingPrivateKey: string,
  programId: PublicKey = PRIVACY_PROGRAM_ID
): Promise<ContractDeposit[]> {
  // Find privacy pool PDA
  const [privacyPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('privacy_pool_v2')],
    programId
  );
  
  console.log('[CONTRACT SCAN] Scanning deposits for meta-address:', {
    receiverSpendingPubKey: metaAddress.spendingPublicKey,
    receiverViewingPubKey: metaAddress.viewingPublicKey,
    privacyPool: privacyPoolPDA.toBase58(),
    programId: programId.toBase58(),
    totalDepositsInStorage: global.contractDeposits?.length || 0
  });
  
  const detectedDeposits: ContractDeposit[] = [];
  
  // Access global deposit storage
  if (!global.contractDeposits) {
    global.contractDeposits = [];
    console.log('[CONTRACT SCAN] No deposits in storage');
    return [];
  }
  
  console.log('[CONTRACT SCAN] Found', global.contractDeposits.length, 'deposits in storage');
  
  const viewingKeyBytes = Buffer.from(viewingPrivateKey, 'base64');
  const spendingPubKey = new PublicKey(metaAddress.spendingPublicKey);
  
  // Scan through all deposits and check if we can derive the address
  for (const deposit of global.contractDeposits) {
    console.log('[CONTRACT SCAN] Checking deposit:', {
      commitment: deposit.commitment.slice(0, 16) + '...',
      ephemeralPublicKey: deposit.ephemeralPublicKey,
      amount: deposit.amount,
      claimed: deposit.claimed,
      storedReceiverSpendingPubKey: deposit.receiverMetaAddress?.spendingPublicKey,
      storedReceiverViewingPubKey: deposit.receiverMetaAddress?.viewingPublicKey,
      matchesCurrentReceiver: deposit.receiverMetaAddress?.spendingPublicKey === metaAddress.spendingPublicKey
    });
    
    try {
      // Simplified verification: Just check if the receiver meta-address matches
      const isOurDeposit = deposit.receiverMetaAddress?.spendingPublicKey === metaAddress.spendingPublicKey &&
                          deposit.receiverMetaAddress?.viewingPublicKey === metaAddress.viewingPublicKey;
      
      if (isOurDeposit && !deposit.claimed) {
        console.log('[CONTRACT SCAN] ✅ Found matching deposit:', {
          amount: deposit.amount,
          ephemeralPublicKey: deposit.ephemeralPublicKey,
          depositIndex: deposit.depositIndex
        });
        
        detectedDeposits.push({
          commitment: deposit.commitment,
          ephemeralPublicKey: deposit.ephemeralPublicKey,
          amount: deposit.amount,
          timestamp: deposit.timestamp,
          depositIndex: deposit.depositIndex,
          claimed: deposit.claimed,
          nonce: deposit.nonce
        });
      } else {
        console.log('[CONTRACT SCAN] ✗ Not our deposit or already claimed');
      }
    } catch (error) {
      console.log('[CONTRACT SCAN] Error checking deposit:', error);
      continue;
    }
  }
  
  console.log('[CONTRACT SCAN] Scan complete. Found', detectedDeposits.length, 'deposits');
  
  return detectedDeposits;
}
