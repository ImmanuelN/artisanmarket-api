import express from 'express'
import Vendor from '../models/Vendor.js'
import User from '../models/User.js'
import DeliveryProof from '../models/DeliveryProof.js'
import jwt from 'jsonwebtoken'

const router = express.Router()

// Simple JWT auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }
  const token = authHeader.replace('Bearer ', '')
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret')
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' })
  }
}

// GET /profile - get vendor profile for current user
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId
    const vendor = await Vendor.findOne({ user: userId })
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' })
    }
    res.json({ success: true, profile: vendor })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// PUT /profile - update or create vendor profile for current user
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId
    let vendor = await Vendor.findOne({ user: userId })
    if (!vendor) {
      // Create new vendor profile
      const user = await User.findById(userId)
      if (!user) return res.status(404).json({ success: false, message: 'User not found' })
      vendor = new Vendor({ user: userId, contact: { email: user.email }, ...req.body })
    } else {
      // Update only the fields provided in req.body
      if (req.body.storeName !== undefined) vendor.storeName = req.body.storeName;
      if (req.body.slogan !== undefined) vendor.slogan = req.body.slogan;
      if (req.body.storeDescription !== undefined) vendor.storeDescription = req.body.storeDescription;
      if (req.body.logo !== undefined) vendor.logo = req.body.logo;
      if (req.body.banner !== undefined) vendor.banner = req.body.banner;
      if (req.body.contact) {
        if (req.body.contact.email !== undefined) vendor.contact.email = req.body.contact.email;
        if (req.body.contact.phone !== undefined) vendor.contact.phone = req.body.contact.phone;
        if (req.body.contact.website !== undefined) vendor.contact.website = req.body.contact.website;
      }
      if (req.body.business && req.body.business.address && req.body.business.address.city !== undefined) {
        vendor.business = vendor.business || {};
        vendor.business.address = vendor.business.address || {};
        vendor.business.address.city = req.body.business.address.city;
      }
      // Handle nested contact updates
      if (req.body.phone !== undefined) {
        vendor.contact = vendor.contact || {};
        vendor.contact.phone = req.body.phone;
      }
      if (req.body.website !== undefined) {
        vendor.contact = vendor.contact || {};
        vendor.contact.website = req.body.website;
      }
      if (req.body.location !== undefined) {
        vendor.business = vendor.business || {};
        vendor.business.address = vendor.business.address || {};
        vendor.business.address.city = req.body.location;
      }
      if (req.body.bio !== undefined) vendor.bio = req.body.bio;
    }
    
    await vendor.save()
    
    // Check if this is the first time saving a complete profile (onboarding)
    const user = await User.findById(userId)
    if (user && !user.onboardingComplete && vendor.storeName && vendor.storeName.trim() !== '' && vendor.storeDescription) {
      user.onboardingComplete = true
      await user.save()
    }
    
    res.json({ success: true, profile: vendor })
  } catch (err) {
    console.error('Profile update error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// POST /complete-onboarding - mark onboarding as complete
router.post('/complete-onboarding', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId
    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    // Check if vendor profile exists and has required fields
    const vendor = await Vendor.findOne({ user: userId })
    if (!vendor || !vendor.storeName || vendor.storeName.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Please complete your store profile with a store name before finishing onboarding' 
      })
    }
    
    user.onboardingComplete = true
    await user.save()
    
    res.json({ 
      success: true, 
      message: 'Onboarding completed successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingComplete: user.onboardingComplete
      }
    })
  } catch (err) {
    console.error('Complete onboarding error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /stats - get stats for current vendor
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const vendor = await Vendor.findOne({ user: userId });
    if (!vendor) {
      return res.json({ 
        success: true, 
        stats: {
          totalRevenue: 0,
          totalOrders: 0,
          activeProducts: 0,
          pendingOrders: 0
        } 
      });
    }

    // Import models needed for stats
    const Product = (await import('../models/Product.js')).default;
    const Order = (await import('../models/Order.js')).default;

    // Get active products count
    const activeProducts = await Product.countDocuments({ 
      vendor: vendor._id, 
      status: 'active' 
    });

    // Get total orders for this vendor
    const totalOrders = await Order.countDocuments({
      'items.vendor': vendor._id
    });

    // Get pending orders count
    const pendingOrders = await Order.countDocuments({
      'items.vendor': vendor._id,
      status: { $in: ['pending', 'processing', 'confirmed'] }
    });

    // Calculate total revenue from completed orders
    const completedOrders = await Order.find({
      'items.vendor': vendor._id,
      status: { $in: ['delivered', 'completed'] }
    });

    let totalRevenue = 0;
    completedOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.vendor && item.vendor.toString() === vendor._id.toString()) {
          totalRevenue += (item.price * item.quantity);
        }
      });
    });

    const stats = {
      totalRevenue,
      totalOrders,
      activeProducts,
      pendingOrders
    };

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Vendor stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /orders - get orders for current vendor
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const vendor = await Vendor.findOne({ user: userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const Order = (await import('../models/Order.js')).default;
    
    const { status, page = 1, limit = 10 } = req.query;
    let query = { 'items.vendor': vendor._id };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalOrders = await Order.countDocuments(query);
    
    const orders = await Order.find(query)
      .populate('customer', 'name email')
      .populate('items.product', 'title images price')
      .populate('deliveryProof')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({ 
      success: true, 
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / parseInt(limit)),
        totalOrders,
        hasNextPage: skip + orders.length < totalOrders,
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (err) {
    console.error('Vendor orders error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /orders/:orderId/delivery-proof - upload arrival proof (keeps order as pending)
router.post('/orders/:orderId/delivery-proof', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const vendor = await Vendor.findOne({ user: userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const { orderId } = req.params;
    const { imageUrl, imageId, deliveryNotes, deliveryLocation, metadata } = req.body;

    if (!imageUrl || !imageId) {
      return res.status(400).json({ success: false, message: 'Image URL and ID are required' });
    }

    const Order = (await import('../models/Order.js')).default;
    const DeliveryProof = (await import('../models/DeliveryProof.js')).default;

    // Verify order belongs to vendor and is in pending status
    const order = await Order.findOne({ 
      _id: orderId, 
      'items.vendor': vendor._id,
      status: 'pending' // Only allow for pending orders
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found, not associated with this vendor, or not in pending status' 
      });
    }

    // Check if delivery proof already exists
    let existingProof = await DeliveryProof.findOne({ order: orderId });
    
    if (existingProof) {
      // Check if within 15-minute window for re-upload
      const uploadTime = new Date(existingProof.uploadedAt);
      const now = new Date();
      const timeDiff = (now.getTime() - uploadTime.getTime()) / (1000 * 60); // minutes
      
      if (timeDiff > 15) {
        return res.status(400).json({ 
          success: false, 
          message: 'Re-upload window has expired. You can only re-upload within 15 minutes of the original upload.' 
        });
      }
      
      // Update existing proof
      existingProof.imageUrl = imageUrl;
      existingProof.imageId = imageId;
      existingProof.deliveryNotes = deliveryNotes;
      existingProof.deliveryLocation = deliveryLocation;
      existingProof.metadata = metadata;
      existingProof.uploadedAt = new Date();
      await existingProof.save();
      
      res.json({ 
        success: true, 
        message: 'Arrival proof updated successfully',
        deliveryProof: existingProof
      });
    } else {
      // Create new delivery proof
      const deliveryProof = new DeliveryProof({
        order: orderId,
        vendor: vendor._id,
        imageUrl,
        imageId,
        deliveryNotes,
        deliveryLocation,
        metadata
      });

      await deliveryProof.save();

      // Update order with delivery proof (keep status as pending)
      order.deliveryProof = deliveryProof._id;
      // Status remains 'pending' - no automatic change to processing
      
      // Ensure escrowAmount is set if missing (for backward compatibility)
      if (!order.escrowAmount) {
        order.escrowAmount = order.total;
      }
      
      await order.save();

      res.json({ 
        success: true, 
        message: 'Arrival proof uploaded successfully! Order moved to processing.',
        deliveryProof
      });
    }
  } catch (err) {
    console.error('Upload arrival proof error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /delivery-proofs - get delivery proofs for current vendor
router.get('/delivery-proofs', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const vendor = await Vendor.findOne({ user: userId });
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const DeliveryProof = (await import('../models/DeliveryProof.js')).default;
    
    const deliveryProofs = await DeliveryProof.findByVendor(vendor._id);

    res.json({ success: true, deliveryProofs });
  } catch (err) {
    console.error('Get delivery proofs error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Public GET /public/:vendorId - get vendor profile by vendor ID
router.get('/public/:vendorId', async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.vendorId)
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' })
    }
    res.json({ success: true, profile: vendor })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
