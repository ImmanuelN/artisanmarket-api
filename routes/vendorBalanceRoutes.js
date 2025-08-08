import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authMiddleware.js';
import VendorBalance from '../models/VendorBalance.js';
import Vendor from '../models/Vendor.js';
import BankAccount from '../models/BankAccount.js';

const router = express.Router();

// Get vendor balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    // Verify user is a vendor
    if (req.user.role !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can access balance information'
      });
    }

    const vendor = await Vendor.findOne({ user: req.user.id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vendorBalance = await VendorBalance.findOne({ vendor: vendor._id })
      .populate('bankAccount', 'cardHolderName bankName isActive');

    if (!vendorBalance) {
      return res.json({
        success: true,
        balance: {
          totalEarnings: 0,
          availableBalance: 0,
          pendingBalance: 0,
          totalPayouts: 0,
          lastPayout: null,
          lastPayoutAmount: 0,
          minimumPayoutAmount: 10.00,
          commissionRate: 0.15,
          isActive: false,
          bankAccount: null
        }
      });
    }

    res.json({
      success: true,
      balance: {
        totalEarnings: vendorBalance.totalEarnings,
        availableBalance: vendorBalance.availableBalance,
        pendingBalance: vendorBalance.pendingBalance,
        totalPayouts: vendorBalance.totalPayouts,
        lastPayout: vendorBalance.lastPayout,
        lastPayoutAmount: vendorBalance.lastPayoutAmount,
        minimumPayoutAmount: vendorBalance.minimumPayoutAmount,
        commissionRate: vendorBalance.commissionRate,
        isActive: vendorBalance.isActive,
        bankAccount: vendorBalance.bankAccount
      }
    });

  } catch (error) {
    console.error('❌ Error getting vendor balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get vendor balance',
      error: error.message
    });
  }
});

// Request payout
router.post('/payout', 
  requireAuth,
  [
    body('amount')
      .isFloat({ min: 10.00 })
      .withMessage('Payout amount must be at least $10.00'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Description must be less than 200 characters')
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
          message: 'Only vendors can request payouts'
        });
      }

      const { amount, description = 'Vendor payout request' } = req.body;

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      const vendorBalance = await VendorBalance.findOne({ vendor: vendor._id });
      if (!vendorBalance) {
        return res.status(404).json({
          success: false,
          message: 'Vendor balance not found'
        });
      }

      // Check if bank account is connected
      if (!vendorBalance.bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'No bank account connected. Please connect a bank account first.'
        });
      }

      // Check if bank account is active
      const bankAccount = await BankAccount.findById(vendorBalance.bankAccount);
      if (!bankAccount || !bankAccount.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Bank account is not active. Please update your bank account information.'
        });
      }

      // Check if amount is valid
      if (amount < vendorBalance.minimumPayoutAmount) {
        return res.status(400).json({
          success: false,
          message: `Minimum payout amount is $${vendorBalance.minimumPayoutAmount.toFixed(2)}`
        });
      }

      if (amount > vendorBalance.availableBalance) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient available balance for this payout amount'
        });
      }

      // Process payout (simulate bank transfer)
      try {
        // In a real implementation, you would:
        // 1. Create a bank transfer via your banking API
        // 2. Wait for confirmation
        // 3. Update the balance
        
        // For demo purposes, we'll simulate the transfer
        await vendorBalance.processPayout(amount);

        console.log(`✅ Payout processed for vendor: ${req.user.id}, Amount: $${amount}`);

        res.json({
          success: true,
          message: 'Payout processed successfully',
          payout: {
            id: `payout_${Date.now()}`,
            amount: amount,
            description: description,
            status: 'completed',
            processedAt: new Date(),
            bankAccount: {
              cardHolderName: bankAccount.cardHolderName,
              bankName: bankAccount.bankName
            }
          },
          newBalance: {
            availableBalance: vendorBalance.availableBalance,
            totalPayouts: vendorBalance.totalPayouts,
            lastPayout: vendorBalance.lastPayout
          }
        });

      } catch (payoutError) {
        console.error('❌ Payout processing error:', payoutError);
        res.status(500).json({
          success: false,
          message: 'Failed to process payout',
          error: payoutError.message
        });
      }

    } catch (error) {
      console.error('❌ Error requesting payout:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to request payout',
        error: error.message
      });
    }
  }
);

// Add earnings (for demo/testing purposes)
router.post('/add-earnings', 
  requireAuth,
  [
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Description must be less than 200 characters')
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
          message: 'Only vendors can add earnings'
        });
      }

      const { amount, description = 'Demo earnings' } = req.body;

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      let vendorBalance = await VendorBalance.findOne({ vendor: vendor._id });
      
      // Create vendor balance if it doesn't exist
      if (!vendorBalance) {
        const bankAccount = await BankAccount.findOne({ user: req.user.id });
        if (!bankAccount) {
          return res.status(400).json({
            success: false,
            message: 'No bank account found. Please connect a bank account first.'
          });
        }

        vendorBalance = new VendorBalance({
          vendor: vendor._id,
          bankAccount: bankAccount._id
        });
      }

      // Add earnings
      await vendorBalance.addEarnings(amount);

      console.log(`✅ Earnings added for vendor: ${req.user.id}, Amount: $${amount}`);

      res.json({
        success: true,
        message: 'Earnings added successfully',
        earnings: {
          amount: amount,
          description: description,
          addedAt: new Date()
        },
        newBalance: {
          totalEarnings: vendorBalance.totalEarnings,
          availableBalance: vendorBalance.availableBalance,
          pendingBalance: vendorBalance.pendingBalance
        }
      });

    } catch (error) {
      console.error('❌ Error adding earnings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add earnings',
        error: error.message
      });
    }
  }
);

// Get payout history
router.get('/payout-history', requireAuth, async (req, res) => {
  try {
    // Verify user is a vendor
    if (req.user.role !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can access payout history'
      });
    }

    const vendor = await Vendor.findOne({ user: req.user.id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vendorBalance = await VendorBalance.findOne({ vendor: vendor._id });
    if (!vendorBalance) {
      return res.json({
        success: true,
        payoutHistory: []
      });
    }

    // For demo purposes, create a mock payout history
    // In a real implementation, you would have a separate PayoutHistory model
    const mockPayoutHistory = [];
    
    if (vendorBalance.lastPayout) {
      mockPayoutHistory.push({
        id: `payout_${vendorBalance.lastPayout.getTime()}`,
        amount: vendorBalance.lastPayoutAmount,
        status: 'completed',
        description: 'Vendor payout',
        processedAt: vendorBalance.lastPayout,
        bankAccount: {
          cardHolderName: 'Demo Account',
          bankName: 'Demo Bank'
        }
      });
    }

    res.json({
      success: true,
      payoutHistory: mockPayoutHistory
    });

  } catch (error) {
    console.error('❌ Error getting payout history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payout history',
      error: error.message
    });
  }
});

// Update minimum payout amount
router.put('/minimum-payout', 
  requireAuth,
  [
    body('minimumPayoutAmount')
      .isFloat({ min: 1.00, max: 1000.00 })
      .withMessage('Minimum payout amount must be between $1.00 and $1000.00')
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
          message: 'Only vendors can update minimum payout amount'
        });
      }

      const { minimumPayoutAmount } = req.body;

      const vendor = await Vendor.findOne({ user: req.user.id });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }

      const vendorBalance = await VendorBalance.findOne({ vendor: vendor._id });
      if (!vendorBalance) {
        return res.status(404).json({
          success: false,
          message: 'Vendor balance not found'
        });
      }

      vendorBalance.minimumPayoutAmount = minimumPayoutAmount;
      await vendorBalance.save();

      console.log(`✅ Minimum payout amount updated for vendor: ${req.user.id} to $${minimumPayoutAmount}`);

      res.json({
        success: true,
        message: 'Minimum payout amount updated successfully',
        minimumPayoutAmount: vendorBalance.minimumPayoutAmount
      });

    } catch (error) {
      console.error('❌ Error updating minimum payout amount:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update minimum payout amount',
        error: error.message
      });
    }
  }
);

export default router; 