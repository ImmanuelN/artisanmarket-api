import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import BankAccount from '../models/BankAccount.js';
import ShippingInformation from '../models/ShippingInformation.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get customer stats
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Get total orders
  const totalOrders = await Order.countDocuments({ customer: userId });

  // Get total spent from all orders (not just completed ones for accurate tracking)
  const orders = await Order.find({ customer: userId });
  const totalSpent = orders.reduce((sum, order) => sum + (order.total || 0), 0);

  // For wishlist items, we'll need to get this from frontend since it's stored in localStorage
  // This will be updated by the frontend when sending stats
  const wishlistItems = req.query.wishlistCount ? parseInt(req.query.wishlistCount) : 0;

  // Get reviews count (placeholder - would need review model)
  const reviewsGiven = 0; // TODO: Implement review functionality

  res.json({
    success: true,
    stats: {
      totalOrders,
      totalSpent,
      wishlistItems,
      reviewsGiven
    }
  });
}));

// Get customer profile
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  
  res.json({
    success: true,
    user
  });
}));

// Update customer profile
router.put('/profile', requireAuth, [
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
  body('phone').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { name, email, phone } = req.body;
  const updateData = {};

  if (name) updateData.name = name;
  if (email) updateData.email = email;
  if (phone) updateData.phone = phone;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updateData,
    { new: true, runValidators: true }
  ).select('-password');

  res.json({
    success: true,
    message: 'Profile updated successfully',
    user
  });
}));

// Update customer password
router.put('/password', requireAuth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  // Verify current password
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: 'Password updated successfully'
  });
}));

// Update customer avatar
router.put('/avatar', requireAuth, asyncHandler(async (req, res) => {
  // This endpoint should work with the upload middleware
  // The actual file upload will be handled by the upload routes
  // This endpoint will just update the user's avatar URL
  
  const { avatarUrl } = req.body;
  
  if (!avatarUrl) {
    return res.status(400).json({
      success: false,
      message: 'Avatar URL is required'
    });
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { avatar: avatarUrl },
    { new: true }
  ).select('-password');

  res.json({
    success: true,
    message: 'Avatar updated successfully',
    avatar: avatarUrl,
    user
  });
}));

// Get customer preferences
router.get('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  
  // Default preferences
  const preferences = {
    notifications: {
      email: {
        newOrders: true,
        orderUpdates: true,
        promotions: false,
        newsletter: true
      },
      push: {
        newOrders: true,
        orderUpdates: true,
        promotions: false
      }
    },
    privacy: {
      profileVisibility: 'public',
      showEmail: false,
      showPhone: false,
      allowMarketing: false
    },
    display: {
      theme: 'light',
      language: 'en',
      currency: 'USD',
      timezone: 'UTC'
    }
  };

  // Merge with user preferences if they exist
  if (user.preferences) {
    Object.assign(preferences, user.preferences);
  }

  res.json({
    success: true,
    preferences
  });
}));

// Update customer preferences
router.put('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const { preferences } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { preferences },
    { new: true }
  );

  res.json({
    success: true,
    message: 'Preferences updated successfully',
    preferences: user.preferences
  });
}));

// Get shipping addresses
router.get('/shipping-addresses', requireAuth, asyncHandler(async (req, res) => {
  const addresses = await ShippingInformation.find({ 
    user: req.user._id,
    isActive: true 
  }).sort({ isDefault: -1, createdAt: -1 });

  res.json({
    success: true,
    addresses
  });
}));

// Add shipping address
router.post('/shipping-addresses', requireAuth, [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('zipCode').trim().notEmpty().withMessage('ZIP code is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('addressType').optional().isIn(['home', 'work', 'other']).withMessage('Invalid address type'),
  body('isDefault').optional().isBoolean().withMessage('isDefault must be a boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const addressData = {
    ...req.body,
    user: req.user._id
  };

  const address = new ShippingInformation(addressData);
  await address.save();

  res.status(201).json({
    success: true,
    message: 'Shipping address added successfully',
    address
  });
}));

// Update shipping address
router.put('/shipping-addresses/:id', requireAuth, [
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
  body('phone').optional().trim().notEmpty().withMessage('Phone number cannot be empty'),
  body('address').optional().trim().notEmpty().withMessage('Address cannot be empty'),
  body('city').optional().trim().notEmpty().withMessage('City cannot be empty'),
  body('state').optional().trim().notEmpty().withMessage('State cannot be empty'),
  body('zipCode').optional().trim().notEmpty().withMessage('ZIP code cannot be empty'),
  body('country').optional().trim().notEmpty().withMessage('Country cannot be empty'),
  body('addressType').optional().isIn(['home', 'work', 'other']).withMessage('Invalid address type'),
  body('isDefault').optional().isBoolean().withMessage('isDefault must be a boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const address = await ShippingInformation.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true, runValidators: true }
  );

  if (!address) {
    return res.status(404).json({
      success: false,
      message: 'Shipping address not found'
    });
  }

  res.json({
    success: true,
    message: 'Shipping address updated successfully',
    address
  });
}));

// Delete shipping address
router.delete('/shipping-addresses/:id', requireAuth, asyncHandler(async (req, res) => {
  const address = await ShippingInformation.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id
  });

  if (!address) {
    return res.status(404).json({
      success: false,
      message: 'Shipping address not found'
    });
  }

  res.json({
    success: true,
    message: 'Shipping address deleted successfully'
  });
}));

export default router; 