import mongoose from 'mongoose'

const vendorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  storeName: {
    type: String,
    trim: true,
    maxlength: [100, 'Store name cannot exceed 100 characters'],
    default: ''
  },
  slogan: {
    type: String,
    trim: true,
    maxlength: [200, 'Slogan cannot exceed 200 characters'],
    default: ''
  },
  storeDescription: {
    type: String,
    maxlength: [1000, 'Store description cannot exceed 1000 characters']
  },
  logo: {
    type: String,
    default: null
  },
  banner: {
    type: String,
    default: null
  },
  contact: {
    email: {
      type: String,
      required: true
    },
    phone: String,
    website: String,
    socialMedia: {
      facebook: String,
      instagram: String,
      twitter: String,
      pinterest: String
    }
  },
  business: {
    type: {
      type: String,
      enum: ['individual', 'business', 'company'],
      default: 'individual'
    },
    registrationNumber: String,
    taxId: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    }
  },
  specialties: [{
    type: String,
    trim: true
  }],
  story: {
    type: String,
    maxlength: [2000, 'Story cannot exceed 2000 characters']
  },
  craftsmanship: {
    yearsOfExperience: Number,
    techniques: [String],
    materials: [String],
    awards: [String]
  },
  shipping: {
    domesticShipping: {
      available: {
        type: Boolean,
        default: true
      },
      cost: {
        type: Number,
        default: 0
      },
      freeShippingThreshold: Number,
      processingTime: {
        type: Number,
        default: 1
      }
    },
    internationalShipping: {
      available: {
        type: Boolean,
        default: false
      },
      cost: {
        type: Number,
        default: 0
      },
      countries: [String],
      processingTime: {
        type: Number,
        default: 3
      }
    }
  },
  policies: {
    returnPolicy: {
      type: String,
      maxlength: [1000, 'Return policy cannot exceed 1000 characters']
    },
    exchanges: {
      type: Boolean,
      default: false
    },
    customOrders: {
      type: Boolean,
      default: false
    }
  },
  verification: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending'
    },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectionReason: String,
    documents: [{
      type: String,
      description: String,
      uploadedAt: Date
    }]
  },
  financials: {
    balance: {
      type: Number,
      default: 0
    },
    pendingBalance: {
      type: Number,
      default: 0
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    commissionRate: {
      type: Number,
      default: 0.15,
      min: 0,
      max: 1
    },
    payoutMethod: {
      type: String,
      enum: ['bank_transfer', 'paypal', 'stripe'],
      default: 'stripe'
    },
    payoutDetails: {
      bankAccount: {
        accountNumber: String,
        routingNumber: String,
        accountHolderName: String,
        bankName: String,
        accountType: String
      },
      paypal: {
        email: String
      },
      stripe: {
        accountId: String
      },
      plaid: {
        accessToken: String,
        itemId: String,
        accountId: String,
        lastSync: Date
      }
    }
  },
  metrics: {
    totalProducts: {
      type: Number,
      default: 0
    },
    totalSales: {
      type: Number,
      default: 0
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalReviews: {
      type: Number,
      default: 0
    },
    responseTime: {
      type: Number,
      default: 24
    },
    fulfillmentRate: {
      type: Number,
      default: 100
    }
  },
  settings: {
    vacationMode: {
      enabled: {
        type: Boolean,
        default: false
      },
      message: String,
      startDate: Date,
      endDate: Date
    },
    autoReply: {
      enabled: {
        type: Boolean,
        default: false
      },
      message: String
    },
    notifications: {
      newOrder: {
        type: Boolean,
        default: true
      },
      newMessage: {
        type: Boolean,
        default: true
      },
      newReview: {
        type: Boolean,
        default: true
      },
      lowStock: {
        type: Boolean,
        default: true
      }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActive: Date
}, {
  timestamps: true,
  collection: 'store_profiles'
})

// Indexes for better performance
vendorSchema.index({ user: 1 })
vendorSchema.index({ 'verification.status': 1 })
vendorSchema.index({ 'metrics.averageRating': -1 })
vendorSchema.index({ isActive: 1 })
vendorSchema.index({ storeName: 'text', storeDescription: 'text' })

// Pre-save middleware to ensure payoutDetails is initialized
vendorSchema.pre('save', function(next) {
  if (!this.payoutDetails) {
    this.payoutDetails = {};
  }
  next();
})

// Update metrics when vendor data changes
vendorSchema.methods.updateMetrics = async function() {
  const Product = mongoose.model('Product')
  const Order = mongoose.model('Order')
  const Review = mongoose.model('Review')

  // Count products
  this.metrics.totalProducts = await Product.countDocuments({ 
    vendor: this._id, 
    isDeleted: false 
  })

  // Count orders and calculate sales
  const orders = await Order.find({ 
    'items.vendor': this._id,
    status: { $in: ['completed', 'delivered'] }
  })
  
  this.metrics.totalOrders = orders.length
  this.metrics.totalSales = orders.reduce((sum, order) => {
    return sum + order.items
      .filter(item => item.vendor.toString() === this._id.toString())
      .reduce((itemSum, item) => itemSum + (item.price * item.quantity), 0)
  }, 0)

  // Calculate average rating
  const reviews = await Review.find({ vendor: this._id })
  if (reviews.length > 0) {
    this.metrics.averageRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    this.metrics.totalReviews = reviews.length
  }

  await this.save()
}

const Vendor = mongoose.model('Vendor', vendorSchema)

export default Vendor
