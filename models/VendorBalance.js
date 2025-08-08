import mongoose from 'mongoose';

const vendorBalanceSchema = new mongoose.Schema({
  vendor: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Vendor', 
    required: true, 
    unique: true 
  },
  bankAccount: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'BankAccount', 
    required: true 
  },
  totalEarnings: { 
    type: Number, 
    default: 0,
    min: 0
  },
  availableBalance: { 
    type: Number, 
    default: 0,
    min: 0
  },
  pendingBalance: { 
    type: Number, 
    default: 0,
    min: 0
  },
  totalPayouts: {
    type: Number,
    default: 0,
    min: 0
  },
  lastPayout: {
    type: Date,
    default: null
  },
  lastPayoutAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  minimumPayoutAmount: {
    type: Number,
    default: 10.00,
    min: 0
  },
  commissionRate: {
    type: Number,
    default: 0.15,
    min: 0,
    max: 1
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Indexes for better performance
vendorBalanceSchema.index({ vendor: 1 });
vendorBalanceSchema.index({ bankAccount: 1 });
vendorBalanceSchema.index({ isActive: 1 });

// Virtual for total balance
vendorBalanceSchema.virtual('totalBalance').get(function() {
  return this.availableBalance + this.pendingBalance;
});

// Virtual for formatted amounts
vendorBalanceSchema.virtual('formattedTotalEarnings').get(function() {
  return `$${this.totalEarnings.toFixed(2)}`;
});

vendorBalanceSchema.virtual('formattedAvailableBalance').get(function() {
  return `$${this.availableBalance.toFixed(2)}`;
});

vendorBalanceSchema.virtual('formattedPendingBalance').get(function() {
  return `$${this.pendingBalance.toFixed(2)}`;
});

// Ensure virtual fields are serialized
vendorBalanceSchema.set('toJSON', { virtuals: true });
vendorBalanceSchema.set('toObject', { virtuals: true });

// Instance methods
vendorBalanceSchema.methods.addEarnings = function(amount) {
  this.totalEarnings += amount;
  this.availableBalance += amount;
  this.updatedAt = new Date();
  return this.save();
};

vendorBalanceSchema.methods.processPayout = function(amount) {
  if (amount > this.availableBalance) {
    throw new Error('Insufficient balance for payout');
  }
  
  this.availableBalance -= amount;
  this.totalPayouts += amount;
  this.lastPayout = new Date();
  this.lastPayoutAmount = amount;
  this.updatedAt = new Date();
  return this.save();
};

vendorBalanceSchema.methods.moveToPending = function(amount) {
  if (amount > this.availableBalance) {
    throw new Error('Insufficient balance to move to pending');
  }
  
  this.availableBalance -= amount;
  this.pendingBalance += amount;
  this.updatedAt = new Date();
  return this.save();
};

vendorBalanceSchema.methods.releasePending = function(amount) {
  if (amount > this.pendingBalance) {
    throw new Error('Insufficient pending balance to release');
  }
  
  this.pendingBalance -= amount;
  this.availableBalance += amount;
  this.updatedAt = new Date();
  return this.save();
};

const VendorBalance = mongoose.model('VendorBalance', vendorBalanceSchema);

export default VendorBalance; 