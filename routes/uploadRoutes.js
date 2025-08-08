import express from 'express';
import ImageKit from 'imagekit';
import dotenv from 'dotenv';
import multer from 'multer';

// Ensure dotenv is configured right at the start
dotenv.config();

const router = express.Router();

// --- More Detailed Debug Logging ---
console.log('--- Checking ImageKit Environment Variables (uploadRoutes.js) ---');
console.log('IMAGEKIT_PUBLIC_KEY:', process.env.IMAGEKIT_PUBLIC_KEY ? 'Loaded' : 'MISSING');
console.log('IMAGEKIT_PRIVATE_KEY:', process.env.IMAGEKIT_PRIVATE_KEY ? 'Loaded' : 'MISSING');
console.log('IMAGEKIT_URL_ENDPOINT:', process.env.IMAGEKIT_URL_ENDPOINT ? 'Loaded' : 'MISSING');
console.log('-------------------------------------------');

let imagekit;
if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) {
  try {
    imagekit = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    });
    console.log("ImageKit SDK initialized successfully.");
  } catch (error) {
    console.error("CRITICAL: Failed to initialize ImageKit SDK:", error.message);
    imagekit = null;
  }
} else {
  console.error("CRITICAL: One or more ImageKit environment variables are missing.");
  imagekit = null;
}

// Endpoint to get ImageKit authentication parameters
router.post('/imagekit-auth', (req, res) => {
  if (!imagekit) {
    console.error("Authentication endpoint called, but ImageKit SDK is not initialized.");
    return res.status(500).json({ message: "ImageKit SDK not initialized. Check server logs." });
  }
  try {
    const authParams = imagekit.getAuthenticationParameters();
    console.log("Successfully generated ImageKit auth params:", authParams);
    res.json(authParams);
  } catch (error) {
    console.error("Error getting ImageKit auth params:", error);
    res.status(500).json({ message: "Could not get authentication parameters." });
  }
});

// If requireAuth is available, import it:
import { requireAuth } from '../middleware/authMiddleware.js';

const upload = multer({ storage: multer.memoryStorage() });

// POST /image - upload an image to ImageKit and return the URL
router.post('/image', requireAuth, upload.single('image'), async (req, res) => {
  if (!imagekit) {
    return res.status(500).json({ message: 'ImageKit SDK not initialized.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }
  try {
    const result = await imagekit.upload({
      file: req.file.buffer,
      fileName: req.file.originalname,
      folder: '/products',
    });
    res.json({ success: true, url: result.url });
  } catch (error) {
    console.error('ImageKit upload error:', error);
    res.status(500).json({ success: false, message: 'Image upload failed.' });
  }
});

// POST /avatar - upload an avatar image to ImageKit
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!imagekit) {
    return res.status(500).json({ message: 'ImageKit SDK not initialized.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }
  try {
    const result = await imagekit.upload({
      file: req.file.buffer,
      fileName: `avatar_${req.user._id}_${Date.now()}_${req.file.originalname}`,
      folder: '/avatars',
    });
    res.json({ success: true, url: result.url });
  } catch (error) {
    console.error('ImageKit avatar upload error:', error);
    res.status(500).json({ success: false, message: 'Avatar upload failed.' });
  }
});

export default router;
