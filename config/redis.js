import { createClient } from 'redis'

let redisClient = null

export const connectRedis = async () => {
  // For development, make Redis optional
  if (process.env.NODE_ENV === 'development' && !process.env.REDIS_URL) {
    console.log('📝 Redis disabled for development mode')
    return null
  }

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('⚠️ Redis server connection refused')
          return new Error('Redis server connection refused')
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          console.error('⚠️ Redis retry time exhausted')
          return new Error('Retry time exhausted')
        }
        if (options.attempt > 10) {
          console.error('⚠️ Redis retry attempts exhausted')
          return undefined
        }
        return Math.min(options.attempt * 100, 3000)
      }
    })

    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err)
      // Don't exit process in development
      if (process.env.NODE_ENV !== 'development') {
        process.exit(1)
      }
    })

    redisClient.on('connect', () => {
      console.log('✅ Redis Connected')
    })

    redisClient.on('ready', () => {
      console.log('🚀 Redis Ready')
    })

    redisClient.on('end', () => {
      console.log('🔴 Redis Connection Ended')
    })

    await redisClient.connect()
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message)
    console.warn('⚠️ Continuing without Redis cache...')
  }
}

export const getRedisClient = () => redisClient

export const setCache = async (key, value, expireTime = 3600) => {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(key, expireTime, JSON.stringify(value))
    }
  } catch (error) {
    console.error('❌ Redis set error:', error)
  }
}

export const getCache = async (key) => {
  try {
    if (redisClient && redisClient.isReady) {
      const result = await redisClient.get(key)
      return result ? JSON.parse(result) : null
    }
  } catch (error) {
    console.error('❌ Redis get error:', error)
  }
  return null
}

export const deleteCache = async (key) => {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.del(key)
    }
  } catch (error) {
    console.error('❌ Redis delete error:', error)
  }
}
