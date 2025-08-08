import express from 'express'
import Product from '../models/Product.js'
import { getCache, setCache, deleteCache } from '../config/redis.js'
import { requireAuth } from '../middleware/authMiddleware.js'; // Assuming auth middleware exists
import { io } from '../server.js'; // Import Socket.IO instance
import Vendor from '../models/Vendor.js'; // Added import for Vendor
import mongoose from 'mongoose';

const router = express.Router()

// Get all products with filtering, pagination, and search
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      search,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      featured
    } = req.query

    // Build query
    const query = { status: 'active', isDeleted: false }
    
    if (category) {
      query.categories = category
    }
    
    if (search) {
      // Search in product fields
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    }
    
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = parseFloat(minPrice)
      if (maxPrice) query.price.$lte = parseFloat(maxPrice)
    }
    
    if (featured === 'true') {
      query.featured = true
    }
    // Add vendor filter
    if (req.query.vendor) {
      query.vendor = req.query.vendor;
    }

    // Create cache key
    const cacheKey = `products:${JSON.stringify(query)}:${page}:${limit}:${sortBy}:${sortOrder}`
    
    // Check cache
    const cachedProducts = await getCache(cacheKey)
    if (cachedProducts) {
      return res.json(cachedProducts)
    }

    // Calculate pagination
    const skip = (page - 1) * limit
    const sortOptions = {}
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1

    // Execute query
    let products = await Product.find(query)
      .populate('vendor', 'storeName user')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))

    // If searching, also search in vendor store names
    if (search) {
      // Get vendor IDs that match the search term
      const Vendor = mongoose.model('Vendor')
      const matchingVendors = await Vendor.find({
        storeName: { $regex: search, $options: 'i' }
      }).select('_id')
      
      if (matchingVendors.length > 0) {
        const vendorIds = matchingVendors.map(v => v._id)
        
        // Get products from matching vendors
        const vendorProducts = await Product.find({
          ...query,
          vendor: { $in: vendorIds }
        })
        .populate('vendor', 'storeName user')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        
        // Combine and deduplicate results
        const allProducts = [...products, ...vendorProducts]
        const uniqueProducts = allProducts.filter((product, index, self) => 
          index === self.findIndex(p => p._id.toString() === product._id.toString())
        )
        
        products = uniqueProducts.slice(0, parseInt(limit))
      }
    }

    let totalProducts = await Product.countDocuments(query)
    
    // If searching, also count products from matching vendors
    if (search) {
      const Vendor = mongoose.model('Vendor')
      const matchingVendors = await Vendor.find({
        storeName: { $regex: search, $options: 'i' }
      }).select('_id')
      
      if (matchingVendors.length > 0) {
        const vendorIds = matchingVendors.map(v => v._id)
        const vendorProductCount = await Product.countDocuments({
          ...query,
          vendor: { $in: vendorIds }
        })
        
        // Use the larger count to ensure pagination works correctly
        totalProducts = Math.max(totalProducts, vendorProductCount)
      }
    }
    
    const totalPages = Math.ceil(totalProducts / limit)

    const response = {
      success: true,
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalProducts,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }

    // Cache the response for 5 minutes
    await setCache(cacheKey, response, 300)

    res.json(response)
  } catch (error) {
    console.error('Get products error:', error)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
})

// Enhanced search endpoint that returns both products and stores
router.get('/search/combined', async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 12
    } = req.query

    if (!search || search.trim().length === 0) {
      return res.json({
        success: true,
        products: [],
        stores: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalItems: 0
        }
      })
    }

    const searchTerm = search.trim()
    const skip = (page - 1) * limit

    // Search for products
    const productQuery = {
      status: 'active',
      isDeleted: false,
      $or: [
        { title: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { tags: { $in: [new RegExp(searchTerm, 'i')] } }
      ]
    }

    const products = await Product.find(productQuery)
      .populate('vendor', 'storeName user logo business.address.city business.address.country')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))

    // Search for stores/vendors
    const Vendor = mongoose.model('Vendor')
    const storeQuery = {
      storeName: { $regex: searchTerm, $options: 'i' }
    }

    const stores = await Vendor.find(storeQuery)
      .select('storeName storeDescription logo business.address.city business.address.country specialties')
      .sort({ storeName: 1 })
      .skip(skip)
      .limit(parseInt(limit))

    // Get total counts
    const totalProducts = await Product.countDocuments(productQuery)
    const totalStores = await Vendor.countDocuments(storeQuery)
    const totalItems = totalProducts + totalStores
    const totalPages = Math.ceil(totalItems / limit)

    const response = {
      success: true,
      products,
      stores,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        totalProducts,
        totalStores,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }

    res.json(response)
  } catch (error) {
    console.error('Combined search error:', error)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
})

// Get product by ID
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID.'
      });
    }
    const product = await Product.findById(req.params.id)
      .populate('vendor', 'storeName user storeDescription contact business logo')
      .populate('reviews')

    if (!product || product.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      })
    }

    // Increment view count
    product.views += 1
    await product.save()

    res.json({
      success: true,
      product
    })
  } catch (error) {
    console.error('Get product error:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    })
  }
})

// Get featured products
router.get('/featured/list', async (req, res) => {
  try {
    const cacheKey = 'products:featured'
    const cachedProducts = await getCache(cacheKey)
    
    if (cachedProducts) {
      return res.json(cachedProducts)
    }

    const products = await Product.find({ 
      featured: true, 
      status: 'active',
      isDeleted: false 
    })
      .populate('vendor', 'storeName user')
      .sort({ 'ratings.average': -1 })
      .limit(8)

    const response = {
      success: true,
      products
    }

    // Cache for 10 minutes
    await setCache(cacheKey, response, 600)

    res.json(response)
  } catch (error) {
    console.error('Get featured products error:', error)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
})

// Get categories
router.get('/categories/list', async (req, res) => {
  try {
    const cacheKey = 'categories:list'
    const cachedCategories = await getCache(cacheKey)
    
    if (cachedCategories) {
      return res.json(cachedCategories)
    }

    const categories = await Product.aggregate([
      { $match: { status: 'active', isDeleted: false } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])

    const response = {
      success: true,
      categories
    }

    // Cache for 1 hour
    await setCache(cacheKey, response, 3600)

    res.json(response)
  } catch (error) {
    console.error('Get categories error:', error)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
})

// Helper function to get and emit updated products for a vendor
const emitVendorProducts = async (vendorId) => {
  try {
    const products = await Product.find({ vendor: vendorId });
    io.to(`vendor-${vendorId}`).emit('products-updated', products);
  } catch (error) {
    console.error('Error emitting vendor products:', error);
  }
};

// Helper function to check if user is authorized to modify product
const isAuthorizedToModifyProduct = async (productId, userId) => {
  try {
    const product = await Product.findById(productId);
    if (!product) {
      return false;
    }
    const vendor = await Vendor.findOne({ user: userId });
    if (!vendor) {
      return false;
    }
    return product.vendor.toString() === vendor._id.toString();
  } catch (error) {
    return false;
  }
};

// Create a new product
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, description, price, categories, tags, images, inventory } = req.body;
    const vendorId = req.user.vendorId;

    if (!vendorId) {
      return res.status(403).json({ success: false, message: "User is not a vendor." });
    }

    const newProduct = new Product({
      title,
      description,
      price,
      categories: categories.map(c => c.toLowerCase().replace(/\s+/g, '-')),
      tags,
      images,
      inventory,
      vendor: vendorId,
      status: 'active',
    });

    await newProduct.save();
    
    // Invalidate cache and emit update
    const cacheKey = `products:{"status":"active","isDeleted":false,"vendor":"${vendorId}"}:1:12:createdAt:desc`;
    await deleteCache(cacheKey);
    emitVendorProducts(vendorId);

    res.status(201).json({ success: true, product: newProduct });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update a product's status (activate/deactivate)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be either "active" or "inactive"'
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user is authorized to update this product
    const isAuthorized = await isAuthorizedToModifyProduct(req.params.id, req.user._id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product'
      });
    }

    product.status = status;
    await product.save();

    // Invalidate cache and emit update
    await deleteCache(`products:{"status":"active","isDeleted":false,"vendor":"${product.vendor}"}:1:12:createdAt:desc`);
    emitVendorProducts(product.vendor.toString());

    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Update product status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Soft delete a product
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user is authorized to delete this product
    const isAuthorized = await isAuthorizedToModifyProduct(req.params.id, req.user._id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this product'
      });
    }

    // Soft delete
    product.isDeleted = true;
    product.status = 'inactive';
    await product.save();

    // Invalidate cache and emit update
    await deleteCache(`products:{"status":"active","isDeleted":false,"vendor":"${product.vendor}"}:1:12:createdAt:desc`);
    emitVendorProducts(product.vendor.toString());

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update a product
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user is authorized to update this product
    const isAuthorized = await isAuthorizedToModifyProduct(req.params.id, req.user._id);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product'
      });
    }

    // Update product fields
    const updates = { ...req.body };
    if (updates.categories) {
      updates.categories = updates.categories.map(c => c.toLowerCase().replace(/\s+/g, '-'));
    }

    Object.assign(product, updates);
    await product.save();

    // Invalidate cache and emit update
    await deleteCache(`products:{"status":"active","isDeleted":false,"vendor":"${product.vendor}"}:1:12:createdAt:desc`);
    emitVendorProducts(product.vendor.toString());

    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router
