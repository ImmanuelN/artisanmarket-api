import mongoose from 'mongoose'
import { io } from '../server.js'

/**
 * Keep-Alive Service
 * Prevents server hibernation by maintaining minimal activity every few hours
 * This combats hosting services that shut down inactive servers
 */

class KeepAliveService {
  constructor() {
    this.intervalId = null
    this.isRunning = false
    this.lastActivity = new Date()
    this.activityLog = []
    this.maxLogEntries = 100
  }

  /**
   * Start the keep-alive service
   * @param {number} intervalHours - Hours between keep-alive activities (default: 2)
   */
  start(intervalHours = 2) {
    if (this.isRunning) {
      console.log('⚡ Keep-Alive: Service already running')
      return
    }

    const intervalMs = intervalHours * 60 * 60 * 1000 // Convert hours to milliseconds
    
    console.log(`⚡ Keep-Alive: Starting service with ${intervalHours}h interval`)
    
    this.intervalId = setInterval(() => {
      this.performKeepAliveActivity()
    }, intervalMs)
    
    this.isRunning = true
    this.logActivity('Service started', `Interval: ${intervalHours}h`)
    
    // Perform initial activity after 5 minutes
    setTimeout(() => {
      this.performKeepAliveActivity()
    }, 5 * 60 * 1000)
  }

  /**
   * Stop the keep-alive service
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚡ Keep-Alive: Service not running')
      return
    }

    clearInterval(this.intervalId)
    this.isRunning = false
    this.logActivity('Service stopped')
    console.log('⚡ Keep-Alive: Service stopped')
  }

  /**
   * Perform minimal database and server activities
   */
  async performKeepAliveActivity() {
    try {
      console.log('⚡ Keep-Alive: Performing activity cycle...')
      
      const startTime = Date.now()
      const activities = []

      // 1. Database ping - minimal read operation
      try {
        const dbStatus = mongoose.connection.readyState
        if (dbStatus === 1) {
          // Simple database ping
          await mongoose.connection.db.admin().ping()
          activities.push('DB ping')
          
          // Minimal collection read (check if collections exist)
          const collections = await mongoose.connection.db.listCollections().toArray()
          activities.push(`DB collections: ${collections.length}`)
        } else {
          activities.push('DB disconnected')
        }
      } catch (error) {
        console.warn('⚡ Keep-Alive: Database ping failed:', error.message)
        activities.push('DB ping failed')
      }

      // 2. Memory cleanup hint
      if (global.gc) {
        global.gc()
        activities.push('Memory GC')
      }

      // 3. Socket.IO activity (if clients connected)
      const socketCount = io.sockets.sockets.size
      if (socketCount > 0) {
        io.emit('keep-alive-ping', { timestamp: new Date().toISOString() })
        activities.push(`Socket ping: ${socketCount} clients`)
      } else {
        activities.push('No socket clients')
      }

      // 4. System health check
      const memUsage = process.memoryUsage()
      const uptime = process.uptime()
      activities.push(`Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`)
      activities.push(`Uptime: ${Math.floor(uptime / 3600)}h`)

      const duration = Date.now() - startTime
      const activitySummary = activities.join(', ')
      
      this.logActivity('Activity completed', `${activitySummary} (${duration}ms)`)
      console.log(`⚡ Keep-Alive: Cycle completed in ${duration}ms - ${activitySummary}`)
      
      this.lastActivity = new Date()

    } catch (error) {
      console.error('⚡ Keep-Alive: Activity cycle failed:', error)
      this.logActivity('Activity failed', error.message)
    }
  }

  /**
   * Log activity with timestamp
   * @param {string} action 
   * @param {string} details 
   */
  logActivity(action, details = '') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      details
    }

    this.activityLog.unshift(logEntry)
    
    // Keep only the last N entries
    if (this.activityLog.length > this.maxLogEntries) {
      this.activityLog = this.activityLog.slice(0, this.maxLogEntries)
    }
  }

  /**
   * Get service status and recent activity
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastActivity: this.lastActivity,
      uptime: this.isRunning ? Date.now() - this.lastActivity.getTime() : 0,
      recentActivities: this.activityLog.slice(0, 10), // Last 10 activities
      memoryUsage: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      systemUptime: Math.floor(process.uptime()),
      mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    }
  }

  /**
   * Perform an immediate keep-alive activity (manual trigger)
   */
  async triggerImmediate() {
    console.log('⚡ Keep-Alive: Manual trigger requested')
    await this.performKeepAliveActivity()
    return this.getStatus()
  }
}

// Create singleton instance
const keepAliveService = new KeepAliveService()

export default keepAliveService
