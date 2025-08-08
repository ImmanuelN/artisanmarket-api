import mongoose from 'mongoose'

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Product title is required'],
    trim: true,
    maxlength: [100, 'Product title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  comparePrice: {
    type: Number,
    min: [0, 'Compare price cannot be negative']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']
  },
  categories: {
    type: [String],
    required: [true, 'Product category is required'],
    enum: [
      'ceramics',
      'textiles',
      'jewelry',
      'leather-goods',
      'woodwork',
      'metalwork',
      'glass',
      'paintings',
      'sculptures',
      'home-decor',
      'accessories',
      'toys',
      'other'
    ]
  },
  subcategory: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  inventory: {
    quantity: {
      type: Number,
      min: [0, 'Inventory cannot be negative']
    },
    lowStockAlert: {
      type: Number,
      default: 5
    },
    trackQuantity: {
      type: Boolean,
      default: true
    }
  },
  variants: [{
    name: {
      type: String,
      required: true
    },
    value: {
      type: String,
      required: true
    },
    price: Number,
    inventory: Number
  }],
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
    weight: Number,
    unit: {
      type: String,
      enum: ['cm', 'inches', 'kg', 'lbs'],
      default: 'cm'
    }
  },
  materials: [{
    type: String,
    trim: true
  }],
  techniques: [{
    type: String,
    trim: true
  }],
  customization: {
    available: {
      type: Boolean,
      default: false
    },
    options: [{
      name: String,
      description: String,
      additionalPrice: Number
    }]
  },
  shipping: {
    freeShipping: {
      type: Boolean,
      default: false
    },
    shippingCost: {
      type: Number,
      default: 0
    },
    processingTime: {
      type: Number,
      default: 1
    },
    shippingWeight: Number
  },
  seo: {
    metaTitle: String,
    metaDescription: String,
    slug: {
      type: String,
      unique: true
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'rejected', 'out-of-stock'],
    default: 'pending'
  },
  featured: {
    type: Boolean,
    default: false
  },
  ratings: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  },
  reviews: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  }],
  sales: {
    totalSold: {
      type: Number,
      default: 0
    },
    totalRevenue: {
      type: Number,
      default: 0
    }
  },
  views: {
    type: Number,
    default: 0
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

// Indexes for better performance
productSchema.index({ vendor: 1 })
productSchema.index({ categories: 1 })
productSchema.index({ status: 1 })
productSchema.index({ featured: 1 })
productSchema.index({ 'ratings.average': -1 })
productSchema.index({ price: 1 })
productSchema.index({ createdAt: -1 })
// Text search index for product content
productSchema.index({ title: 'text', description: 'text', tags: 'text' })

// Individual indexes for regex searches
productSchema.index({ title: 1 })
productSchema.index({ description: 1 })
productSchema.index({ tags: 1 })
productSchema.index({ vendor: 1 }) // Index for vendor reference

// Generate slug before saving
productSchema.pre('save', function(next) {
  if (this.isModified('title') && !this.seo.slug) {
    this.seo.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim('-')
  }
  next()
})

// Virtual for primary image
productSchema.virtual('primaryImage').get(function() {
  const primary = this.images.find(img => img.isPrimary)
  return primary ? primary.url : (this.images[0]?.url || null)
})

// Update ratings when reviews change
productSchema.methods.updateRatings = async function() {
  const Review = mongoose.model('Review')
  const reviews = await Review.find({ product: this._id })
  
  if (reviews.length > 0) {
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0)
    this.ratings.average = totalRating / reviews.length
    this.ratings.count = reviews.length
  } else {
    this.ratings.average = 0
    this.ratings.count = 0
  }
  
  await this.save()
}

const Product = mongoose.model('Product', productSchema)

export default Product
