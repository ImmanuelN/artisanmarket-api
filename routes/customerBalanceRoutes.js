import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import CustomerBalance from '../models/CustomerBalance.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get customer balance
router.get('/balance', requireAuth, asyncHandler(async (req, res) => {
  let customerBalance = await CustomerBalance.findOne({ customer: req.user._id });

  // Create balance if it doesn't exist
  if (!customerBalance) {
    customerBalance = new CustomerBalance({
      customer: req.user._id,
      spendingBalance: 1000000, // 1 million starting balance
      totalSpent: 0
    });
    await customerBalance.save();
  }

  res.json({
    success: true,
    balance: customerBalance
  });
}));

// Deduct amount from balance
router.post('/deduct', requireAuth, asyncHandler(async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid amount is required'
    });
  }

  let customerBalance = await CustomerBalance.findOne({ customer: req.user._id });

  if (!customerBalance) {
    return res.status(404).json({
      success: false,
      message: 'Customer balance not found'
    });
  }

  if (customerBalance.spendingBalance < amount) {
    return res.status(400).json({
      success: false,
      message: 'Insufficient balance',
      currentBalance: customerBalance.spendingBalance,
      requiredAmount: amount
    });
  }

  const success = customerBalance.deductAmount(amount);
  await customerBalance.save();

  if (success) {
    res.json({
      success: true,
      message: 'Amount deducted successfully',
      newBalance: customerBalance.spendingBalance,
      deductedAmount: amount
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Failed to deduct amount'
    });
  }
}));

// Add amount to balance
router.post('/add', requireAuth, asyncHandler(async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid amount is required'
    });
  }

  let customerBalance = await CustomerBalance.findOne({ customer: req.user._id });

  if (!customerBalance) {
    customerBalance = new CustomerBalance({
      customer: req.user._id,
      spendingBalance: 1000000 + amount, // 1 million + additional amount
      totalSpent: 0
    });
  } else {
    customerBalance.addAmount(amount);
  }

  await customerBalance.save();

  res.json({
    success: true,
    message: 'Amount added successfully',
    newBalance: customerBalance.spendingBalance,
    addedAmount: amount
  });
}));

// Get transaction history
router.get('/transactions', requireAuth, asyncHandler(async (req, res) => {
  const customerBalance = await CustomerBalance.findOne({ customer: req.user._id });

  if (!customerBalance) {
    return res.status(404).json({
      success: false,
      message: 'Customer balance not found'
    });
  }

  res.json({
    success: true,
    balance: customerBalance.spendingBalance,
    totalSpent: customerBalance.totalSpent,
    lastTransaction: customerBalance.lastTransaction
  });
}));

export default router; 