import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /delivery-proof/order/:orderId - get delivery proof by order ID
router.get('/order/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id; // Use _id instead of userId
    const userRole = req.user.role;

    console.log('Delivery proof request:', { orderId, userId, userRole });

    // Import models dynamically
    const DeliveryProof = (await import('../models/DeliveryProof.js')).default;
    const Order = (await import('../models/Order.js')).default;
    const Vendor = (await import('../models/Vendor.js')).default;

    // First verify that the user has access to this order
    const order = await Order.findById(orderId).populate('customer', '_id');
    if (!order) {
      console.log('Order not found:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log('Order found:', { 
      orderId: order._id, 
      customerId: order.customer?._id || order.customer,
      userId 
    });

    // Check if the user has access to this order
    let hasAccess = false;
    
    // Check if user is the customer
    const orderCustomerId = order.customer?._id || order.customer;
    if (orderCustomerId.toString() === userId.toString()) {
      hasAccess = true;
      console.log('Access granted - user is the customer');
    }
    
    // Check if user is a vendor for items in this order
    if (!hasAccess && userRole === 'vendor') {
      const vendor = await Vendor.findOne({ user: userId });
      if (vendor) {
        // Check if any items in the order belong to this vendor
        const vendorItems = order.items?.filter(item => 
          item.vendor && item.vendor.toString() === vendor._id.toString()
        );
        if (vendorItems && vendorItems.length > 0) {
          hasAccess = true;
          console.log('Access granted - user is a vendor for items in this order');
        }
      }
    }

    if (!hasAccess) {
      console.log('Access denied - user has no relationship to this order');
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Find delivery proof for this order (the field is 'order', not 'orderId')
    const deliveryProof = await DeliveryProof.findOne({ order: orderId });

    console.log('Delivery proof search:', { 
      searchOrderId: orderId, 
      found: deliveryProof ? 'Yes' : 'No',
      deliveryProofOrderId: deliveryProof?.order 
    });

    if (!deliveryProof) {
      return res.json({ success: true, deliveryProof: null });
    }

    res.json({ success: true, deliveryProof });
  } catch (err) {
    console.error('Get delivery proof error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
