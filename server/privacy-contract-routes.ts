/**
 * Privacy Transfer Smart Contract Routes
 * 
 * Provides API endpoints for contract-based privacy transfers
 */

import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  generateStealthMetaAddress,
  deriveOneTimeAddress,
  scanContractDeposits,
  createCommitment
} from './stealth-utils-contract';
import { storeUserKeys, getUserKeys } from './stealth-key-storage';
import * as dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Test endpoint to verify routes are working
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Privacy contract routes are working!' });
});

// Deployed privacy transfer contract address
const PRIVACY_PROGRAM_ID = new PublicKey(process.env.PRIVACY_PROGRAM_ID || 'Ddv7hXQZJ2kH8mPK3Lx9Xs4j6iGhHuMhqB97666KzAdA');

/**
 * POST /api/privacy-contract/generate-meta-address
 * Generate a new stealth meta-address for receiving private payments
 */
router.post('/generate-meta-address', async (req, res) => {
  try {
    const keys = await generateStealthMetaAddress();
    
    res.json({
      success: true,
      metaAddress: keys.metaAddress,
      privateKeys: {
        spendingPrivateKey: keys.spendingPrivateKey,
        viewingPrivateKey: keys.viewingPrivateKey,
        warning: 'Store these keys securely! They cannot be recovered if lost.'
      }
    });
  } catch (error: any) {
    console.error('[GENERATE META-ADDRESS ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/scan
 * Scan smart contract for deposits to a meta-address
 * 
 * Body: {
 *   metaAddress: StealthMetaAddress,
 *   viewingPrivateKey: string (base64),
 *   rpcUrl?: string
 * }
 */
router.post('/scan', async (req, res) => {
  try {
    const { metaAddress, viewingPrivateKey, rpcUrl } = req.body;
    
    if (!metaAddress || !viewingPrivateKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: metaAddress, viewingPrivateKey'
      });
    }
    
    const connection = new Connection(rpcUrl || process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    
    const deposits = await scanContractDeposits(
      connection,
      metaAddress,
      viewingPrivateKey,
      PRIVACY_PROGRAM_ID
    );
    
    res.json({
      success: true,
      deposits,
      count: deposits.length
    });
  } catch (error: any) {
    console.error('[CONTRACT SCAN ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/ensure-initialized
 * Auto-initialize privacy pool if needed and return transaction for user to sign
 */
router.post('/ensure-initialized', async (req, res) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: wallet'
      });
    }
    
    const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const [privacyPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('privacy_pool_v2')],
      PRIVACY_PROGRAM_ID
    );
    
    const accountInfo = await connection.getAccountInfo(privacyPoolPDA);
    
    if (accountInfo) {
      return res.json({
        success: true,
        initialized: true,
        privacyPool: privacyPoolPDA.toBase58(),
        message: 'Privacy pool already initialized'
      });
    }
    
    // Pool not initialized, prepare initialization transaction
    const { Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js');
    const { sha256 } = await import('@noble/hashes/sha256');
    
    const discriminator = sha256('global:initialize_privacy_pool').slice(0, 8);
    const instructionData = Buffer.from(discriminator);
    
    const initIx = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(wallet), isSigner: true, isWritable: true },
        { pubkey: privacyPoolPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PRIVACY_PROGRAM_ID,
      data: instructionData,
    });
    
    const transaction = new Transaction().add(initIx);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(wallet);
    
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    
    console.log('[ENSURE INITIALIZED] Privacy pool needs initialization:', {
      privacyPool: privacyPoolPDA.toBase58(),
      authority: wallet
    });
    
    res.json({
      success: true,
      initialized: false,
      needsInitialization: true,
      serializedTransaction,
      privacyPool: privacyPoolPDA.toBase58()
    });
  } catch (error: any) {
    console.error('[ENSURE INITIALIZED ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/prepare-claim-transaction
 * Prepare a claim transaction for the frontend to sign
 */
router.post('/prepare-claim-transaction', async (req, res) => {
  try {
    const { receiverWallet, commitment, nonce, amount } = req.body;
    
    if (!receiverWallet || !commitment || !nonce || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: receiverWallet, commitment, nonce, amount'
      });
    }
    
    const { Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { createHash } = await import('crypto');
    
    // Create nullifier to prevent double-spending
    const nullifierData = Buffer.concat([
      Buffer.from(commitment, 'hex'),
      Buffer.from(nonce, 'hex')
    ]);
    const nullifier = createHash('sha256').update(nullifierData).digest();
    
    // Find privacy pool PDA
    const [privacyPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('privacy_pool_v2')],
      PRIVACY_PROGRAM_ID
    );
    
    // Build instruction data with Anchor discriminator
    const discriminator = sha256('global:privacy_claim').slice(0, 8);
    const commitmentBytes = Buffer.from(commitment, 'hex').slice(0, 32);
    const nullifierBytes = Buffer.from(nullifier).slice(0, 32);
    const nonceBytes = Buffer.from(nonce, 'hex').slice(0, 32);
    const amountLamports = Math.floor(amount * 1000000000);
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amountLamports));
    
    const instructionData = Buffer.concat([
      Buffer.from(discriminator),
      commitmentBytes,
      nullifierBytes,
      nonceBytes,
      amountBuffer
    ]);
    
    // Create claim instruction
    const claimIx = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(receiverWallet), isSigner: true, isWritable: true },
        { pubkey: privacyPoolPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PRIVACY_PROGRAM_ID,
      data: instructionData,
    });
    
    // Build transaction
    const transaction = new Transaction().add(claimIx);
    
    // Add recent blockhash and fee payer
    const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(receiverWallet);
    
    // Serialize transaction
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    
    console.log('[PREPARE CLAIM] Created claim transaction:', {
      receiver: receiverWallet,
      commitment: commitment.slice(0, 16) + '...',
      nullifier: Buffer.from(nullifier).toString('hex').slice(0, 16) + '...',
      amount
    });
    
    res.json({
      success: true,
      serializedTransaction,
      nullifier: Buffer.from(nullifier).toString('hex')
    });
  } catch (error: any) {
    console.error('[PREPARE CLAIM ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/record-claim
 * Record a successful claim after frontend confirms transaction
 */
router.post('/record-claim', async (req, res) => {
  try {
    const { commitment, signature, receiverWallet } = req.body;
    
    if (!commitment || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: commitment, signature'
      });
    }
    
    // Find the deposit
    if (!global.contractDeposits) {
      throw new Error('No deposits found');
    }
    
    const depositIndex = global.contractDeposits.findIndex(d => d.commitment === commitment);
    if (depositIndex === -1) {
      throw new Error('Deposit not found');
    }
    
    const deposit = global.contractDeposits[depositIndex];
    
    if (deposit.claimed) {
      throw new Error('Deposit already claimed');
    }
    
    // Mark as claimed only after successful transaction
    global.contractDeposits[depositIndex].claimed = true;
    global.contractDeposits[depositIndex].claimedAt = Date.now();
    global.contractDeposits[depositIndex].claimedBy = receiverWallet;
    
    console.log('[RECORD CLAIM] Marked deposit as claimed:', {
      commitment: commitment.slice(0, 16) + '...',
      signature,
      receiver: receiverWallet
    });
    
    res.json({
      success: true,
      message: 'Claim recorded successfully'
    });
  } catch (error: any) {
    console.error('[RECORD CLAIM ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/prepare-transaction
 * Prepare a smart contract transaction for the frontend to sign
 */
router.post('/prepare-transaction', async (req, res) => {
  try {
    console.log('[PREPARE TRANSACTION] Request received:', req.body);
    const { senderWallet, recipientMetaAddress, amount } = req.body;
    
    if (!senderWallet || !recipientMetaAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderWallet, recipientMetaAddress, amount'
      });
    }
    
    const { Keypair, SystemProgram, Transaction, TransactionInstruction } = await import('@solana/web3.js');
    const { sha256 } = await import('@noble/hashes/sha256');
    
    // Generate one-time address
    const oneTimeAddr = await deriveOneTimeAddress(recipientMetaAddress);
    
    // Create commitment
    const { commitment, nonce } = createCommitment(oneTimeAddr.address, amount);
    
    console.log('[PREPARE TRANSACTION] Created commitment:', {
      oneTimeAddress: oneTimeAddr.address,
      ephemeralPublicKey: oneTimeAddr.ephemeralPublicKey,
      commitment: commitment.slice(0, 16) + '...',
      nonce: nonce.slice(0, 16) + '...',
      amount
    });
    
    // Find privacy pool PDA
    const [privacyPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('privacy_pool_v2')],
      PRIVACY_PROGRAM_ID
    );
    
    // Build instruction data manually with Anchor discriminator
    // Discriminator is first 8 bytes of SHA256("global:privacy_deposit")
    const discriminator = sha256('global:privacy_deposit').slice(0, 8);
    const commitmentBytes = Buffer.from(commitment, 'hex').slice(0, 32);
    const ephemeralPubkey = new PublicKey(oneTimeAddr.ephemeralPublicKey);
    const nonceBytes = Buffer.from(nonce, 'hex').slice(0, 32);
    const amountLamports = Math.floor(amount * 1000000000);
    
    // Create amount buffer (u64 as 8 bytes little-endian)
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amountLamports));
    
    const instructionData = Buffer.concat([
      Buffer.from(discriminator),
      commitmentBytes,
      ephemeralPubkey.toBuffer(),
      nonceBytes,
      amountBuffer
    ]);
    
    // Create privacy deposit instruction
    const depositIx = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(senderWallet), isSigner: true, isWritable: true },
        { pubkey: privacyPoolPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PRIVACY_PROGRAM_ID,
      data: instructionData,
    });
    
    // Build transaction with only the privacy deposit instruction
    // The smart contract handles the SOL transfer internally
    const transaction = new Transaction().add(depositIx);
    
    // Add recent blockhash and fee payer
    const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(senderWallet);
    
    // Serialize transaction
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    
    res.json({
      success: true,
      serializedTransaction,
      commitment,
      ephemeralPublicKey: oneTimeAddr.ephemeralPublicKey,
      nonce,
      oneTimeAddress: oneTimeAddr.address,
      privacyPoolAddress: privacyPoolPDA.toBase58()
    });
  } catch (error: any) {
    console.error('[PREPARE TRANSACTION ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/privacy-contract/record-deposit
 * Record a deposit after frontend confirms transaction
 */
router.post('/record-deposit', async (req, res) => {
  try {
    const {
      signature,
      commitment,
      ephemeralPublicKey,
      nonce,
      amount,
      senderWallet,
      receiverMetaAddress
    } = req.body;
    
    if (!signature || !commitment || !ephemeralPublicKey || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Find privacy pool PDA
    const [privacyPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('privacy_pool_v2')],
      PRIVACY_PROGRAM_ID
    );
    
    // Store deposit metadata
    if (!global.contractDeposits) {
      global.contractDeposits = [];
    }
    
    console.log('[RECORD DEPOSIT] Storing deposit with receiverMetaAddress:', {
      hasSpendingPublicKey: !!receiverMetaAddress?.spendingPublicKey,
      hasViewingPublicKey: !!receiverMetaAddress?.viewingPublicKey,
      receiverMetaAddressType: typeof receiverMetaAddress,
      receiverMetaAddress
    });
    
    global.contractDeposits.push({
      commitment,
      ephemeralPublicKey,
      amount,
      timestamp: Date.now(),
      depositIndex: global.contractDeposits.length,
      claimed: false,
      nonce,
      signature,
      privacyPool: privacyPoolPDA.toBase58(),
      receiverMetaAddress
    });
    
    console.log('[RECORD DEPOSIT] Recorded deposit:', {
      commitment: commitment.slice(0, 16) + '...',
      amount,
      signature
    });
    
    res.json({
      success: true,
      depositIndex: global.contractDeposits.length - 1
    });
  } catch (error: any) {
    console.error('[RECORD DEPOSIT ERROR]', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
