#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:5000';
const LOAD_PROFILES = [
  {
    name: 'Light Load (500 users)',
    users: 500,
    duration: 180, // seconds
    rampUp: 60
  },
  {
    name: 'Heavy Load (1000 users)',
    users: 1000,
    duration: 180,
    rampUp: 120
  }
];

// Test endpoints with weights (weighted distribution)
const ENDPOINTS = [
  {
    name: '/public/rentals',
    url: '/public/rentals',
    params: { page: 1, limit: 20 },
    weight: 0.4
  },
  {
    name: '/public/search',
    url: '/public/search',
    params: { q: 'phong', page: 1 },
    weight: 0.35
  },
  {
    name: '/rooms',
    url: '/rooms',
    params: { page: 1, limit: 20 },
    weight: 0.25
  }
];

// Metrics collection
class MetricsCollector {
  constructor() {
    this.requests = [];
    this.startTime = null;
    this.endTime = null;
    this.errors = [];
    this.byEndpoint = {};
  }

  recordRequest(result) {
    this.requests.push(result);
    const endpoint = result.endpoint;
    if (!this.byEndpoint[endpoint]) {
      this.byEndpoint[endpoint] = {
        name: endpoint,
        total: 0,
        success: 0,
        errors: 0,
        latencies: [],
        errorCodes: {}
      };
    }
    
    this.byEndpoint[endpoint].total++;
    if (result.status === 200) {
      this.byEndpoint[endpoint].success++;
      this.byEndpoint[endpoint].latencies.push(result.latency);
    } else {
      this.byEndpoint[endpoint].errors++;
      const code = result.status || 'NETWORK_ERROR';
      this.byEndpoint[endpoint].errorCodes[code] = (this.byEndpoint[endpoint].errorCodes[code] || 0) + 1;
    }
  }

  calculateStats(latencies) {
    if (latencies.length === 0) return null;
    
    const sorted = latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(avg),
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  getSummary() {
    const total = this.requests.length;
    const successful = this.requests.filter(r => r.status === 200).length;
    const failed = total - successful;
    const duration = (this.endTime - this.startTime) / 1000;
    const rps = (total / duration).toFixed(2);
    
    const allLatencies = this.requests
      .filter(r => r.status === 200)
      .map(r => r.latency);
    
    const stats = this.calculateStats(allLatencies);
    
    return {
      total,
      successful,
      failed,
      successRate: ((successful / total) * 100).toFixed(2),
      errorRate: ((failed / total) * 100).toFixed(2),
      durationSeconds: duration.toFixed(2),
      requestsPerSecond: rps,
      latency: stats,
      byEndpoint: Object.values(this.byEndpoint).map(ep => ({
        ...ep,
        successRate: ((ep.success / ep.total) * 100).toFixed(2),
        errorRate: ((ep.errors / ep.total) * 100).toFixed(2),
        latency: this.calculateStats(ep.latencies)
      }))
    };
  }
}

// Select endpoint based on probability
function selectEndpoint() {
  const rand = Math.random();
  let cumulative = 0;
  
  for (const ep of ENDPOINTS) {
    cumulative += ep.weight;
    if (rand <= cumulative) {
      return ep;
    }
  }
  
  return ENDPOINTS[0];
}

// Simulate single user making requests
async function simulateUser(userId, duration, metrics, abortSignal) {
  const startTime = Date.now();
  let requestCount = 0;
  
  while ((Date.now() - startTime) < (duration * 1000)) {
    if (abortSignal.aborted) break;
    
    const endpoint = selectEndpoint();
    const reqStart = Date.now();
    
    try {
      const response = await axios.get(`${BASE_URL}${endpoint.url}`, {
        params: endpoint.params,
        timeout: 30000
      });
      
      const latency = Date.now() - reqStart;
      
      metrics.recordRequest({
        userId,
        endpoint: endpoint.name,
        status: response.status,
        latency,
        timestamp: new Date().toISOString()
      });
      
      requestCount++;
      
      // Random delay between 100-500ms
      const delay = Math.random() * 400 + 100;
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (error) {
      const latency = Date.now() - reqStart;
      const status = error.response?.status || null;
      
      metrics.recordRequest({
        userId,
        endpoint: endpoint.name,
        status,
        latency,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      // On error, wait longer before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return requestCount;
}

// Run load test
async function runLoadTest(profile) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 STARTING: ${profile.name}`);
  console.log(`${'='.repeat(80)}`);
  
  console.log(`📊 Configuration:`);
  console.log(`   • Concurrent Users: ${profile.users}`);
  console.log(`   • Ramp-up Time: ${profile.rampUp}s`);
  console.log(`   • Test Duration: ${profile.duration}s`);
  console.log(`   • Total Duration: ${profile.rampUp + profile.duration}s`);
  
  const metrics = new MetricsCollector();
  metrics.startTime = Date.now();
  
  // Abort controller for graceful shutdown
  const abortController = new AbortController();
  
  // Start health check
  try {
    const health = await axios.get(`${BASE_URL}/health`);
    console.log(`\n✅ Server Health: ${health.data.status}`);
    console.log(`   • Uptime: ${health.data.uptime.toFixed(2)}s`);
    console.log(`   • Current Load: ${health.data.activeConnections} connections`);
  } catch (error) {
    console.error('❌ Server is not responding. Make sure virtual-server.js is running!');
    console.error(`   Run: node scripts/virtual-server.js`);
    process.exit(1);
  }
  
  console.log(`\n🔄 Starting users...`);
  
  const usersPromises = [];
  const usersPerSecond = profile.users / profile.rampUp;
  let usersStarted = 0;
  
  // Ramp-up: gradually start users
  for (let i = 0; i < profile.rampUp; i++) {
    const usersToStart = Math.floor(usersPerSecond);
    
    for (let j = 0; j < usersToStart; j++) {
      const promise = simulateUser(usersStarted, profile.duration, metrics, abortController.signal);
      usersPromises.push(promise);
      usersStarted++;
      
      if (usersStarted % 100 === 0) {
        process.stdout.write(`   ✅ Started ${usersStarted}/${profile.users} users\r`);
      }
    }
    
    // Wait 1 second before ramping up more users
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`   ✅ Started ${usersStarted}/${profile.users} users\n`);
  
  // Run main test
  console.log(`⏱️  Running test for ${profile.duration} seconds...`);
  const testStart = Date.now();
  
  // Progress reporting
  const progressInterval = setInterval(() => {
    const currentLoad = metrics.requests.length;
    const elapsed = Math.round((Date.now() - testStart) / 1000);
    const rps = (currentLoad / elapsed).toFixed(2);
    process.stdout.write(`   📈 ${currentLoad} requests in ${elapsed}s (${rps} req/s)\r`);
  }, 1000);
  
  // Wait for main test to complete
  await new Promise(resolve => setTimeout(resolve, profile.duration * 1000));
  
  clearInterval(progressInterval);
  
  // Graceful shutdown
  console.log(`\n\n⏹️  Shutting down users...`);
  abortController.abort();
  
  // Wait for all users to finish
  await Promise.allSettled(usersPromises);
  
  metrics.endTime = Date.now();
  
  // Get final metrics
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 LOAD TEST RESULTS: ${profile.name}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const summary = metrics.getSummary();
  
  console.log(`OVERALL METRICS:`);
  console.log(`├─ Total Requests:        ${summary.total}`);
  console.log(`├─ Successful:            ${summary.successful} (${summary.successRate}%)`);
  console.log(`├─ Failed:                ${summary.failed} (${summary.errorRate}%)`);
  console.log(`├─ Duration:              ${summary.durationSeconds}s`);
  console.log(`├─ Requests/sec:          ${summary.requestsPerSecond}`);
  console.log(`├─ Avg Latency:           ${summary.latency?.avg}ms`);
  console.log(`├─ Min Latency:           ${summary.latency?.min}ms`);
  console.log(`├─ Max Latency:           ${summary.latency?.max}ms`);
  console.log(`├─ P50 Latency:           ${summary.latency?.p50}ms`);
  console.log(`├─ P95 Latency:           ${summary.latency?.p95}ms (Target: 300ms)`);
  console.log(`└─ P99 Latency:           ${summary.latency?.p99}ms\n`);
  
  console.log(`PER-ENDPOINT BREAKDOWN:`);
  summary.byEndpoint.forEach(ep => {
    console.log(`\n${ep.name}`);
    console.log(`├─ Requests:              ${ep.total}`);
    console.log(`├─ Success:               ${ep.success} (${ep.successRate}%)`);
    console.log(`├─ Errors:                ${ep.errors} (${ep.errorRate}%)`);
    if (Object.keys(ep.errorCodes).length > 0) {
      console.log(`├─ Error Codes:           ${JSON.stringify(ep.errorCodes)}`);
    }
    console.log(`├─ Avg Latency:           ${ep.latency?.avg}ms`);
    console.log(`├─ Min/Max:               ${ep.latency?.min}ms / ${ep.latency?.max}ms`);
    console.log(`├─ P95 Latency:           ${ep.latency?.p95}ms`);
    console.log(`└─ P99 Latency:           ${ep.latency?.p99}ms`);
  });
  
  // Server metrics at end
  try {
    const serverMetrics = await axios.get(`${BASE_URL}/metrics`);
    console.log(`\nSERVER METRICS AT END:`);
    console.log(`├─ Total Requests:        ${serverMetrics.data.traffic.totalRequests}`);
    console.log(`├─ Total Errors:          ${serverMetrics.data.traffic.totalErrors}`);
    console.log(`├─ Overall Error Rate:    ${serverMetrics.data.traffic.errorRate}`);
    console.log(`├─ Requests/sec:          ${serverMetrics.data.traffic.requestsPerSecond}`);
    console.log(`├─ Active Connections:    ${serverMetrics.data.traffic.activeConnections}`);
    console.log(`├─ Heap Used:             ${serverMetrics.data.memory.heapUsed}`);
    console.log(`└─ Heap Total:            ${serverMetrics.data.memory.heapTotal}\n`);
  } catch (error) {
    console.log('\n⚠️  Could not retrieve server metrics\n');
  }
  
  return {
    profile: profile.name,
    summary,
    timestamp: new Date().toISOString()
  };
}

// Main execution
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     🎯 EZ-ROOM STRESS TEST (500-1000 Users)              ║
║     Powered by Node.js + Axios                           ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Create results directory
  if (!fs.existsSync('perf-results')) {
    fs.mkdirSync('perf-results', { recursive: true });
  }
  
  const allResults = [];
  
  // Run each load profile
  for (const profile of LOAD_PROFILES) {
    const result = await runLoadTest(profile);
    allResults.push(result);
    
    // Wait between test runs
    console.log(`\n⏳ Waiting 30 seconds before next test...\n`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  
  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join('perf-results', `stress-test-report-${timestamp}.json`);
  
  fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2));
  console.log(`\n✅ Report saved to: ${reportPath}`);
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ STRESS TEST COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
