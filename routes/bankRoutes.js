import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authMiddleware.js';
import { 
  encrypt, 
  decrypt, 
  maskSensitiveData, 
  validateCardNumber, 
  validateExpiryDate, 
  validateCVV,
  getTestCardNumbers
} from '../utils/encryption.js';
import BankAccount from '../models/BankAccount.js';
import VendorBalance from '../models/VendorBalance.js';
import CustomerBalance from '../models/CustomerBalance.js';
import Vendor from '../models/Vendor.js';
import User from '../models/User.js';

const router = express.Router();

// Connect bank account
router.post('/connect', 
  requireAuth,
  [
    body('cardHolderName')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Cardholder name must be between 2 and 100 characters'),
    body('cardNumber')
      .trim()
      .isLength({ min: 13, max: 19 })
      .withMessage('Card number must be between 13 and 19 digits'),
    body('expiryMonth')
      .trim()
      .isLength({ min: 1, max: 2 })
      .isInt({ min: 1, max: 12 })
      .withMessage('Expiry month must be between 1 and 12'),
    body('expiryYear')
      .trim()
      .isLength({ min: 2, max: 4 })
      .isInt({ min: 2024 })
      .withMessage('Expiry year must be 2024 or later'),
    body('cvv')
      .trim()
      .isLength({ min: 3, max: 4 })
      .isNumeric()
      .withMessage('CVV must be 3 or 4 digits'),
    body('bankName')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Bank name must be between 2 and 100 characters'),
    body('type')
      .isIn(['customer', 'vendor'])
      .withMessage('Type must be either customer or vendor')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { 
        cardHolderName, 
        cardNumber, 
        expiryMonth, 
        expiryYear, 
        cvv, 
        bankName, 
        type 
      } = req.body;

      // Additional validation
      if (!validateCardNumber(cardNumber)) {
        console.log(`❌ Card validation failed for: ${cardNumber.replace(/\d(?=\d{4})/g, '*')}`);
        return res.status(400).json({
          success: false,
          message: 'Invalid card number. Please ensure the card number is valid and follows the Luhn algorithm.'
        });
      }

      if (!validateExpiryDate(expiryMonth, expiryYear)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expiry date'
        });
      }

      if (!validateCVV(cvv)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid CVV'
        });
      }

      // Check if user already has a bank account
      const existingAccount = await BankAccount.findOne({ user: req.user.id });
      if (existingAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account already exists for this user'
        });
      }

      // Encrypt sensitive data
      const encryptedCardNumber = encrypt(cardNumber);
      const encryptedExpiryMonth = encrypt(expiryMonth);
      const encryptedExpiryYear = encrypt(expiryYear);
      const encryptedCvv = encrypt(cvv);

      // Create bank account
      const bankAccount = new BankAccount({
        user: req.user.id,
        type,
        cardHolderName,
        cardNumber: encryptedCardNumber,
        expiryMonth: encryptedExpiryMonth,
        expiryYear: encryptedExpiryYear,
        cvv: encryptedCvv,
        bankName
      });

      await bankAccount.save();

      // If vendor, create vendor balance
      if (type === 'vendor') {
        const vendor = await Vendor.findOne({ user: req.user.id });
        if (!vendor) {
          return res.status(404).json({
            success: false,
            message: 'Vendor profile not found'
          });
        }

        const vendorBalance = new VendorBalance({
          vendor: vendor._id,
          bankAccount: bankAccount._id
        });

        await vendorBalance.save();
      }

      // If customer, create customer balance
      if (type === 'customer') {
        let customerBalance = await CustomerBalance.findOne({ customer: req.user.id });
        
        if (!customerBalance) {
          customerBalance = new CustomerBalance({
            customer: req.user.id,
            spendingBalance: 1000000, // 1 million starting balance
            totalSpent: 0
          });
          await customerBalance.save();
        }
      }

      console.log(`✅ Bank account connected for user: ${req.user.id} (${type})`);

      res.status(201).json({
        success: true,
        message: 'Bank account connected successfully',
        bankAccount: {
          id: bankAccount._id,
          type: bankAccount.type,
          cardHolderName: bankAccount.cardHolderName,
          maskedCardNumber: maskSensitiveData(cardNumber, 'card'),
          bankName: bankAccount.bankName,
          isActive: bankAccount.isActive
        }
      });

    } catch (error) {
      console.error('❌ Error connecting bank account:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to connect bank account',
        error: error.message
      });
    }
  }
);

// Get bank account info
router.get('/account', requireAuth, async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({ user: req.user.id });
    
    if (!bankAccount) {
      return res.json({
        success: true,
        bankAccount: null,
        message: 'No bank account found'
      });
    }

    // Decrypt card number for masking
    const decryptedCardNumber = decrypt(bankAccount.cardNumber);
    const decryptedExpiryMonth = decrypt(bankAccount.expiryMonth);
    const decryptedExpiryYear = decrypt(bankAccount.expiryYear);

    res.json({
      success: true,
      bankAccount: {
        id: bankAccount._id,
        type: bankAccount.type,
        cardHolderName: bankAccount.cardHolderName,
        maskedCardNumber: maskSensitiveData(decryptedCardNumber, 'card'),
        maskedExpiry: maskSensitiveData(decryptedExpiryMonth + decryptedExpiryYear, 'expiry'),
        bankName: bankAccount.bankName,
        isActive: bankAccount.isActive,
        createdAt: bankAccount.createdAt,
        updatedAt: bankAccount.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error getting bank account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bank account information',
      error: error.message
    });
  }
});

// Update bank account
router.put('/account', 
  requireAuth,
  [
    body('cardHolderName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Cardholder name must be between 2 and 100 characters'),
    body('cardNumber')
      .optional()
      .trim()
      .isLength({ min: 13, max: 19 })
      .withMessage('Card number must be between 13 and 19 digits'),
    body('expiryMonth')
      .optional()
      .trim()
      .isLength({ min: 1, max: 2 })
      .isInt({ min: 1, max: 12 })
      .withMessage('Expiry month must be between 1 and 12'),
    body('expiryYear')
      .optional()
      .trim()
      .isLength({ min: 2, max: 4 })
      .isInt({ min: 2024 })
      .withMessage('Expiry year must be 2024 or later'),
    body('cvv')
      .optional()
      .trim()
      .isLength({ min: 3, max: 4 })
      .isNumeric()
      .withMessage('CVV must be 3 or 4 digits'),
    body('bankName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Bank name must be between 2 and 100 characters')
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

      const bankAccount = await BankAccount.findOne({ user: req.user.id });
      if (!bankAccount) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found'
        });
      }

      // Update fields if provided
      const updateFields = {};
      
      if (req.body.cardHolderName) {
        updateFields.cardHolderName = req.body.cardHolderName;
      }
      
      if (req.body.cardNumber) {
        if (!validateCardNumber(req.body.cardNumber)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid card number'
          });
        }
        updateFields.cardNumber = encrypt(req.body.cardNumber);
      }
      
      if (req.body.expiryMonth && req.body.expiryYear) {
        if (!validateExpiryDate(req.body.expiryMonth, req.body.expiryYear)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid expiry date'
          });
        }
        updateFields.expiryMonth = encrypt(req.body.expiryMonth);
        updateFields.expiryYear = encrypt(req.body.expiryYear);
      }
      
      if (req.body.cvv) {
        if (!validateCVV(req.body.cvv)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid CVV'
          });
        }
        updateFields.cvv = encrypt(req.body.cvv);
      }
      
      if (req.body.bankName) {
        updateFields.bankName = req.body.bankName;
      }

      updateFields.updatedAt = new Date();

      // Update bank account
      const updatedAccount = await BankAccount.findByIdAndUpdate(
        bankAccount._id,
        updateFields,
        { new: true }
      );

      console.log(`✅ Bank account updated for user: ${req.user.id}`);

      res.json({
        success: true,
        message: 'Bank account updated successfully',
        bankAccount: {
          id: updatedAccount._id,
          type: updatedAccount.type,
          cardHolderName: updatedAccount.cardHolderName,
          maskedCardNumber: req.body.cardNumber ? 
            maskSensitiveData(req.body.cardNumber, 'card') : 
            maskSensitiveData(decrypt(updatedAccount.cardNumber), 'card'),
          bankName: updatedAccount.bankName,
          isActive: updatedAccount.isActive,
          updatedAt: updatedAccount.updatedAt
        }
      });

    } catch (error) {
      console.error('❌ Error updating bank account:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update bank account',
        error: error.message
      });
    }
  }
);

// Delete bank account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({ user: req.user.id });
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    // If vendor, check if they have pending balance
    if (bankAccount.type === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user.id });
      if (vendor) {
        const vendorBalance = await VendorBalance.findOne({ vendor: vendor._id });
        if (vendorBalance && (vendorBalance.availableBalance > 0 || vendorBalance.pendingBalance > 0)) {
          return res.status(400).json({
            success: false,
            message: 'Cannot delete bank account with pending or available balance. Please request a payout first.'
          });
        }
      }
    }

    await BankAccount.findByIdAndDelete(bankAccount._id);

    console.log(`✅ Bank account deleted for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Bank account deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting bank account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bank account',
      error: error.message
    });
  }
});

// Test endpoint to validate card numbers (development only)
router.post('/test-card', (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ message: 'Not found' });
  }

  const { cardNumber } = req.body;
  
  if (!cardNumber) {
    return res.status(400).json({
      success: false,
      message: 'Card number is required'
    });
  }

  const isValid = validateCardNumber(cardNumber);
  const testCards = getTestCardNumbers();
  const isTestCard = testCards.includes(cardNumber.replace(/\s+/g, '').replace(/-/g, ''));

  res.json({
    success: true,
    cardNumber: cardNumber.replace(/\d(?=\d{4})/g, '*'),
    isValid,
    isTestCard,
    testCards: testCards.map(card => card.replace(/\d(?=\d{4})/g, '*'))
  });
});

export default router; 