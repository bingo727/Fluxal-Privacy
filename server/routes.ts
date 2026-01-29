import type { Express } from "express";
import { type Server } from "http";
import privacyContractRoutes from './privacy-contract-routes';
import { storeUserKeys, getUserKeys } from './stealth-key-storage';

/**
 * Register API routes
 * Only essential endpoints for privacy contract functionality
 */
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== KEY STORAGE ROUTES ====================
  
  /**
   * GET /api/stealth/meta-address/:userId
   * Get existing meta-address for a user
   */
  app.get('/api/stealth/meta-address/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const userKeys = getUserKeys(userId);
      
      if (!userKeys) {
        return res.status(404).json({ 
          success: false,
          error: 'Meta-address not found for this user' 
        });
      }
      
      res.json({
        success: true,
        metaAddress: userKeys.metaAddress
      });
      
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve meta-address',
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/stealth/store-meta-address
   * Store meta-address with private keys for a user
   */
  app.post('/api/stealth/store-meta-address', async (req, res) => {
    try {
      const { userId, metaAddress, privateKeys } = req.body;
      
      if (!userId || !metaAddress || !privateKeys) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: userId, metaAddress, privateKeys'
        });
      }
      
      storeUserKeys(userId, {
        metaAddress,
        spendingPrivateKey: privateKeys.spendingPrivateKey,
        viewingPrivateKey: privateKeys.viewingPrivateKey
      });
      
      res.json({
        success: true,
        message: 'Meta-address stored successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'Failed to store meta-address',
        details: error.message
      });
    }
  });
  
  /**
   * GET /api/stealth/get-keys/:userId
   * Get private keys for a user (for scanning/claiming)
   */
  app.get('/api/stealth/get-keys/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const userKeys = getUserKeys(userId);
      
      if (!userKeys) {
        return res.status(404).json({
          success: false,
          error: 'Keys not found for this user'
        });
      }
      
      res.json({
        success: true,
        spendingPrivateKey: userKeys.spendingPrivateKey,
        viewingPrivateKey: userKeys.viewingPrivateKey
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve keys',
        details: error.message
      });
    }
  });

  // ==================== PRIVACY CONTRACT ROUTES ====================
  app.use('/api/privacy-contract', privacyContractRoutes);

  return httpServer;
}
