import mongoose from 'mongoose';

const customerBalanceSchema = new mongoose.Schema({
  customer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  spendingBalance: {
    type: Number,
    default: 1000000, // 1 million starting balance
    min: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  lastTransaction: {
    type: Date,
    default: Date.now
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
customerBalanceSchema.index({ customer: 1 });
customerBalanceSchema.index({ isActive: 1 });

// Method to deduct from balance
customerBalanceSchema.methods.deductAmount = function(amount) {
  if (this.spendingBalance >= amount) {
    this.spendingBalance -= amount;
    this.totalSpent += amount;
    this.lastTransaction = new Date();
    return true;
  }
  return false;
};

// Method to add to balance
customerBalanceSchema.methods.addAmount = function(amount) {
  this.spendingBalance += amount;
  this.lastTransaction = new Date();
};

// Virtual for formatted balance
customerBalanceSchema.virtual('formattedBalance').get(function() {
  return this.spendingBalance.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });
});

// Ensure virtual fields are serialized
customerBalanceSchema.set('toJSON', { virtuals: true });
customerBalanceSchema.set('toObject', { virtuals: true });

const CustomerBalance = mongoose.model('CustomerBalance', customerBalanceSchema);

export default CustomerBalance; 