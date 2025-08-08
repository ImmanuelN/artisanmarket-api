#!/usr/bin/env node

/**
 * Server Health Monitor
 * This script continuously monitors the server health and alerts when issues are detected
 */

import axios from 'axios'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000'
const CHECK_INTERVAL = 10000 // 10 seconds
const TIMEOUT_THRESHOLD = 5000 // 5 seconds
const FAILURE_THRESHOLD = 3 // Number of consecutive failures before alerting

let consecutiveFailures = 0
let serverHealthy = true
let lastSuccessTime = Date.now()

console.log('🔍 Starting server health monitor...')
console.log(`📡 Monitoring: ${SERVER_URL}`)
console.log(`⏱️ Check interval: ${CHECK_INTERVAL / 1000}s`)
console.log(`⚠️ Failure threshold: ${FAILURE_THRESHOLD} consecutive failures`)
console.log('━'.repeat(60))

async function checkServerHealth() {
  try {
    const start = Date.now()
    
    // Check ping endpoint first (lightweight)
    const pingResponse = await axios.get(`${SERVER_URL}/ping`, {
      timeout: TIMEOUT_THRESHOLD,
      headers: {
        'User-Agent': 'Server-Health-Monitor'
      }
    })
    
    const responseTime = Date.now() - start
    
    if (pingResponse.status === 200) {
      // Server is responding
      if (!serverHealthy) {
        console.log(`✅ ${new Date().toISOString()} - Server recovered! Response time: ${responseTime}ms`)
        serverHealthy = true
      } else if (responseTime > 2000) {
        console.log(`🐌 ${new Date().toISOString()} - Slow response: ${responseTime}ms`)
      } else {
        console.log(`✅ ${new Date().toISOString()} - Server healthy (${responseTime}ms)`)
      }
      
      consecutiveFailures = 0
      lastSuccessTime = Date.now()
      
      // Perform detailed health check occasionally
      if (Date.now() % (60000) < CHECK_INTERVAL) { // Every minute
        await performDetailedHealthCheck()
      }
      
    } else {
      throw new Error(`Unexpected status code: ${pingResponse.status}`)
    }
    
  } catch (error) {
    consecutiveFailures++
    const timeSinceLastSuccess = ((Date.now() - lastSuccessTime) / 1000).toFixed(1)
    
    console.error(`❌ ${new Date().toISOString()} - Server check failed (${consecutiveFailures}/${FAILURE_THRESHOLD})`)
    console.error(`   Error: ${error.message}`)
    console.error(`   Time since last success: ${timeSinceLastSuccess}s`)
    
    if (consecutiveFailures >= FAILURE_THRESHOLD && serverHealthy) {
      console.error('🚨 SERVER APPEARS TO BE DOWN OR UNRESPONSIVE!')
      console.error('🚨 Consecutive failures:', consecutiveFailures)
      console.error('🚨 Last successful check:', new Date(lastSuccessTime).toISOString())
      
      serverHealthy = false
      
      // Optional: Attempt to gather more information
      await performDiagnostics()
    }
  }
}

async function performDetailedHealthCheck() {
  try {
    const healthResponse = await axios.get(`${SERVER_URL}/health`, {
      timeout: TIMEOUT_THRESHOLD
    })
    
    const health = healthResponse.data
    console.log(`📊 Detailed health check:`)
    console.log(`   Uptime: ${Math.floor(health.uptime / 60)}m ${Math.floor(health.uptime % 60)}s`)
    console.log(`   Memory: ${health.memory?.used || 'unknown'}MB used`)
    console.log(`   Database: ${health.database?.mongodb || 'unknown'}`)
    
    // Warn about high memory usage
    if (health.memory?.used > 300) {
      console.warn(`⚠️ High memory usage: ${health.memory.used}MB`)
    }
    
    // Warn about database issues
    if (health.database?.mongodb !== 'connected') {
      console.warn(`⚠️ Database issue: ${health.database?.mongodb}`)
    }
    
  } catch (error) {
    console.warn(`⚠️ Detailed health check failed: ${error.message}`)
  }
}

async function performDiagnostics() {
  console.log('🔍 Performing system diagnostics...')
  
  try {
    // Check if the process is running
    const { stdout: psOutput } = await execAsync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV')
    const nodeProcesses = psOutput.split('\n').filter(line => line.includes('node.exe')).length - 1
    console.log(`📋 Found ${nodeProcesses} Node.js processes running`)
    
    // Check port usage
    try {
      const { stdout: portOutput } = await execAsync('netstat -an | findstr :5000')
      if (portOutput.trim()) {
        console.log(`🔌 Port 5000 status:`)
        console.log(portOutput.trim())
      } else {
        console.log(`❌ No process listening on port 5000`)
      }
    } catch (portError) {
      console.log(`⚠️ Could not check port status: ${portError.message}`)
    }
    
  } catch (error) {
    console.error(`❌ Diagnostics failed: ${error.message}`)
  }
}

// Start monitoring
console.log(`🚀 Health monitor started at ${new Date().toISOString()}`)
setInterval(checkServerHealth, CHECK_INTERVAL)

// Initial check
checkServerHealth()

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Monitor stopped by user')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Monitor terminated')
  process.exit(0)
})
