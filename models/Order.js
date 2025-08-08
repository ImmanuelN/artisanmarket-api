import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  }
});

const shippingAddressSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  zipCode: {
    type: String,
    required: true,
    trim: true
  },
  country: {
    type: String,
    required: true,
    trim: true
  }
});

const paymentMethodSchema = new mongoose.Schema({
  cardNumber: {
    type: String,
    required: true
  },
  cardholderName: {
    type: String,
    required: true,
    trim: true
  },
  expiryMonth: {
    type: String,
    required: true
  },
  expiryYear: {
    type: String,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  shippingAddress: {
    type: shippingAddressSchema,
    required: true
  },
  paymentMethod: {
    type: paymentMethodSchema,
    required: true
  },
  shippingMethod: {
    type: String,
    enum: ['free', 'standard', 'express'],
    default: 'standard'
  },
  orderNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  escrowStatus: {
    type: String,
    enum: ['held', 'released', 'refunded'],
    default: 'held'
  },
  escrowAmount: {
    type: Number,
    required: true,
    min: 0
  },
  escrowReleaseDate: {
    type: Date
  },
  deliveryProof: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryProof'
  },
  canChangeStatus: {
    type: Boolean,
    default: false // Only admins can change status, vendors can only mark as delivered with proof
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  shippingCost: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: Number,
    required: true,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  estimatedDelivery: {
    type: Date
  },
  trackingNumber: {
    type: String,
    trim: true
  },
  trackingUrl: {
    type: String,
    trim: true
  },
  isPaid: {
    type: Boolean,
    default: false
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentTransactionId: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Generate order number before saving
orderSchema.pre('save', async function(next) {
  if (this.isNew && !this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    // Get count of orders for today
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const orderCount = await this.constructor.countDocuments({
      createdAt: { $gte: today, $lt: tomorrow }
    });
    
    const sequence = (orderCount + 1).toString().padStart(4, '0');
    this.orderNumber = `ORD-${year}${month}${day}-${sequence}`;
  }
  next();
});

// Calculate estimated delivery date and escrow amount
orderSchema.pre('save', function(next) {
  if (this.isNew && !this.estimatedDelivery) {
    const deliveryDays = {
      'free': 10,
      'standard': 5,
      'express': 2
    };
    
    const estimatedDate = new Date();
    estimatedDate.setDate(estimatedDate.getDate() + deliveryDays[this.shippingMethod]);
    this.estimatedDelivery = estimatedDate;
  }
  
  // Set escrow amount to total if new order
  if (this.isNew && !this.escrowAmount) {
    this.escrowAmount = this.total;
  }
  
  next();
});

// Post-save hook to add to vendor pending balance for new orders
orderSchema.post('save', async function(doc) {
  if (this.isNew && doc.escrowStatus === 'held' && doc.paymentStatus === 'completed') {
    try {
      await doc.addToVendorPending();
    } catch (error) {
      console.error('Error adding to vendor pending balance:', error);
    }
  }
});
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'items.vendor': 1 });
orderSchema.index({ createdAt: -1 });

// Virtual for order summary
orderSchema.virtual('itemCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Instance methods
orderSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  return this.save();
};

orderSchema.methods.addTracking = function(trackingNumber, trackingUrl) {
  this.trackingNumber = trackingNumber;
  this.trackingUrl = trackingUrl;
  this.status = 'shipped';
  return this.save();
};

orderSchema.methods.releaseEscrow = async function() {
  if (this.escrowStatus !== 'held') {
    throw new Error('Escrow funds are not held');
  }
  
  this.escrowStatus = 'released';
  this.escrowReleaseDate = new Date();
  
  // Process vendor balance updates
  const VendorBalance = mongoose.model('VendorBalance');
  
  // Group items by vendor and calculate amounts
  const vendorAmounts = {};
  this.items.forEach(item => {
    const vendorId = item.vendor.toString();
    const itemTotal = item.price * item.quantity;
    
    if (!vendorAmounts[vendorId]) {
      vendorAmounts[vendorId] = 0;
    }
    vendorAmounts[vendorId] += itemTotal;
  });
  
  // Update vendor balances
  for (const [vendorId, amount] of Object.entries(vendorAmounts)) {
    let vendorBalance = await VendorBalance.findOne({ vendor: vendorId });
    if (vendorBalance) {
      // Move from pending to available
      vendorBalance.pendingBalance = Math.max(0, vendorBalance.pendingBalance - amount);
      vendorBalance.availableBalance += amount;
      vendorBalance.totalEarnings += amount;
      await vendorBalance.save();
    }
  }
  
  return this.save();
};

orderSchema.methods.addToVendorPending = async function() {
  if (this.escrowStatus !== 'held') {
    return; // Only process held escrow
  }
  
  const VendorBalance = mongoose.model('VendorBalance');
  
  // Group items by vendor and calculate amounts
  const vendorAmounts = {};
  this.items.forEach(item => {
    const vendorId = item.vendor.toString();
    const itemTotal = item.price * item.quantity;
    
    if (!vendorAmounts[vendorId]) {
      vendorAmounts[vendorId] = 0;
    }
    vendorAmounts[vendorId] += itemTotal;
  });
  
  // Add to vendor pending balances
  for (const [vendorId, amount] of Object.entries(vendorAmounts)) {
    let vendorBalance = await VendorBalance.findOne({ vendor: vendorId });
    if (vendorBalance) {
      vendorBalance.pendingBalance += amount;
      await vendorBalance.save();
    }
  }
};

// Static methods
orderSchema.statics.findByCustomer = function(customerId, limit = 10) {
  return this.find({ customer: customerId })
    .populate('items.product', 'title images price')
    .populate('items.vendor', 'storeName')
    .sort({ createdAt: -1 })
    .limit(limit);
};

orderSchema.statics.findByVendor = function(vendorId, limit = 10) {
  return this.find({ 'items.vendor': vendorId })
    .populate('customer', 'name email')
    .populate('items.product', 'title images price')
    .sort({ createdAt: -1 })
    .limit(limit);
};

export default mongoose.model('Order', orderSchema); 