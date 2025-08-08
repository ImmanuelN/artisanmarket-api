import mongoose from 'mongoose'

const connectDB = async () => {
  try {
    // Check if MONGODB_URI is defined
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not defined')
    }

    console.log('🔄 Connecting to MongoDB...')
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      heartbeatFrequencyMS: 2000, // Send a ping every 2 seconds to keep connection alive
      retryWrites: true, // Retry failed writes
      retryReads: true // Retry failed reads
    })

    console.log(`✅ MongoDB Connected to: ${conn.connection.host}`)
    console.log(`📂 Database: ${conn.connection.name}`)
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err)
    })

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected - will attempt to reconnect automatically')
    })

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected successfully')
    })

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🔄 Gracefully shutting down MongoDB connection...')
      await mongoose.connection.close()
      console.log('🔴 MongoDB connection closed through app termination')
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('🔄 Gracefully shutting down MongoDB connection...')
      await mongoose.connection.close()
      console.log('🔴 MongoDB connection closed through app termination')
      process.exit(0)
    })

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message)
    console.error('Stack trace:', error.stack)
    
    // In development, don't exit immediately - allow for manual restart
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Development mode: Server will continue running without database')
      setTimeout(() => {
        console.log('🔄 Attempting to reconnect to MongoDB in 5 seconds...')
        connectDB()
      }, 5000)
    } else {
      process.exit(1)
    }
  }
}

export default connectDB
