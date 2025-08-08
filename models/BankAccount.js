import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  type: { 
    type: String, 
    enum: ['customer', 'vendor'], 
    required: true 
  },
  cardHolderName: {
    type: String,
    required: true,
    trim: true
  },
  cardNumber: {
    type: String,
    required: true
    // Will be encrypted before saving
  },
  expiryMonth: {
    type: String,
    required: true
    // Will be encrypted before saving
  },
  expiryYear: {
    type: String,
    required: true
    // Will be encrypted before saving
  },
  cvv: {
    type: String,
    required: true
    // Will be encrypted before saving
  },
  bankName: {
    type: String,
    required: true,
    trim: true
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
bankAccountSchema.index({ user: 1 });
bankAccountSchema.index({ type: 1 });
bankAccountSchema.index({ isActive: 1 });

// Virtual for masked card number
bankAccountSchema.virtual('maskedCardNumber').get(function() {
  if (this.cardNumber) {
    return '**** **** **** ' + this.cardNumber.slice(-4);
  }
  return null;
});

// Ensure virtual fields are serialized
bankAccountSchema.set('toJSON', { virtuals: true });
bankAccountSchema.set('toObject', { virtuals: true });

const BankAccount = mongoose.model('BankAccount', bankAccountSchema);

export default BankAccount; 