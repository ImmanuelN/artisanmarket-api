import mongoose from 'mongoose';

const arrivalProofSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true // Each order can only have one arrival proof
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  imageUrl: {
    type: String,
    required: true,
    trim: true
  },
  imageId: {
    type: String,
    required: true, // ImageKit file ID for management
    trim: true
  },
  uploadedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  arrivalNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  processingLocation: {
    section: {
      type: String,
      trim: true
    },
    bay: {
      type: String,
      trim: true
    },
    warehouse: {
      type: String,
      trim: true
    }
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'requires_review'],
    default: 'pending'
  },
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Admin who reviewed the proof
  },
  reviewedAt: {
    type: Date
  },
  canReupload: {
    type: Boolean,
    default: true
  },
  reuploadExpiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    }
  },
  metadata: {
    fileSize: Number,
    mimeType: String,
    dimensions: {
      width: Number,
      height: Number
    }
  }
}, {
  timestamps: true
});

// Indexes for better performance
arrivalProofSchema.index({ order: 1 });
arrivalProofSchema.index({ vendor: 1, uploadedAt: -1 });
arrivalProofSchema.index({ verificationStatus: 1 });
arrivalProofSchema.index({ uploadedAt: -1 });
arrivalProofSchema.index({ reuploadExpiresAt: 1 });

// Virtual to check if still within reupload window
arrivalProofSchema.virtual('canStillReupload').get(function() {
  return this.canReupload && new Date() < this.reuploadExpiresAt;
});

// Virtual for formatted upload time
arrivalProofSchema.virtual('formattedUploadTime').get(function() {
  return this.uploadedAt.toLocaleString();
});

// Ensure virtual fields are serialized
arrivalProofSchema.set('toJSON', { virtuals: true });
arrivalProofSchema.set('toObject', { virtuals: true });

// Pre-save middleware to update reupload expiry
arrivalProofSchema.pre('save', function(next) {
  if (this.isModified('uploadedAt')) {
    this.reuploadExpiresAt = new Date(this.uploadedAt.getTime() + 15 * 60 * 1000);
  }
  next();
});

// Instance methods
arrivalProofSchema.methods.approve = function(adminId, notes = '') {
  this.verificationStatus = 'approved';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.canReupload = false; // No more reuploads once approved
  if (notes) this.adminNotes = notes;
  return this.save();
};

arrivalProofSchema.methods.reject = function(adminId, notes = '') {
  this.verificationStatus = 'rejected';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminNotes = notes;
  // Keep reupload capability for rejected proofs
  return this.save();
};

arrivalProofSchema.methods.requiresReview = function(adminId, notes = '') {
  this.verificationStatus = 'requires_review';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminNotes = notes;
  return this.save();
};

// Static methods
arrivalProofSchema.statics.findByVendor = function(vendorId, limit = 20) {
  return this.find({ vendor: vendorId })
    .populate('order', 'orderNumber total status customer')
    .sort({ uploadedAt: -1 })
    .limit(limit);
};

arrivalProofSchema.statics.findPendingReview = function(limit = 50) {
  return this.find({ verificationStatus: 'pending' })
    .populate('order', 'orderNumber total status customer')
    .populate('vendor', 'storeName contact.email')
    .sort({ uploadedAt: 1 }) // Oldest first for FIFO processing
    .limit(limit);
};

export default mongoose.model('DeliveryProof', arrivalProofSchema);
