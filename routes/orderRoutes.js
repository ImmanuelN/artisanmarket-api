import express from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';

const router = express.Router();

// Get all orders for a customer
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const skip = (page - 1) * limit;

  const query = { customer: req.user.id };
  if (status) {
    query.status = status;
  }

  const orders = await Order.find(query)
    .populate('items.product', 'title images price')
    .populate('items.vendor', 'storeName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Order.countDocuments(query);

  res.json({
    success: true,
    orders,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      totalOrders: total
    }
  });
}));

// Get a specific order
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    customer: req.user.id
  })
    .populate('items.product', 'title images price description')
    .populate('items.vendor', 'storeName storeDescription logo');

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  res.json({
    success: true,
    order
  });
}));

// Create a new order
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const {
    items,
    shippingAddress,
    paymentMethod,
    shippingMethod,
    orderNotes,
    subtotal,
    shippingCost,
    tax,
    total
  } = req.body;

  // Validate required fields
  if (!items || !shippingAddress || !paymentMethod || !total) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }

  // Validate items and check inventory
  const orderItems = [];
  for (const item of items) {
    const product = await Product.findById(item.productId);
    if (!product) {
      return res.status(400).json({
        success: false,
        message: `Product ${item.productId} not found`
      });
    }

    if (product.inventory.quantity < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient inventory for ${product.title}`
      });
    }

    orderItems.push({
      product: item.productId,
      quantity: item.quantity,
      price: product.price,
      vendor: product.vendor
    });

    // Update inventory
    product.inventory.quantity -= item.quantity;
    await product.save();
  }

  // Generate order number
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const orderCount = await Order.countDocuments({
    createdAt: { $gte: today, $lt: tomorrow }
  });
  
  const sequence = (orderCount + 1).toString().padStart(4, '0');
  const orderNumber = `ORD-${year}${month}${day}-${sequence}`;

  // Create order
  const order = new Order({
    orderNumber,
    customer: req.user.id,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    shippingMethod,
    orderNotes,
    subtotal,
    shippingCost,
    tax,
    total,
    paymentStatus: req.body.paymentStatus || 'pending',
    isPaid: req.body.paymentStatus === 'completed'
  });

  await order.save();

  // Populate order details for response
  await order.populate('items.product', 'title images price');
  await order.populate('items.vendor', 'storeName');

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    order
  });
}));

// Update order status (for vendors)
router.patch('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!['pending', 'processing', 'shipped', 'delivered', 'cancelled'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status'
    });
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Check if user is vendor for any item in the order
  const isVendor = order.items.some(item => 
    item.vendor.toString() === req.user.id
  );

  if (!isVendor && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to update this order'
    });
  }

  order.status = status;
  await order.save();

  res.json({
    success: true,
    message: 'Order status updated successfully',
    order
  });
}));

// Add tracking information (for vendors)
router.patch('/:id/tracking', requireAuth, asyncHandler(async (req, res) => {
  const { trackingNumber, trackingUrl } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Check if user is vendor for any item in the order
  const isVendor = order.items.some(item => 
    item.vendor.toString() === req.user.id
  );

  if (!isVendor && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to update this order'
    });
  }

  order.trackingNumber = trackingNumber;
  order.trackingUrl = trackingUrl;
  order.status = 'shipped';
  await order.save();

  res.json({
    success: true,
    message: 'Tracking information updated successfully',
    order
  });
}));

// Get vendor orders
router.get('/vendor/orders', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const skip = (page - 1) * limit;

  // Find vendor ID for the current user
  const Vendor = mongoose.model('Vendor');
  const vendor = await Vendor.findOne({ user: req.user.id });
  
  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor profile not found'
    });
  }

  const query = { 'items.vendor': vendor._id };
  if (status) {
    query.status = status;
  }

  const orders = await Order.find(query)
    .populate('customer', 'name email')
    .populate('items.product', 'title images price')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Order.countDocuments(query);

  res.json({
    success: true,
    orders,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      totalOrders: total
    }
  });
}));

// Cancel order (customer only)
router.patch('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    customer: req.user.id
  });

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  if (order.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: 'Order cannot be cancelled at this stage'
    });
  }

  order.status = 'cancelled';
  await order.save();

  // Restore inventory
  for (const item of order.items) {
    const product = await Product.findById(item.product);
    if (product) {
      product.inventory.quantity += item.quantity;
      await product.save();
    }
  }

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order
  });
}));

export default router;
