/**
 * Ez-Room JMeter-like Load Test using Node.js
 * Simulates 50 concurrent users making requests to 3 endpoints
 * Duration: 90 seconds
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

// Configuration
const CONFIG = {
    concurrentUsers: 50,
    durationSeconds: 90,
    endpoints: [
        {
            name: 'GET /public/rentals',
            method: 'GET',
            path: '/public/rentals?page=1&limit=20',
            weight: 0.4 // 40% of traffic
        },
        {
            name: 'GET /public/search',
            method: 'GET',
            path: '/public/search?query=phong&page=1&limit=20',
            weight: 0.3 // 30% of traffic
        },
        {
            name: 'GET /rooms',
            method: 'GET',
            path: '/rooms?page=1&limit=20',
            weight: 0.3 // 30% of traffic
        }
    ]
};

// Results Storage
const results = {
    startTime: new Date(),
    endTime: null,
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    endpoints: {},
    responseTimes: [],
    errors: []
};

// Initialize endpoint results
CONFIG.endpoints.forEach(endpoint => {
    results.endpoints[endpoint.name] = {
        requests: 0,
        success: 0,
        failed: 0,
        errors: 0,
        min: Infinity,
        max: 0,
        avg: 0,
        p95: 0,
        p99: 0,
        responseTimes: []
    };
});

/**
 * Select random endpoint based on weight
 */
function selectEndpoint() {
    const random = Math.random();
    let accumulated = 0;
    
    for (const endpoint of CONFIG.endpoints) {
        accumulated += endpoint.weight;
        if (random <= accumulated) {
            return endpoint;
        }
    }
    
    return CONFIG.endpoints[CONFIG.endpoints.length - 1];
}

/**
 * Make HTTP request and record metrics
 */
async function makeRequest(endpoint) {
    const startTime = Date.now();
    
    try {
        const response = await axios({
            method: endpoint.method,
            url: BASE_URL + endpoint.path,
            timeout: 30000,
            validateStatus: () => true // Accept all status codes
        });
        
        const responseTime = Date.now() - startTime;
        
        results.totalRequests++;
        results.responseTimes.push(responseTime);
        
        const endpointResults = results.endpoints[endpoint.name];
        endpointResults.requests++;
        endpointResults.responseTimes.push(responseTime);
        
        // Update min/max/avg
        endpointResults.min = Math.min(endpointResults.min, responseTime);
        endpointResults.max = Math.max(endpointResults.max, responseTime);
        
        // Count success/failure
        if (response.status >= 200 && response.status < 300) {
            results.successRequests++;
            endpointResults.success++;
        } else {
            results.failedRequests++;
            endpointResults.failed++;
            endpointResults.errors++;
            
            if (results.errors.length < 100) { // Keep first 100 errors
                results.errors.push({
                    endpoint: endpoint.name,
                    status: response.status,
                    time: new Date().toISOString(),
                    responseTime
                });
            }
        }
        
        return { success: true, responseTime, status: response.status };
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        results.totalRequests++;
        results.failedRequests++;
        results.responseTimes.push(responseTime);
        
        const endpointResults = results.endpoints[endpoint.name];
        endpointResults.requests++;
        endpointResults.failed++;
        endpointResults.errors++;
        endpointResults.responseTimes.push(responseTime);
        endpointResults.min = Math.min(endpointResults.min, responseTime);
        endpointResults.max = Math.max(endpointResults.max, responseTime);
        
        results.errors.push({
            endpoint: endpoint.name,
            error: error.message,
            time: new Date().toISOString()
        });
        
        return { success: false, responseTime, error: error.message };
    }
}

/**
 * Calculate percentile
 */
function calculatePercentile(array, percentile) {
    const sorted = array.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

/**
 * Simulate user session
 */
async function simulateUser(userId, duration) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < duration * 1000) {
        const endpoint = selectEndpoint();
        await makeRequest(endpoint);
        
        // Random delay between requests (100-500ms)
        const delay = Math.random() * 400 + 100;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

/**
 * Run load test
 */
async function runLoadTest() {
    console.log('🚀 Starting Ez-Room Load Test');
    console.log(`📊 Configuration:`);
    console.log(`   - Concurrent Users: ${CONFIG.concurrentUsers}`);
    console.log(`   - Duration: ${CONFIG.durationSeconds} seconds`);
    console.log(`   - Endpoints: ${CONFIG.endpoints.length}`);
    console.log('');
    
    const userPromises = [];
    
    // Launch all user simulations
    for (let i = 0; i < CONFIG.concurrentUsers; i++) {
        userPromises.push(
            simulateUser(i, CONFIG.durationSeconds)
                .catch(err => console.error(`User ${i} error:`, err.message))
        );
        
        // Stagger user startup (ramp-up over 10 seconds)
        await new Promise(resolve => setTimeout(resolve, (10000 / CONFIG.concurrentUsers)));
        
        if ((i + 1) % 10 === 0) {
            console.log(`✅ Started ${i + 1}/${CONFIG.concurrentUsers} users`);
        }
    }
    
    // Wait for all users to complete
    await Promise.all(userPromises);
    
    results.endTime = new Date();
}

/**
 * Calculate statistics
 */
function calculateStatistics() {
    const allResponseTimes = results.responseTimes.sort((a, b) => a - b);
    
    results.statistics = {
        totalDurationSeconds: (results.endTime - results.startTime) / 1000,
        requestsPerSecond: (results.totalRequests / ((results.endTime - results.startTime) / 1000)).toFixed(2),
        successRate: ((results.successRequests / results.totalRequests) * 100).toFixed(2),
        errorRate: ((results.failedRequests / results.totalRequests) * 100).toFixed(2),
        avgResponseTime: (allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length).toFixed(2),
        minResponseTime: Math.min(...allResponseTimes),
        maxResponseTime: Math.max(...allResponseTimes),
        p95ResponseTime: calculatePercentile(allResponseTimes, 95),
        p99ResponseTime: calculatePercentile(allResponseTimes, 99)
    };
    
    // Calculate per-endpoint statistics
    Object.keys(results.endpoints).forEach(endpointName => {
        const ep = results.endpoints[endpointName];
        if (ep.requests > 0) {
            ep.avg = (ep.responseTimes.reduce((a, b) => a + b, 0) / ep.requests).toFixed(2);
            ep.p95 = calculatePercentile([...ep.responseTimes], 95);
            ep.p99 = calculatePercentile([...ep.responseTimes], 99);
            ep.successRate = ((ep.success / ep.requests) * 100).toFixed(2);
            ep.errorRate = ((ep.errors / ep.requests) * 100).toFixed(2);
        }
    });
}

/**
 * Generate report
 */
function generateReport() {
    const reportPath = path.join(__dirname, 'jmeter-load-test-report.json');
    
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n✅ Report saved to: ${reportPath}`);
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('LOAD TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Requests:       ${results.totalRequests}`);
    console.log(`Successful:           ${results.successRequests} (${results.statistics.successRate}%)`);
    console.log(`Failed:               ${results.failedRequests} (${results.statistics.errorRate}%)`);
    console.log(`Duration:             ${results.statistics.totalDurationSeconds.toFixed(2)}s`);
    console.log(`Requests/sec:         ${results.statistics.requestsPerSecond}`);
    console.log(`Avg Response Time:    ${results.statistics.avgResponseTime}ms`);
    console.log(`Min Response Time:    ${results.statistics.minResponseTime}ms`);
    console.log(`Max Response Time:    ${results.statistics.maxResponseTime}ms`);
    console.log(`P95 Response Time:    ${results.statistics.p95ResponseTime}ms`);
    console.log(`P99 Response Time:    ${results.statistics.p99ResponseTime}ms`);
    console.log('='.repeat(70));
    
    console.log('\nPER-ENDPOINT RESULTS:');
    console.log('-'.repeat(70));
    
    CONFIG.endpoints.forEach(endpoint => {
        const ep = results.endpoints[endpoint.name];
        console.log(`\n${endpoint.name}`);
        console.log(`  Requests:      ${ep.requests}`);
        console.log(`  Success:       ${ep.success} (${ep.successRate}%)`);
        console.log(`  Errors:        ${ep.errors} (${ep.errorRate}%)`);
        console.log(`  Avg Response:  ${ep.avg}ms`);
        console.log(`  Min/Max:       ${ep.min}ms / ${ep.max}ms`);
        console.log(`  P95/P99:       ${ep.p95}ms / ${ep.p99}ms`);
    });
    
    console.log('\n' + '='.repeat(70));
}

// Run test
(async () => {
    try {
        await runLoadTest();
        calculateStatistics();
        generateReport();
        
        console.log('\n✅ Load test completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Load test failed:', error);
        process.exit(1);
    }
})();
