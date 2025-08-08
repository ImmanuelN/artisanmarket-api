import express from 'express'
import jwt from 'jsonwebtoken'

const router = express.Router()

// Admin auth middleware
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }
  const token = authHeader.replace('Bearer ', '')
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret')
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' })
    }
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' })
  }
}

// Dashboard
router.get('/dashboard', requireAdminAuth, async (req, res) => {
  try {
    const Order = (await import('../models/Order.js')).default
    const DeliveryProof = (await import('../models/DeliveryProof.js')).default
    const Vendor = (await import('../models/Vendor.js')).default
    
    // Get dashboard stats
    const totalOrders = await Order.countDocuments()
    const pendingOrders = await Order.countDocuments({ status: 'pending' })
    const deliveredOrders = await Order.countDocuments({ status: 'delivered' })
    const pendingProofs = await DeliveryProof.countDocuments({ verificationStatus: 'pending' })
    const totalVendors = await Vendor.countDocuments()
    
    const stats = {
      totalOrders,
      pendingOrders,
      deliveredOrders,
      pendingProofs,
      totalVendors
    }
    
    res.json({ success: true, stats })
  } catch (err) {
    console.error('Admin dashboard error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Get all orders with filters
router.get('/orders', requireAdminAuth, async (req, res) => {
  try {
    const Order = (await import('../models/Order.js')).default
    
    const { status, page = 1, limit = 20 } = req.query
    const skip = (page - 1) * limit
    
    let query = {}
    if (status && status !== 'all') {
      query.status = status
    }
    
    const orders = await Order.find(query)
      .populate('customer', 'name email')
      .populate('items.product', 'title images price')
      .populate('items.vendor', 'storeName contact.email')
      .populate('deliveryProof')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
    
    const total = await Order.countDocuments(query)
    
    res.json({ 
      success: true, 
      orders, 
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (err) {
    console.error('Admin orders error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Update order status (admin only)
router.patch('/orders/:orderId/status', requireAdminAuth, async (req, res) => {
  try {
    const Order = (await import('../models/Order.js')).default
    
    const { orderId } = req.params
    const { status, adminNotes } = req.body
    
    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }
    
    const oldStatus = order.status
    order.status = status
    
    // If marking as delivered and escrow is held, release it
    if (status === 'delivered' && order.escrowStatus === 'held') {
      await order.releaseEscrow()
    }
    
    await order.save()
    
    res.json({ 
      success: true, 
      message: `Order status updated from ${oldStatus} to ${status}`,
      order
    })
  } catch (err) {
    console.error('Update order status error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Get arrival proofs for review
router.get('/arrival-proofs', requireAdminAuth, async (req, res) => {
  try {
    const DeliveryProof = (await import('../models/DeliveryProof.js')).default
    
    const { status = 'pending', page = 1, limit = 20 } = req.query
    const skip = (page - 1) * limit
    
    let query = {}
    if (status && status !== 'all') {
      query.verificationStatus = status
    }
    
    const arrivalProofs = await DeliveryProof.find(query)
      .populate('order', 'orderNumber total status customer')
      .populate('vendor', 'storeName contact.email')
      .populate('reviewedBy', 'name email')
      .sort({ uploadedAt: status === 'pending' ? 1 : -1 }) // FIFO for pending, newest first for others
      .skip(skip)
      .limit(parseInt(limit))
    
    const total = await DeliveryProof.countDocuments(query)
    
    res.json({ 
      success: true, 
      arrivalProofs, 
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (err) {
    console.error('Admin arrival proofs error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Review arrival proof
router.patch('/arrival-proofs/:proofId/review', requireAdminAuth, async (req, res) => {
  try {
    const DeliveryProof = (await import('../models/DeliveryProof.js')).default
    const Order = (await import('../models/Order.js')).default
    
    const { proofId } = req.params
    const { action, adminNotes } = req.body // action: 'approve', 'reject', 'requires_review'
    
    const arrivalProof = await DeliveryProof.findById(proofId).populate('order')
    if (!arrivalProof) {
      return res.status(404).json({ success: false, message: 'Arrival proof not found' })
    }
    
    const adminId = req.user.userId
    
    switch (action) {
      case 'approve':
        await arrivalProof.approve(adminId, adminNotes)
        // Move order to next stage if approved
        if (arrivalProof.order.status === 'processing') {
          arrivalProof.order.status = 'shipped' // Move to shipped after approval
          await arrivalProof.order.save()
        }
        break
      case 'reject':
        await arrivalProof.reject(adminId, adminNotes)
        // Revert order status back to pending
        if (arrivalProof.order.status === 'processing') {
          arrivalProof.order.status = 'pending'
          await arrivalProof.order.save()
        }
        break
      case 'requires_review':
        await arrivalProof.requiresReview(adminId, adminNotes)
        break
      default:
        return res.status(400).json({ success: false, message: 'Invalid action' })
    }
    
    res.json({ 
      success: true, 
      message: `Arrival proof ${action}d successfully`,
      arrivalProof
    })
  } catch (err) {
    console.error('Review arrival proof error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// Release escrow manually (admin override)
router.post('/orders/:orderId/release-escrow', requireAdminAuth, async (req, res) => {
  try {
    const Order = (await import('../models/Order.js')).default
    
    const { orderId } = req.params
    const { reason } = req.body
    
    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }
    
    if (order.escrowStatus !== 'held') {
      return res.status(400).json({ success: false, message: 'Escrow is not held for this order' })
    }
    
    await order.releaseEscrow()
    
    res.json({ 
      success: true, 
      message: 'Escrow released successfully',
      reason,
      order
    })
  } catch (err) {
    console.error('Release escrow error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

router.get('/vendors', requireAdminAuth, async (req, res) => {
  try {
    const Vendor = (await import('../models/Vendor.js')).default
    
    const vendors = await Vendor.find()
      .populate('user', 'name email createdAt')
      .sort({ createdAt: -1 })
    
    res.json({ success: true, vendors })
  } catch (err) {
    console.error('Admin vendors error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
