import express from 'express'

const router = express.Router()

// Placeholder routes for users
router.get('/profile', (req, res) => {
  res.json({
    success: true,
    message: 'User profile endpoint - coming soon'
  })
})

router.put('/profile', (req, res) => {
  res.json({
    success: true,
    message: 'Update user profile endpoint - coming soon'
  })
})

export default router
