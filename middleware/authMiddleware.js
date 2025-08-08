import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Vendor from '../models/Vendor.js';

export const requireAuth = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  const token = authorization.split(' ')[1];

  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(userId).select('_id role');

    if (!user) {
      return res.status(401).json({ message: 'Request is not authorized' });
    }

    req.user = user;

    // If the user is a vendor, find their vendor ID and attach it
    if (user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: user._id }).select('_id');
      if (vendor) {
        req.user.vendorId = vendor._id;
      }
    }

    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Request is not authorized' });
  }
}; 