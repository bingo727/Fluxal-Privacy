import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Home, WifiOff, Activity, MessageSquare, Eye, EyeOff, Bug, Send, Download, FolderOpen, File, CheckCircle2, AlertTriangle, ShieldCheck, ChevronLeft, ChevronRight, Search, Shield, Key, Copy, RefreshCw, Lock, Zap, Layers, Loader2, QrCode, ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import fluxalTitle from "@assets/Untitled_design__62_-removebg-preview_1765006354328.png";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// Mock data for initial state or fallback
const INITIAL_SOL_PRICE = 132.67;

// Stealth Transfer interfaces
interface StealthMetaAddress {
  spendingPublicKey: string;
  viewingPublicKey: string;
  address: string;
}

interface ContractDeposit {
  commitment: string;
  ephemeralPublicKey: string;
  amount: number;
  timestamp: number;
  depositIndex: number;
  claimed: boolean;
  nonce?: string;
}

export default function Dashboard() {
  const [_, setLocation] = useLocation();
  const { user, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const { toast } = useToast();
  const [balance, setBalance] = useState<number>(0);
  const [solPrice, setSolPrice] = useState<number>(INITIAL_SOL_PRICE);
  const [solChange, setSolChange] = useState<number>(-0.97);
  const [hideBalance, setHideBalance] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  const activeWallet = wallets[0];
  const address = activeWallet?.address || user?.wallet?.address || "";
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "Not Connected";
  
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
  
  // Stealth Transfer State
  const [metaAddress, setMetaAddress] = useState<StealthMetaAddress | null>(null);
  const [isGeneratingMeta, setIsGeneratingMeta] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  
  // Send state
  const [recipientMetaAddress, setRecipientMetaAddress] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [contractDepositResult, setContractDepositResult] = useState<any>(null);
  
  // Receive state
  const [contractDeposits, setContractDeposits] = useState<ContractDeposit[]>([]);
  const [isScanningContract, setIsScanningContract] = useState(false);
  const [isClaimingContract, setIsClaimingContract] = useState<string | null>(null);
  
  // UI state
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [stealthTab, setStealthTab] = useState("generate");
  const [needsRegeneration, setNeedsRegeneration] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  useEffect(() => {
    if (!authenticated) {
        // Optional: Redirect to connect if not authenticated
        // setLocation("/connect"); 
    }
  }, [authenticated, setLocation]);
  
  useEffect(() => {
    if (authenticated && user) {
      loadMetaAddress();
    }
  }, [authenticated, user]);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true");
        const data = await response.json();
        if (data.solana) {
            setSolPrice(data.solana.usd);
            setSolChange(data.solana.usd_24h_change);
        }
      } catch (e) {
        console.warn("Failed to fetch price, using fallback", e);
      }
    };

    const fetchBalance = async () => {
      if (address) {
        try {
            // Using a public RPC endpoint
            const connection = new Connection("https://api.mainnet-beta.solana.com"); 
            const pubKey = new PublicKey(address);
            const bal = await connection.getBalance(pubKey);
            setBalance(bal / LAMPORTS_PER_SOL);
        } catch (e) {
            console.error("Failed to fetch balance", e);
        }
      }
    };

    fetchPrice();
    fetchBalance();
    
    const interval = setInterval(() => {
        fetchPrice();
        fetchBalance();
    }, 30000); 
    
    return () => clearInterval(interval);
  }, [address]);

  // ==================== META-ADDRESS FUNCTIONS ====================
  
  const loadMetaAddress = async () => {
    if (!user) return;
    
    setIsLoadingMeta(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/stealth/meta-address/${user.id}`);
      const data = await response.json();
      
      if (data.success && data.metaAddress) {
        setMetaAddress(data.metaAddress);
      }
    } catch (error) {
      console.error('Failed to load meta-address:', error);
    } finally {
      setIsLoadingMeta(false);
    }
  };
  
  const generateMetaAddress = async () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please connect your wallet first",
        variant: "destructive"
      });
      return;
    }
    
    if (metaAddress && !needsRegeneration) {
      setShowRegenerateConfirm(true);
      return;
    }
    
    performGeneration();
  };
  
  const performGeneration = async () => {
    setShowRegenerateConfirm(false);
    
    setIsGeneratingMeta(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/privacy-contract/generate-meta-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMetaAddress(data.metaAddress);
        
        if (user) {
          await fetch(`${API_BASE_URL}/api/stealth/store-meta-address`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              metaAddress: data.metaAddress,
              privateKeys: data.privateKeys
            })
          });
        }
        
        setNeedsRegeneration(false);
        toast({
          title: "Meta-Address Generated!",
          description: metaAddress ? "New meta-address created. Share this with senders." : "You can now receive private payments",
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate meta-address",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingMeta(false);
    }
  };
  
  // ==================== SEND FUNCTIONS ====================
  
  const handleSend = async () => {
    if (!user || !user.wallet?.address) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet first",
        variant: "destructive"
      });
      return;
    }
    
    if (!recipientMetaAddress || !sendAmount) {
      toast({
        title: "Missing Information",
        description: "Please provide recipient address and amount",
        variant: "destructive"
      });
      return;
    }
    
    let parsedMetaAddress: StealthMetaAddress;
    try {
      parsedMetaAddress = JSON.parse(recipientMetaAddress);
    } catch {
      toast({
        title: "Invalid Format",
        description: "Please paste a valid stealth meta-address JSON",
        variant: "destructive"
      });
      return;
    }
    
    setIsSending(true);
    setContractDepositResult(null);
    
    try {
      const provider = (window as any).solana;
      if (!provider || !provider.isConnected) {
        throw new Error('Solana wallet not connected. Please connect Phantom or another Solana wallet.');
      }
      
      const { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(RPC_URL);
      
      const senderPubkey = new PublicKey(user.wallet.address);
      const balance = await connection.getBalance(senderPubkey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      const requiredSOL = parseFloat(sendAmount) + 0.002;
      
      if (balanceSOL < requiredSOL) {
        const network = RPC_URL.includes('devnet') ? 'devnet' : 'mainnet';
        const faucetMessage = network === 'devnet' 
          ? `Get devnet SOL from: https://faucet.solana.com` 
          : `Please add SOL to your wallet`;
        throw new Error(
          `Insufficient balance. You have ${balanceSOL.toFixed(4)} SOL but need ${requiredSOL.toFixed(4)} SOL. ${faucetMessage}`
        );
      }
      
      toast({
        title: "Preparing Transaction",
        description: "Building smart contract instruction...",
      });
      
      const prepareResponse = await fetch(`${API_BASE_URL}/api/privacy-contract/prepare-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderWallet: user.wallet.address,
          recipientMetaAddress: parsedMetaAddress,
          amount: parseFloat(sendAmount)
        })
      });
      
      const contentType = prepareResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned non-JSON response. Make sure the backend server is running.');
      }
      
      const prepareData = await prepareResponse.json();
      if (!prepareData.success) {
        throw new Error(prepareData.error || 'Failed to prepare transaction');
      }
      
      const { serializedTransaction, commitment, ephemeralPublicKey, nonce } = prepareData;
      
      const txBytes = Uint8Array.from(atob(serializedTransaction), c => c.charCodeAt(0));
      const transaction = Transaction.from(txBytes);
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = new PublicKey(user.wallet.address);
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      
      toast({
        title: "Approve Transaction",
        description: "Please approve the smart contract deposit in your wallet",
      });
      
      const signedTx = await provider.signTransaction(transaction);
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');
      
      await fetch(`${API_BASE_URL}/api/privacy-contract/record-deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          commitment,
          ephemeralPublicKey,
          nonce,
          amount: parseFloat(sendAmount),
          senderWallet: user.wallet.address,
          receiverMetaAddress: parsedMetaAddress
        })
      });
      
      setContractDepositResult({
        commitment,
        ephemeralPublicKey,
        amount: parseFloat(sendAmount),
        txSignature: signature
      });
      
      setSendAmount("");
      setRecipientMetaAddress("");
      
      toast({
        title: "Deposit Successful! 🎉",
        description: "Smart contract deposit confirmed",
      });
      
    } catch (error: any) {
      console.error('Deposit error:', error);
      
      let errorTitle = "Deposit Failed";
      let errorMessage = error.message || "Failed to deposit to privacy pool";
      
      if (error.message?.includes('insufficient lamports')) {
        errorTitle = "Insufficient Funds";
        errorMessage = `Your wallet doesn't have enough SOL.`;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsSending(false);
    }
  };
  
  // ==================== RECEIVE FUNCTIONS ====================
  
  const scanForPayments = async () => {
    if (!user || !metaAddress) {
      toast({
        title: "Meta-Address Required",
        description: "Please generate a meta-address first",
        variant: "destructive"
      });
      return;
    }
    
    setIsScanningContract(true);
    try {
      const keysResponse = await fetch(`${API_BASE_URL}/api/stealth/get-keys/${user.id}`);
      const keysData = await keysResponse.json();
      
      if (!keysData.success || !keysData.viewingPrivateKey) {
        setNeedsRegeneration(true);
        setStealthTab("generate");
        throw new Error('Viewing key not found. Please regenerate your meta-address.');
      }
      
      const response = await fetch(`${API_BASE_URL}/api/privacy-contract/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaAddress,
          viewingPrivateKey: keysData.viewingPrivateKey
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setContractDeposits(data.deposits);
        toast({
          title: "Scan Complete",
          description: `Found ${data.deposits.length} deposit(s) in privacy pool`,
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to scan for deposits",
        variant: "destructive"
      });
    } finally {
      setIsScanningContract(false);
    }
  };
  
  const claimPayment = async (deposit: ContractDeposit) => {
    if (!user || !user.wallet?.address) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet to claim",
        variant: "destructive"
      });
      return;
    }
    
    setIsClaimingContract(deposit.commitment);
    
    try {
      const { Connection, Transaction, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(RPC_URL);
      
      const walletPubkey = new PublicKey(user.wallet.address);
      const balance = await connection.getBalance(walletPubkey);
      const balanceInSol = balance / LAMPORTS_PER_SOL;
      
      const MIN_BALANCE_REQUIRED = 0.002;
      
      if (balanceInSol < MIN_BALANCE_REQUIRED) {
        throw new Error(
          `Insufficient SOL balance for rent. You need at least ${MIN_BALANCE_REQUIRED} SOL. Current: ${balanceInSol.toFixed(6)} SOL.`
        );
      }
      
      const initCheckResponse = await fetch(`${API_BASE_URL}/api/privacy-contract/ensure-initialized`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: user.wallet.address })
      });
      
      const initCheckData = await initCheckResponse.json();
      
      if (initCheckData.needsInitialization) {
        toast({
          title: "Initializing Privacy Pool",
          description: "First-time setup: Please approve the initialization transaction",
        });
        
        const initTxBuffer = Uint8Array.from(atob(initCheckData.serializedTransaction), c => c.charCodeAt(0));
        const initTransaction = Transaction.from(initTxBuffer);
        
        const { blockhash: initBlockhash, lastValidBlockHeight: initLastValidBlockHeight } = await connection.getLatestBlockhash();
        initTransaction.recentBlockhash = initBlockhash;
        initTransaction.feePayer = new PublicKey(user.wallet.address);
        initTransaction.lastValidBlockHeight = initLastValidBlockHeight;
        
        const provider = (window as any).solana;
        if (!provider || !provider.isConnected) {
          throw new Error('Solana wallet not connected');
        }
        
        const signedInitTx = await provider.signTransaction(initTransaction);
        const rawInitTransaction = signedInitTx.serialize();
        const initSignature = await connection.sendRawTransaction(rawInitTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        });
        
        await connection.confirmTransaction({
          signature: initSignature,
          blockhash: initBlockhash,
          lastValidBlockHeight: initLastValidBlockHeight
        }, 'confirmed');
        
        toast({
          title: "Pool Initialized!",
          description: "Now processing your claim...",
        });
      }
      
      const keysResponse = await fetch(`${API_BASE_URL}/api/stealth/get-keys/${user.id}`);
      const keysData = await keysResponse.json();
      
      if (!keysData.success || !keysData.spendingPrivateKey) {
        setNeedsRegeneration(true);
        setStealthTab("generate");
        throw new Error('Spending key not found. Please regenerate your meta-address.');
      }
      
      toast({
        title: "Preparing Claim",
        description: "Building smart contract transaction...",
      });
      
      const prepareResponse = await fetch(`${API_BASE_URL}/api/privacy-contract/prepare-claim-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverWallet: user.wallet.address,
          commitment: deposit.commitment,
          nonce: deposit.nonce,
          amount: deposit.amount
        })
      });
      
      const prepareData = await prepareResponse.json();
      
      if (!prepareData.success) {
        throw new Error(prepareData.error || 'Failed to prepare claim transaction');
      }
      
      const transactionBuffer = Uint8Array.from(atob(prepareData.serializedTransaction), c => c.charCodeAt(0));
      const transaction = Transaction.from(transactionBuffer);
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = new PublicKey(user.wallet.address);
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      
      toast({
        title: "Approve Transaction",
        description: "Please approve the claim transaction in your wallet",
      });
      
      const provider = (window as any).solana;
      if (!provider || !provider.isConnected) {
        throw new Error('Solana wallet not connected');
      }
      
      const signedTx = await provider.signTransaction(transaction);
      const rawTransaction = signedTx.serialize();
      
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      });
      
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');
      
      await fetch(`${API_BASE_URL}/api/privacy-contract/record-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitment: deposit.commitment,
          signature,
          receiverWallet: user.wallet.address
        })
      });
      
      toast({
        title: "Claim Successful!",
        description: "Funds transferred to your wallet from privacy pool",
      });
      
      scanForPayments();
    } catch (error: any) {
      console.error('Claim error:', error);
      
      let errorMessage = error.message || "Failed to claim from privacy pool";
      
      toast({
        title: "Claim Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsClaimingContract(null);
    }
  };
  
  // ==================== UTILITY FUNCTIONS ====================
  
  const copyToClipboard = (text: string, label: string = "Address") => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const truncateAddress = (address: string, start = 12, end = 12) => {
    if (!address) return "";
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  };
  
  const formatMetaAddressForSharing = () => {
    if (!metaAddress) return "";
    return JSON.stringify(metaAddress, null, 2);
  };

  const solValue = balance * solPrice;
  const usdcBalance = 0; // Mock for now
  const usdcValue = usdcBalance * 1; // USDC is stable
  const totalValue = solValue + usdcValue;

  const formattedTotalValue = totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const SidebarItem = ({ id, icon: Icon, label }: { id: string, icon: any, label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-neue tracking-wide ${
        activeTab === id 
          ? "bg-[#FFE500]/10 text-[#FFE500] border border-[#FFE500]/20" 
          : "text-gray-400 hover:text-white hover:bg-white/5"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  const renderContent = () => {
      switch (activeTab) {
        case "stealth":
          return (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h1 className="text-2xl font-bold mb-2">Stealth Transfers</h1>
                  <p className="text-gray-400 text-sm">Private payments using stealth addresses and smart contracts</p>
                </div>
                <div className="px-4 py-2 rounded-full border border-[#FFE500]/20 bg-[#FFE500]/10 text-xs text-[#FFE500] font-mono flex items-center gap-2">
                  <Shield className="w-3 h-3" />
                  Enhanced Privacy
                </div>
              </div>

              {/* Authentication Check */}
              {!authenticated && (
                <div className="bg-[#111] border border-white/5 rounded-xl p-6 mb-6">
                  <div className="text-center">
                    <Lock className="mx-auto mb-4 text-[#FFE500]" size={48} />
                    <h3 className="text-xl font-bold mb-2">Wallet Connection Required</h3>
                    <p className="text-gray-400 mb-4">Please connect your wallet to use stealth transfers</p>
                    <Button 
                      onClick={() => setLocation("/connect")}
                      className="bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                    >
                      Connect Wallet
                    </Button>
                  </div>
                </div>
              )}

              {/* Main Tabs */}
              <Tabs value={stealthTab} onValueChange={setStealthTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6 bg-[#111] border border-white/5 p-1 rounded-xl">
                  <TabsTrigger value="generate" className="rounded-lg data-[state=active]:bg-[#FFE500] data-[state=active]:text-black">
                    <Key size={16} className="mr-2" />
                    Generate
                  </TabsTrigger>
                  <TabsTrigger value="send" className="rounded-lg data-[state=active]:bg-[#FFE500] data-[state=active]:text-black">
                    <Send size={16} className="mr-2" />
                    Send
                  </TabsTrigger>
                  <TabsTrigger value="receive" className="rounded-lg data-[state=active]:bg-[#FFE500] data-[state=active]:text-black">
                    <Download size={16} className="mr-2" />
                    Receive
                  </TabsTrigger>
                </TabsList>

                {/* GENERATE TAB */}
                <TabsContent value="generate" className="space-y-6">
                  {needsRegeneration && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <RefreshCw size={16} className="text-yellow-500" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-yellow-500 mb-1">Regeneration Required</h4>
                          <p className="text-white/60 text-sm mb-3">
                            Your private keys are missing. Please regenerate your meta-address.
                          </p>
                          <Button
                            onClick={generateMetaAddress}
                            disabled={isGeneratingMeta}
                            className="bg-yellow-500 hover:bg-yellow-600 text-black"
                            size="sm"
                          >
                            {isGeneratingMeta ? (
                              <>
                                <Loader2 className="mr-2 animate-spin" size={14} />
                                Generating...
                              </>
                            ) : (
                              <>
                                <RefreshCw size={14} className="mr-2" />
                                Regenerate Now
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="bg-[#111] border border-white/5 rounded-xl">
                    <div className="p-6 border-b border-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Key className="text-[#FFE500]" size={24} />
                        <h3 className="text-xl font-bold">Your Stealth Meta-Address</h3>
                      </div>
                      <p className="text-gray-400 text-sm">
                        Share this address publicly to receive private payments. It never appears on-chain.
                      </p>
                    </div>
                    <div className="p-6 space-y-4">
                      {isLoadingMeta ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-[#FFE500]" size={32} />
                        </div>
                      ) : metaAddress ? (
                        <>
                          <div className="bg-black/50 border border-white/10 rounded-xl p-6 space-y-4">
                            <div>
                              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                                Meta-Address ID
                              </label>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 text-[#FFE500] font-mono text-sm truncate overflow-hidden">
                                  {metaAddress.address}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => copyToClipboard(metaAddress.address, "Meta-Address ID")}
                                  className="hover:text-[#FFE500]"
                                >
                                  <Copy size={16} />
                                </Button>
                              </div>
                            </div>
                            
                            <div>
                              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                                Spending Public Key
                              </label>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 text-white/70 font-mono text-xs break-all">
                                  {showFull ? metaAddress.spendingPublicKey : truncateAddress(metaAddress.spendingPublicKey)}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => copyToClipboard(metaAddress.spendingPublicKey, "Spending Key")}
                                  className="hover:text-[#FFE500]"
                                >
                                  <Copy size={16} />
                                </Button>
                              </div>
                            </div>
                            
                            <div>
                              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                                Viewing Public Key
                              </label>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 text-white/70 font-mono text-xs break-all">
                                  {showFull ? metaAddress.viewingPublicKey : truncateAddress(metaAddress.viewingPublicKey)}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => copyToClipboard(metaAddress.viewingPublicKey, "Viewing Key")}
                                  className="hover:text-[#FFE500]"
                                >
                                  <Copy size={16} />
                                </Button>
                              </div>
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                onClick={() => setShowFull(!showFull)}
                                className="flex-1 bg-[#FFE500] hover:bg-[#FFDD00] text-black"
                              >
                                {showFull ? <EyeOff size={16} className="mr-2" /> : <Eye size={16} className="mr-2" />}
                                {showFull ? "Hide" : "Show"} Full Keys
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => copyToClipboard(formatMetaAddressForSharing(), "Complete Meta-Address")}
                                className="flex-1 bg-[#FFE500] hover:bg-[#FFDD00] text-black"
                              >
                                <Copy size={16} className="mr-2" />
                                Copy for Sharing
                              </Button>
                            </div>
                          </div>
                          
                          <div className="pt-2 border-t border-white/5">
                            <Button
                              onClick={generateMetaAddress}
                              disabled={isGeneratingMeta}
                              className="w-full bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                            >
                              {isGeneratingMeta ? (
                                <>
                                  <Loader2 className="mr-2 animate-spin" size={16} />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <RefreshCw size={16} className="mr-2" />
                                  Regenerate Meta-Address
                                </>
                              )}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <QrCode className="mx-auto mb-4 text-white/30" size={48} />
                          <p className="text-white/40 mb-4">No meta-address generated yet</p>
                          <Button
                            onClick={generateMetaAddress}
                            disabled={isGeneratingMeta || !authenticated}
                            className="bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                          >
                            {isGeneratingMeta ? (
                              <>
                                <Loader2 className="mr-2 animate-spin" size={16} />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Key size={16} className="mr-2" />
                                Generate Meta-Address
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Info Cards */}
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-[#111] border border-white/5 rounded-xl p-6 hover:border-[#FFE500]/20 transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-xl bg-[#FFE500]/20 flex items-center justify-center flex-shrink-0">
                          <Lock size={20} className="text-[#FFE500]" />
                        </div>
                        <h4 className="font-bold text-[#FFE500]">Publicly Shareable</h4>
                      </div>
                      <p className="text-white/40 text-sm">Your meta-address is safe to share. It never appears on-chain.</p>
                    </div>
                    
                    <div className="bg-[#111] border border-white/5 rounded-xl p-6 hover:border-[#FFE500]/20 transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-xl bg-[#FFE500]/20 flex items-center justify-center flex-shrink-0">
                          <Shield size={20} className="text-[#FFE500]" />
                        </div>
                        <h4 className="font-bold text-[#FFE500]">Unlinkable Payments</h4>
                      </div>
                      <p className="text-white/40 text-sm">Each payment uses a unique one-time address generated from your meta-address.</p>
                    </div>
                    
                    <div className="bg-[#111] border border-white/5 rounded-xl p-6 hover:border-[#FFE500]/20 transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-xl bg-[#FFE500]/20 flex items-center justify-center flex-shrink-0">
                          <Zap size={20} className="text-[#FFE500]" />
                        </div>
                        <h4 className="font-bold text-[#FFE500]">Full Control</h4>
                      </div>
                      <p className="text-white/40 text-sm">Only you can detect and claim payments sent to your meta-address.</p>
                    </div>
                  </div>
                </TabsContent>

                {/* SEND TAB */}
                <TabsContent value="send" className="space-y-6">
                  <div className="bg-gradient-to-r from-[#FFE500]/20 to-[#FFE500]/10 border border-[#FFE500]/30 rounded-xl p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#FFE500]/30 flex items-center justify-center flex-shrink-0">
                        <Layers size={24} className="text-[#FFE500]" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">Smart Contract Privacy Pool</h3>
                        <p className="text-white/60 text-sm mb-3">
                          Funds are deposited to a privacy pool with ZK commitments, providing complete receiver privacy.
                        </p>
                        <div className="flex gap-3 text-xs flex-wrap">
                          <span className="px-3 py-1 rounded-full bg-[#FFE500]/20 text-[#FFE500]">✓ ZK Commitments</span>
                          <span className="px-3 py-1 rounded-full bg-[#FFE500]/20 text-[#FFE500]">✓ Nullifier Protection</span>
                          <span className="px-3 py-1 rounded-full bg-[#FFE500]/20 text-[#FFE500]">✓ Anonymity Set</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-[#111] border border-white/5 rounded-xl">
                    <div className="p-6 border-b border-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Send className="text-[#FFE500]" size={24} />
                        <h3 className="text-xl font-bold">Deposit to Privacy Pool</h3>
                      </div>
                      <p className="text-gray-400 text-sm">
                        Send SOL to the smart contract with receiver's meta-address
                      </p>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block text-white/40">
                          Recipient's Meta-Address (JSON)
                        </label>
                        <textarea
                          value={recipientMetaAddress}
                          onChange={(e) => setRecipientMetaAddress(e.target.value)}
                          placeholder='{"spendingPublicKey":"...","viewingPublicKey":"...","address":"..."}'
                          className="w-full h-32 bg-black/50 border border-white/10 rounded-xl p-4 font-mono text-sm text-white/70 resize-none focus:border-[#FFE500]/50 focus:outline-none"
                          disabled={!authenticated}
                        />
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium mb-2 block text-white/40">
                          Amount (SOL)
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={sendAmount}
                          onChange={(e) => setSendAmount(e.target.value)}
                          placeholder="0.00"
                          className="bg-black/50 border-white/10 text-white focus:border-[#FFE500]/50"
                          disabled={!authenticated}
                        />
                      </div>
                      
                      <Button
                        onClick={handleSend}
                        disabled={isSending || !authenticated || !recipientMetaAddress || !sendAmount}
                        className="w-full bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                        size="lg"
                      >
                        {isSending ? (
                          <>
                            <Loader2 className="mr-2 animate-spin" size={18} />
                            Depositing...
                          </>
                        ) : (
                          <>
                            <Layers size={18} className="mr-2" />
                            Deposit to Privacy Contract
                          </>
                        )}
                      </Button>
                      
                      {contractDepositResult && (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 space-y-2">
                          <div className="flex items-center gap-2 text-green-400 font-medium">
                            <Check size={18} />
                            Deposit Successful!
                          </div>
                          <div className="text-sm text-white/60 space-y-1">
                            <p>Commitment: <code className="text-[#FFE500]">{contractDepositResult.commitment?.slice(0, 16)}...</code></p>
                            <p>Ephemeral Key: <code className="text-white/70">{contractDepositResult.ephemeralPublicKey?.slice(0, 16)}...</code></p>
                            <p>Amount: {contractDepositResult.amount} SOL</p>
                            {contractDepositResult.txSignature && (
                              <p className="flex items-center gap-2 mt-2">
                                <span className="text-white/40">Transaction:</span>
                                <a 
                                  href={`https://solscan.io/tx/${contractDepositResult.txSignature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#FFE500] hover:text-[#FFDD00] underline flex items-center gap-1"
                                >
                                  View on Solscan
                                  <ExternalLink size={12} />
                                </a>
                              </p>
                            )}
                            <p className="text-xs text-white/40 mt-2">
                              💡 Receiver can now scan and claim with their keys
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-[#111] border border-white/5 rounded-xl p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#FFE500]/20 flex items-center justify-center flex-shrink-0">
                          <Shield size={18} className="text-[#FFE500]" />
                        </div>
                        <div>
                          <h4 className="font-medium mb-1 text-[#FFE500]">Enhanced Privacy</h4>
                          <p className="text-white/40 text-sm">
                            ZK commitments hide receiver address and amount from blockchain observers.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-[#111] border border-white/5 rounded-xl p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                          <Lock size={18} className="text-green-400" />
                        </div>
                        <div>
                          <h4 className="font-medium mb-1 text-green-400">Double-Spend Protection</h4>
                          <p className="text-white/40 text-sm">
                            Nullifiers prevent double-spending automatically via smart contract.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* RECEIVE TAB */}
                <TabsContent value="receive" className="space-y-6">
                  <div className="bg-[#111] border border-white/5 rounded-xl">
                    <div className="p-6 border-b border-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Download className="text-[#FFE500]" size={24} />
                        <h3 className="text-xl font-bold">Scan & Claim from Pool</h3>
                      </div>
                      <p className="text-gray-400 text-sm">
                        Detect and claim deposits from the privacy contract pool
                      </p>
                    </div>
                    <div className="p-6 space-y-4">
                      <Button
                        onClick={scanForPayments}
                        disabled={isScanningContract || !authenticated || !metaAddress}
                        className="w-full bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                        size="lg"
                      >
                        {isScanningContract ? (
                          <>
                            <Loader2 className="mr-2 animate-spin" size={18} />
                            Scanning Contract...
                          </>
                        ) : (
                          <>
                            <RefreshCw size={18} className="mr-2" />
                            Scan Contract Deposits
                          </>
                        )}
                      </Button>
                      
                      {!metaAddress && authenticated && (
                        <div className="text-center py-4 text-white/40 text-sm">
                          Generate a meta-address first to scan for deposits
                        </div>
                      )}
                      
                      <div className="space-y-3">
                        {contractDeposits.length > 0 ? (
                          contractDeposits.map((deposit, idx) => (
                            <div key={deposit.commitment} className="bg-black/30 border border-white/5 rounded-xl p-6">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="w-8 h-8 rounded-full bg-[#FFE500]/20 flex items-center justify-center">
                                      <Layers size={14} className="text-[#FFE500]" />
                                    </div>
                                    <div>
                                      <p className="font-bold text-green-500 text-lg">{deposit.amount} SOL</p>
                                      <p className="text-xs text-white/40">Deposit #{deposit.depositIndex}</p>
                                    </div>
                                  </div>
                                  <p className="text-xs text-white/40 mb-1">
                                    Commitment: <code className="text-white/60">{deposit.commitment.slice(0, 16)}...</code>
                                  </p>
                                  <p className="text-xs text-white/40">
                                    {new Date(deposit.timestamp).toLocaleString()}
                                  </p>
                                </div>
                                <Button
                                  onClick={() => claimPayment(deposit)}
                                  disabled={isClaimingContract === deposit.commitment || deposit.claimed}
                                  size="sm"
                                  className="bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                                >
                                  {isClaimingContract === deposit.commitment ? (
                                    <>
                                      <Loader2 className="mr-1 animate-spin" size={14} />
                                      Claiming...
                                    </>
                                  ) : deposit.claimed ? (
                                    <>
                                      <Check size={14} className="mr-1" />
                                      Claimed
                                    </>
                                  ) : (
                                    <>
                                      <Download size={14} className="mr-1" />
                                      Claim
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-8 text-white/40">
                            {isScanningContract ? "Scanning contract..." : "No contract deposits found"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-[#111] border border-white/5 rounded-xl p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                        <Shield size={18} className="text-green-400" />
                      </div>
                      <div>
                        <h4 className="font-medium mb-1 text-green-400">Complete Privacy</h4>
                        <p className="text-white/40 text-sm">
                          Claims are processed through the smart contract with nullifier verification, ensuring complete receiver anonymity.
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

              </Tabs>

              {/* Info Banner */}
              <div className="bg-gradient-to-r from-[#FFE500]/10 to-[#FFE500]/5 border border-[#FFE500]/20 rounded-xl p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#FFE500]/20 flex items-center justify-center flex-shrink-0">
                  <Layers size={18} className="text-[#FFE500]" />
                </div>
                <div className="flex-1">
                  <p className="text-[#FFE500] font-medium text-sm">Smart Contract Privacy Pool</p>
                  <p className="text-white/40 text-xs">
                    Enhanced privacy using on-chain smart contracts with ZK commitments and nullifier protection.
                  </p>
                </div>
              </div>
            </div>
          );
        
        case "offline":
          return (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex justify-between items-center mb-6">
                 <h1 className="text-2xl font-bold">Offline Cash</h1>
                 <div className="flex gap-4">
                     <div className="px-4 py-2 rounded-full border border-white/10 bg-[#111] text-xs text-gray-400 font-mono flex items-center gap-2">
                        Keep some SOL in this wallet to deposit.
                        <AlertTriangle className="w-3 h-3 text-gray-500" />
                     </div>
                     <Dialog>
                        <DialogTrigger asChild>
                             <Button variant="outline" className="border-white/10 bg-[#111] text-white hover:bg-white/5 hover:text-[#FFE500] gap-2 h-9 text-xs uppercase tracking-wider font-bold">
                                <Send className="w-3 h-3" /> Deposit
                             </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-black border border-white/10 text-white sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle className="text-xl font-bold font-neue">Deposit USDC</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-6 py-4">
                              <div className="space-y-2">
                                <Label htmlFor="amount" className="text-gray-300 font-mono text-xs">Amount (USDC)</Label>
                                <Input id="amount" placeholder="0.00" className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono" />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="recipient" className="text-gray-300 font-mono text-xs">Recipient wallet (optional)</Label>
                                <Input id="recipient" placeholder={address} className="bg-[#111] border-white/10 text-gray-400 placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono text-xs" />
                                <p className="text-[10px] text-gray-500 font-mono">
                                    Leave empty to bind the voucher to your connected wallet ({shortAddress}).
                                </p>
                              </div>
                            </div>
                            <DialogFooter className="flex gap-2 sm:justify-between">
                              <DialogClose asChild>
                                 <Button variant="outline" className="flex-1 border-[#FFE500]/30 text-white hover:bg-[#FFE500]/10 hover:text-[#FFE500] rounded-full">
                                    Cancel
                                 </Button>
                              </DialogClose>
                              <Button className="flex-1 bg-[#111] text-gray-500 font-bold border border-white/10 hover:bg-white/5 hover:text-white rounded-full">
                                Confirm deposit
                              </Button>
                            </DialogFooter>
                        </DialogContent>
                     </Dialog>

                     <Dialog>
                        <DialogTrigger asChild>
                             <Button variant="outline" className="border-white/10 bg-[#111] text-white hover:bg-white/5 hover:text-[#FFE500] gap-2 h-9 text-xs uppercase tracking-wider font-bold">
                                <Download className="w-3 h-3" /> Withdraw
                             </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-black border border-white/10 text-white sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle className="text-xl font-bold font-neue">Withdraw USDC</DialogTitle>
                            </DialogHeader>
                            
                            <div className="py-4 space-y-4">
                                <Button variant="outline" className="w-full border-[#FFE500]/30 text-[#FFE500] hover:bg-[#FFE500]/10 rounded-full font-mono text-xs">
                                    Select voucher file
                                </Button>

                                <div className="space-y-2">
                                    <Label className="text-gray-300 font-mono text-xs">Voucher ID (hex, 32 bytes)</Label>
                                    <Input placeholder="0x..." className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono text-xs" />
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-gray-300 font-mono text-xs">Secret (hex, 32 bytes)</Label>
                                    <Input placeholder="0x..." className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono text-xs" />
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-gray-300 font-mono text-xs">Salt (hex, 32 bytes)</Label>
                                    <Input placeholder="0x..." className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono text-xs" />
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-gray-300 font-mono text-xs">Recipient wallet (base58)</Label>
                                    <Input placeholder="Recipient Solana address" className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20 font-mono text-xs" />
                                </div>

                                <p className="text-[10px] text-gray-500 font-mono leading-relaxed">
                                    The voucher file contains voucherId, secret, salt, and the recipient. Load them from a voucher file above or paste them manually to redeem the deposit.
                                </p>
                            </div>

                            <DialogFooter className="flex gap-2 sm:justify-between">
                              <DialogClose asChild>
                                 <Button variant="outline" className="flex-1 border-[#FFE500]/30 text-white hover:bg-[#FFE500]/10 hover:text-[#FFE500] rounded-full">
                                    Cancel
                                 </Button>
                              </DialogClose>
                              <Button className="flex-1 bg-[#111] text-gray-500 font-bold border border-white/10 hover:bg-white/5 hover:text-white rounded-full">
                                Confirm withdraw
                              </Button>
                            </DialogFooter>
                        </DialogContent>
                     </Dialog>
                 </div>
              </div>

              {/* Warning Banner */}
              <div className="border border-[#FFE500]/50 bg-[#FFE500]/5 rounded-xl p-4 flex items-start gap-3">
                 <AlertTriangle className="w-5 h-5 text-[#FFE500] mt-0.5 shrink-0" />
                 <div>
                    <h3 className="text-[#FFE500] font-bold text-xs uppercase tracking-widest mb-1">Early Demo - Use With Caution</h3>
                    <p className="text-[#FFE500]/80 text-xs font-mono leading-relaxed">
                        Offline Cash is an early, partial implementation intended for demonstration and testing only. Use at your own risk and only deposit small amounts you are fully prepared to lose.
                    </p>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Balance Card */}
                 <div className="bg-[#111] border border-white/5 rounded-xl p-6">
                    <h3 className="text-gray-400 font-mono text-xs mb-4">Offline balance USD</h3>
                    <div className="text-4xl font-bold text-white mb-2">$0.00</div>
                    <p className="text-gray-500 text-xs">Available for offline transactions</p>
                 </div>

                 {/* Security Status */}
                 <div className="bg-[#111] border border-white/5 rounded-xl p-6">
                    <h3 className="text-gray-400 font-mono text-xs mb-4">Security status</h3>
                    <div className="flex items-center gap-2 mb-2">
                        <ShieldCheck className="w-5 h-5 text-[#FFE500]" />
                        <span className="text-white font-bold">Secure</span>
                    </div>
                    <p className="text-gray-500 text-xs mb-4">All proofs verified</p>
                    <div className="inline-block px-3 py-1 rounded-full bg-[#FFE500]/10 text-[#FFE500] text-[10px] font-bold border border-[#FFE500]/20 uppercase tracking-wider">
                        128-bit Security
                    </div>
                 </div>
              </div>

              {/* Private Assets */}
              <div className="space-y-4">
                 <div className="flex justify-between items-end">
                    <h3 className="text-sm font-bold text-white">Private assets</h3>
                    <div className="flex gap-4">
                        <Button variant="outline" className="border-[#FFE500]/30 bg-[#FFE500]/5 text-[#FFE500] hover:bg-[#FFE500]/10 gap-2 h-8 text-[10px] uppercase tracking-wider font-bold rounded-full">
                            <FolderOpen className="w-3 h-3" /> Locate assets
                        </Button>
                        <Button variant="ghost" className="text-gray-400 hover:text-white h-8 text-[10px] uppercase tracking-wider font-bold">
                            Choose files
                        </Button>
                        <Button variant="ghost" className="text-gray-400 hover:text-white h-8 text-[10px] uppercase tracking-wider font-bold">
                            Clear assets
                        </Button>
                    </div>
                 </div>

                 <div className="border border-white/5 border-dashed rounded-xl bg-[#0F0F0F] h-24 flex items-center justify-center">
                    <p className="text-gray-600 text-xs font-mono">Select a folder that contains voucher files to see them displayed here.</p>
                 </div>
              </div>
              
              <div className="border border-white/5 rounded-xl p-4 bg-[#0F0F0F] flex items-start gap-3">
                 <div className="w-4 h-4 rounded-full border border-gray-600 flex items-center justify-center shrink-0 mt-0.5 text-[10px] text-gray-600 font-mono">i</div>
                 <p className="text-gray-500 text-xs font-mono leading-relaxed">
                    Once you successfully withdraw funds from a voucher, move or archive that JSON file so the list stays tidy.
                    Wallet errors such as Transaction failed simulation or Account already exists almost always mean the voucher was already redeemed.
                 </p>
              </div>

              <div className="text-gray-500 text-xs font-mono">
                Current FLUX price: ${solPrice.toLocaleString(undefined, { minimumFractionDigits: 6 })}
              </div>
            </div>
          );
        
        case "activity":
            // Mock Activity Data
            const activities = [
                { type: "Sent", amount: "-1.244015635 SOL", subAmount: "951Ed...pwoa", status: "Finalized", timestamp: "Dec 04, 01:41 PM", signature: "45WxbJo15q..." },
                { type: "Received", amount: "+0.025874295 SOL", subAmount: "PL4dM...2aeq", status: "Finalized", timestamp: "Dec 04, 01:40 PM", signature: "2skgU3NY7z..." },
                { type: "Sent", amount: "-0.00203928 SOL", subAmount: "DKvs5...dwot", status: "Finalized", timestamp: "Dec 04, 01:40 PM", signature: "2skgU3NY7z..." },
                { type: "Received", amount: "+0.00001 SOL", subAmount: "95HCw...3qyp", status: "Finalized", timestamp: "Dec 04, 01:36 PM", signature: "2w2w73HDuL..." },
                { type: "Sent", amount: "-2.315 SOL", subAmount: "95HCw...3qyp", status: "Finalized", timestamp: "Dec 04, 01:36 PM", signature: "3E0kfn3ZSo..." },
                { type: "Received", amount: "+0.632990292 SOL", subAmount: "PL4dM...2aeq", status: "Finalized", timestamp: "Dec 04, 01:34 PM", signature: "5pejHwMKot..." },
                { type: "Sent", amount: "-0.00203928 SOL", subAmount: "9uh15...qrRC", status: "Finalized", timestamp: "Dec 04, 01:34 PM", signature: "5pejHwMKot..." },
                { type: "Sent", amount: "-0.027795218 SOL", subAmount: "AVUCZ...cnZH", status: "Finalized", timestamp: "Dec 04, 01:33 PM", signature: "48pMW5qL6c..." },
                { type: "Sent", amount: "-34199203.154141 SpectreOSI", subAmount: "FahQ6...drVi", status: "Finalized", timestamp: "Dec 04, 01:33 PM", signature: "48pMW5qL6c..." },
                { type: "Received", amount: "+1e-7 SOL", subAmount: "HLSMe...hi2F", status: "Finalized", timestamp: "Dec 04, 01:28 PM", signature: "29pfg1XFwm..." },
            ];

            return (
                <div className="max-w-7xl mx-auto h-full flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h1 className="text-2xl font-bold">Activity</h1>
                    </div>

                    <div className="flex justify-between items-center mb-6">
                         <div className="relative w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input placeholder="Search activity" className="pl-10 bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 h-10 rounded-lg text-xs font-mono" />
                         </div>
                         <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 font-mono">Rows per page</span>
                            <Select defaultValue="10">
                                <SelectTrigger className="w-[70px] h-8 bg-[#111] border-white/10 text-xs rounded-lg">
                                    <SelectValue placeholder="10" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#111] border-white/10 text-white">
                                    <SelectItem value="10">10</SelectItem>
                                    <SelectItem value="20">20</SelectItem>
                                    <SelectItem value="50">50</SelectItem>
                                </SelectContent>
                            </Select>
                         </div>
                    </div>

                    <div className="rounded-xl overflow-hidden bg-transparent">
                        <Table>
                            <TableHeader className="bg-transparent border-b border-white/5">
                                <TableRow className="border-white/5 hover:bg-transparent">
                                    <TableHead className="text-gray-400 font-mono text-xs font-bold uppercase w-[200px] pl-4">Type</TableHead>
                                    <TableHead className="text-gray-400 font-mono text-xs font-bold uppercase w-[250px]">Amount</TableHead>
                                    <TableHead className="text-gray-400 font-mono text-xs font-bold uppercase">Status</TableHead>
                                    <TableHead className="text-gray-400 font-mono text-xs font-bold uppercase">Timestamp</TableHead>
                                    <TableHead className="text-gray-400 font-mono text-xs font-bold uppercase text-right pr-4">Signature</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {activities.map((item, i) => (
                                    <TableRow key={i} className="border-white/5 hover:bg-white/5 h-20">
                                        <TableCell className="font-mono text-xs pl-4 font-medium">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center shrink-0">
                                                    {item.type === "Sent" ? 
                                                        <Send className="w-3.5 h-3.5 text-white -rotate-45 mr-0.5 mt-0.5" /> : 
                                                        <Download className="w-3.5 h-3.5 text-white" />
                                                    }
                                                </div>
                                                <span className="text-white font-bold">{item.type}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1.5">
                                                <span className={`font-mono text-xs font-bold tracking-wide ${item.amount.startsWith("+") ? "text-[#4ADE80]" : "text-[#F87171]"}`}>
                                                    {item.amount}
                                                </span>
                                                <span className="font-mono text-[10px] text-gray-400 font-medium">
                                                    {item.subAmount}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 text-[#4ADE80] text-[10px] font-bold uppercase tracking-wider">
                                                <CheckCircle2 className="w-3 h-3" /> {item.status}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-gray-300 font-bold tracking-wide">{item.timestamp}</TableCell>
                                        <TableCell className="font-mono text-xs text-gray-500 text-right pr-4 font-medium">
                                            <div className="flex items-center justify-end gap-2 group cursor-pointer hover:text-white transition-colors">
                                                {item.signature} 
                                                <div className="w-4 h-4 flex items-center justify-center">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 group-hover:opacity-100">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                                        <polyline points="15 3 21 3 21 9"></polyline>
                                                        <line x1="10" y1="14" x2="21" y2="3"></line>
                                                    </svg>
                                                </div>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex justify-between items-center mt-6 text-xs text-gray-500 font-mono">
                        <div>Showing 1-10 of 13</div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-white/10 bg-[#111] hover:bg-white/5 text-gray-400" disabled>
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                             <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-white/10 bg-[#111] hover:bg-white/5 text-gray-400">
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            );

        case "feedback":
            return (
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-2xl font-bold mb-8">Feedback</h1>
                    
                    <div className="bg-[#111] border border-white/5 rounded-xl p-8 md:p-12 max-w-2xl mx-auto">
                         <h2 className="text-lg font-mono text-gray-400 mb-8">Web wallet demo feedback</h2>

                         <div className="space-y-6">
                            <div className="space-y-2">
                                <Input placeholder="How should we address you?" className="bg-[#0F0F0F] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 h-12" />
                            </div>

                            <div className="space-y-2">
                                <Textarea placeholder="Tell us what's working well, what's confusing, or what you'd like to see next." className="bg-[#0F0F0F] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 min-h-[160px] resize-none p-4" />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs text-gray-500 font-mono">Wallet address</Label>
                                <div className="px-4 py-3 bg-[#0F0F0F] border border-white/10 rounded-md text-xs font-mono text-gray-400">
                                    {address || "Not connected"}
                                </div>
                            </div>

                            <Button 
                                onClick={() => {
                                    /* In a real app, submit logic here */
                                }}
                                className="w-full bg-[#FFE500] hover:bg-[#FF8C00] text-black font-bold h-12 uppercase tracking-widest text-xs border-none mt-4"
                            >
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <span className="w-full h-full flex items-center justify-center">Submit feedback</span>
                                    </DialogTrigger>
                                    <DialogContent className="bg-black border border-[#FFE500]/30 text-white sm:max-w-[425px]">
                                        <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
                                            <div className="w-16 h-16 rounded-full bg-[#FFE500]/10 flex items-center justify-center mb-2">
                                                <CheckCircle2 className="w-8 h-8 text-[#FFE500]" />
                                            </div>
                                            <h2 className="text-xl font-bold font-neue text-white uppercase tracking-wide">Thank You</h2>
                                            <p className="text-gray-400 font-mono text-sm max-w-xs">
                                                Your feedback helps us build a better private economy.
                                            </p>
                                            <DialogClose asChild>
                                                <Button className="mt-4 bg-[#FFE500] text-black hover:bg-[#FF8C00] rounded-full px-8 font-bold uppercase tracking-wider text-xs">
                                                    Close
                                                </Button>
                                            </DialogClose>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </Button>
                         </div>
                    </div>
                </div>
            );

        default:
          return (
             <div className="max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

                {/* Balance Card */}
                <div className="bg-[#111111] border border-white/5 rounded-2xl p-8 mb-12 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#FFE500]/50 to-transparent opacity-50" />
                    
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm text-gray-400 font-mono tracking-wider">Balance USD</h2>
                        <button 
                            onClick={() => setHideBalance(!hideBalance)}
                            className="text-gray-500 hover:text-white transition-colors"
                        >
                            {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>

                    <div className="mb-6">
                        <span className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                            {hideBalance ? "••••••" : formattedTotalValue}
                        </span>
                    </div>

                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#FFE500]/50 w-1/3 rounded-full" /> 
                    </div>
                </div>

                {/* Assets Section */}
                <div>
                    <h3 className="text-xl font-bold mb-8 font-neue">Assets</h3>
                    
                    <div className="w-full">
                        {/* Table Header */}
                        <div className="grid grid-cols-5 gap-4 text-xs font-mono text-gray-500 uppercase tracking-wider mb-6 px-6">
                            <div className="col-span-2">Name</div>
                            <div className="text-right">Price</div>
                            <div className="text-right">Amount</div>
                            <div className="text-right">Value</div>
                            {/* <div className="text-right">24hr %</div> */}
                        </div>

                        {/* Divider */}
                        <div className="h-px w-full bg-white/5 mb-6" />

                        {/* Asset Row: Wrapped SOL */}
                        <div className="group grid grid-cols-5 gap-4 items-center px-6 py-6 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5">
                            <div className="col-span-2 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-black border border-white/10 flex items-center justify-center shrink-0">
                                    <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="font-bold text-base text-white">Wrapped SOL</div>
                                    <div className="text-xs text-gray-500 font-mono mt-0.5">SOL</div>
                                </div>
                            </div>
                            <div className="text-right font-mono text-sm text-gray-300 font-medium">
                                ${solPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-right font-mono text-sm text-gray-300 font-medium">
                                {hideBalance ? "•••" : balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                            </div>
                            <div className="text-right font-mono text-sm text-white font-bold">
                                {hideBalance ? "••••" : solValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </div>
                        </div>

                         {/* Asset Row: USDC */}
                         <div className="group grid grid-cols-5 gap-4 items-center px-6 py-6 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5 mt-2">
                            <div className="col-span-2 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-black border border-white/10 flex items-center justify-center shrink-0">
                                     <div className="w-6 h-6 rounded-full bg-[#2775CA] flex items-center justify-center text-[10px] font-bold text-white">
                                        $
                                     </div>
                                </div>
                                <div>
                                    <div className="font-bold text-base text-white">USDC</div>
                                    <div className="text-xs text-gray-500 font-mono mt-0.5">USDC</div>
                                </div>
                            </div>
                            <div className="text-right font-mono text-sm text-gray-300 font-medium">
                                $1.00
                            </div>
                            <div className="text-right font-mono text-sm text-gray-300 font-medium">
                                {hideBalance ? "•••" : usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-right font-mono text-sm text-white font-bold">
                                {hideBalance ? "••••" : usdcValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </div>
                        </div>

                    </div>
                </div>

            </div>
          );
      }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-neue flex overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-black flex flex-col p-6 z-20">
        <div className="mb-10 pl-2">
             <img src={fluxalTitle} alt="FLUXAL" className="h-12 w-auto object-contain opacity-90" />
        </div>

        <nav className="space-y-2 flex-1">
            <SidebarItem id="dashboard" icon={Home} label="Dashboard" />
            <SidebarItem id="stealth" icon={Shield} label="Stealth Transfers" />
            <SidebarItem id="offline" icon={WifiOff} label="Offline Cash" />
            <SidebarItem id="activity" icon={Activity} label="Activity" />
            <SidebarItem id="feedback" icon={MessageSquare} label="Feedback" />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden antialiased">
         {/* Top Bar */}
         <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-black/50 backdrop-blur-sm sticky top-0 z-10">
            <div>
                 {/* Empty left side or breadcrumbs */}
            </div>
            <div className="flex items-center gap-4">
                 <div className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-mono text-gray-300 flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${authenticated ? "bg-[#FFE500] animate-pulse" : "bg-red-500"}`} />
                    {authenticated ? shortAddress : "Not Connected"}
                 </div>
                 {authenticated ? (
                     <Button 
                        onClick={logout}
                        variant="ghost" 
                        className="text-xs text-gray-500 hover:text-white h-8"
                     >
                        Disconnect
                     </Button>
                 ) : (
                     <Button 
                        onClick={() => setLocation("/connect")}
                        variant="ghost" 
                        className="text-xs text-[#FFE500] hover:text-[#FFDD00] h-8"
                     >
                        Connect
                     </Button>
                 )}
            </div>
         </header>

         {/* Content Area */}
         <div className="flex-1 overflow-y-auto p-8">
            {renderContent()}
         </div>

         {/* Bug Report Fab */}
         <div className="absolute bottom-8 right-8">
            <Dialog>
              <DialogTrigger asChild>
                <Button className="rounded-full bg-[#1e1e1e] border border-white/10 text-xs text-gray-400 hover:text-white hover:border-[#FFE500]/50 gap-2 pl-3 pr-4 h-10">
                    <Bug className="w-3 h-3" />
                    Report a Bug
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-black border border-white/10 text-white sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold font-neue">Report a Bug</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name" className="text-gray-300 font-neue">Name</Label>
                    <Input id="name" placeholder="Your Name" className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email" className="text-gray-300 font-neue">Email</Label>
                    <Input id="email" placeholder="your.email@example.org" className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description" className="text-gray-300 font-neue">Description (required)</Label>
                    <Textarea id="description" placeholder="What's the bug? What did you expect?" className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 min-h-[100px] focus:border-[#FFE500]/50 focus:ring-[#FFE500]/20" />
                  </div>
                  <Button variant="outline" className="w-full bg-transparent border-white/10 text-gray-400 hover:bg-white/5 hover:text-white hover:border-white/20">
                    Add a screenshot
                  </Button>
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
                  <Button className="w-full bg-[#FFE500] hover:bg-[#FF8C00] text-black font-bold border-none">
                    Send Bug Report
                  </Button>
                  <DialogClose asChild>
                     <Button variant="ghost" className="w-full text-gray-500 hover:text-white hover:bg-transparent">
                        Cancel
                     </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
         </div>

      </main>
      
      {/* Custom Regenerate Confirmation Dialog */}
      {showRegenerateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111] border border-[#FFE500]/30 rounded-2xl shadow-2xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <RefreshCw size={24} className="text-yellow-500" />
                </div>
                <h3 className="text-white text-xl font-bold">Regenerate Meta-Address?</h3>
              </div>
              <p className="text-white/60 text-base leading-relaxed mb-4">
                ⚠️ This will create a new meta-address. You'll need to share the new address with anyone who wants to send you payments. Your old meta-address will no longer work.
              </p>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
                <p className="text-yellow-500 text-sm font-medium mb-1">⚡ Important</p>
                <p className="text-white/60 text-xs">
                  Anyone with your old meta-address won't be able to send you future payments.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowRegenerateConfirm(false)}
                  variant="outline"
                  className="flex-1 border-white/20 hover:bg-white/10 text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={performGeneration}
                  className="flex-1 bg-[#FFE500] hover:bg-[#FFDD00] text-black font-bold"
                >
                  <RefreshCw size={16} className="mr-2" />
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}