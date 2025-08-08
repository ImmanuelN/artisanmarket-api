import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authMiddleware.js';
import Vendor from '../models/Vendor.js';
import { plaidClient } from '../server.js';

const router = express.Router();

// Create Plaid link token for vendor bank account setup
router.post('/create-link-token',
  requireAuth,
  async (req, res) => {
    try {
      // Verify user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can set up bank accounts'
        });
      }

      const request = {
        user: { client_user_id: req.user.id },
        client_name: 'ArtisanMarket',
        products: ['auth', 'transfer'],
        country_codes: ['US'],
        language: 'en',
        account_filters: {
          depository: {
            account_subtypes: ['checking', 'savings']
          }
        }
      };

      console.log('Creating Plaid link token for vendor:', req.user.id);
      
      // Check if Plaid is properly configured
      if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
        // In development mode, provide a mock response
        if (process.env.NODE_ENV === 'development') {
          console.log('📝 Development mode: Providing mock Plaid link token');
          return res.json({
            success: true,
            linkToken: 'link-sandbox-mock-token-for-development',
            message: 'Mock token for development - Plaid not configured'
          });
        }
        
        return res.status(503).json({
          success: false,
          message: 'Plaid integration is not configured. Please set up PLAID_CLIENT_ID and PLAID_SECRET environment variables.',
          error: 'PLAID_NOT_CONFIGURED'
        });
      }
      
      const createTokenResponse = await plaidClient.linkTokenCreate(request);
      
      res.json({
        success: true,
        linkToken: createTokenResponse.data.link_token
      });
    } catch (error) {
      console.error('Error creating link token for vendor:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create link token',
        error: error.message
      });
    }
  }
);

// Exchange public token and save bank account info for vendor
router.post('/setup-bank-account',
  requireAuth,
  [
    body('publicToken').isString().withMessage('Public token is required'),
    body('accountId').isString().withMessage('Account ID is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Verify user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can set up bank accounts'
        });
      }

      const { publicToken, accountId } = req.body;

      // Check if Plaid is properly configured
      if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
        // In development mode, simulate bank account setup
        if (process.env.NODE_ENV === 'development') {
          console.log('📝 Development mode: Simulating bank account setup');
          
          // Find or create vendor profile
          let vendor = await Vendor.findOne({ user: req.user.id });
          if (!vendor) {
            return res.status(404).json({
              success: false,
              message: 'Vendor profile not found'
            });
          }

          // Update vendor with mock bank account information
          vendor.payoutMethod = 'bank_transfer';
          
          // Initialize payoutDetails if it doesn't exist
          if (!vendor.payoutDetails) {
            vendor.payoutDetails = {};
          }
          
          vendor.payoutDetails.plaid = {
            accessToken: 'mock_access_token',
            itemId: 'mock_item_id',
            accountId: accountId,
            lastSync: new Date()
          };
          vendor.payoutDetails.bankAccount = {
            accountNumber: '****1234',
            routingNumber: '123456789',
            accountHolderName: 'Mock Bank Account',
            bankName: 'Development Bank',
            accountType: 'checking'
          };

          await vendor.save();

          console.log('Bank account setup completed for vendor (mock):', req.user.id);

          return res.json({
            success: true,
            message: 'Bank account setup completed successfully (mock)',
            account: {
              name: 'Mock Bank Account',
              mask: '1234',
              type: 'checking',
              bankName: 'Development Bank'
            }
          });
        }
        
        return res.status(503).json({
          success: false,
          message: 'Plaid integration is not configured. Please set up PLAID_CLIENT_ID and PLAID_SECRET environment variables.',
          error: 'PLAID_NOT_CONFIGURED'
        });
      }

      // Exchange public token for access token
      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: publicToken
      });

      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;

      // Get account details
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken
      });

      const selectedAccount = accountsResponse.data.accounts.find(
        account => account.account_id === accountId
      );

      if (!selectedAccount) {
        return res.status(400).json({
          success: false,
          message: 'Selected account not found'
        });
      }

      // Find or create vendor profile
      let vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      // Update vendor with bank account information
      vendor.payoutMethod = 'bank_transfer';
      
      // Initialize payoutDetails if it doesn't exist
      if (!vendor.payoutDetails) {
        vendor.payoutDetails = {};
      }
      
      vendor.payoutDetails.plaid = {
        accessToken: accessToken,
        itemId: itemId,
        accountId: accountId,
        lastSync: new Date()
      };
      vendor.payoutDetails.bankAccount = {
        accountNumber: selectedAccount.mask || '****',
        routingNumber: '', // Plaid doesn't provide routing number for security
        accountHolderName: selectedAccount.name || 'Vendor Account',
        bankName: selectedAccount.institution_id || 'Connected Bank',
        accountType: selectedAccount.subtype || 'checking'
      };

      await vendor.save();

      console.log('Bank account setup completed for vendor:', req.user.id);

      res.json({
        success: true,
        message: 'Bank account setup completed successfully',
        account: {
          name: selectedAccount.name,
          mask: selectedAccount.mask,
          type: selectedAccount.subtype,
          bankName: selectedAccount.institution_id
        }
      });
    } catch (error) {
      console.error('Error setting up bank account for vendor:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to set up bank account',
        error: error.message
      });
    }
  }
);

// Get vendor's bank account information
router.get('/bank-account',
  requireAuth,
  async (req, res) => {
    try {
      // Verify user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can access bank account information'
        });
      }

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      // Return bank account info (masked for security)
      const bankAccountInfo = {
        isConnected: !!(vendor.payoutDetails?.plaid?.accessToken),
        payoutMethod: vendor.payoutMethod,
        bankAccount: vendor.payoutDetails?.bankAccount ? {
          accountNumber: vendor.payoutDetails.bankAccount.accountNumber,
          accountHolderName: vendor.payoutDetails.bankAccount.accountHolderName,
          bankName: vendor.payoutDetails.bankAccount.bankName,
          accountType: vendor.payoutDetails.bankAccount.accountType
        } : null,
        lastSync: vendor.payoutDetails?.plaid?.lastSync
      };

      res.json({
        success: true,
        bankAccount: bankAccountInfo
      });
    } catch (error) {
      console.error('Error getting bank account info:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bank account information',
        error: error.message
      });
    }
  }
);

// Simulate a payout to vendor's bank account
router.post('/simulate-payout',
  requireAuth,
  [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('description').optional().isString().withMessage('Description must be a string'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Verify user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can receive payouts'
        });
      }

      const { amount, description = 'ArtisanMarket Payout' } = req.body;

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      if (!vendor.payoutDetails?.plaid?.accessToken) {
        return res.status(400).json({
          success: false,
          message: 'No bank account connected. Please set up a bank account first.'
        });
      }

      // Check if vendor has sufficient balance
      if (vendor.financials.balance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient balance for payout'
        });
      }

      try {
        // Create a transfer using Plaid
        const transferResponse = await plaidClient.transferCreate({
          access_token: vendor.payoutDetails?.plaid.accessToken,
          account_id: vendor.payoutDetails?.plaid.accountId,
          authorization_id: 'auth_placeholder', // In real implementation, you'd create this first
          type: 'debit',
          network: 'ach',
          amount: amount.toString(),
          description,
          ach_class: 'ppd',
          user: {
            legal_name: vendor.storeName || 'Vendor',
            email_address: vendor.contact.email,
            address: {
              street: vendor.business.address?.street || '123 Main St',
              city: vendor.business.address?.city || 'San Francisco',
              state: vendor.business.address?.state || 'CA',
              zip: vendor.business.address?.zipCode || '94053',
              country: vendor.business.address?.country || 'US'
            }
          }
        });

        // Update vendor balance
        vendor.financials.balance -= amount;
        vendor.financials.totalEarnings += amount;
        await vendor.save();

        console.log('Payout simulated successfully for vendor:', req.user.id, 'Amount:', amount);

        res.json({
          success: true,
          message: 'Payout initiated successfully',
          transfer: {
            id: transferResponse.data.transfer.id,
            amount: amount,
            status: transferResponse.data.transfer.status,
            description: description
          }
        });
      } catch (plaidError) {
        console.error('Plaid transfer error:', plaidError);
        
        // For simulation purposes, we'll still update the balance even if Plaid fails
        vendor.financials.balance -= amount;
        vendor.financials.totalEarnings += amount;
        await vendor.save();

        res.json({
          success: true,
          message: 'Payout simulated successfully (Plaid integration in test mode)',
          transfer: {
            id: `sim_${Date.now()}`,
            amount: amount,
            status: 'pending',
            description: description
          }
        });
      }
    } catch (error) {
      console.error('Error simulating payout:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process payout',
        error: error.message
      });
    }
  }
);

// Get vendor's financial summary
router.get('/financial-summary',
  requireAuth,
  async (req, res) => {
    try {
      // Verify user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can access financial information'
        });
      }

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      res.json({
        success: true,
                  financials: {
            balance: vendor.financials.balance,
            pendingBalance: vendor.financials.pendingBalance,
            totalEarnings: vendor.financials.totalEarnings,
            commissionRate: vendor.financials.commissionRate,
            payoutMethod: vendor.payoutMethod,
            isBankConnected: !!vendor.payoutDetails?.plaid?.accessToken
          }
      });
    } catch (error) {
      console.error('Error getting financial summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get financial summary',
        error: error.message
      });
    }
  }
);

export default router; 