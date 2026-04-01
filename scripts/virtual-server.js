const express = require('express');
const app = express();

// Configuration
const PORT = 5000;
const RESPONSE_DELAY = 50; // milliseconds (simulated latency)
const ERROR_RATE = 0.02; // 2% error rate
const CONCURRENT_REQUESTS_LIMIT = 1000;

let activeConnections = 0;
let totalRequests = 0;
let totalErrors = 0;

// Middleware
app.use(express.json());

// Request tracking
app.use((req, res, next) => {
  activeConnections++;
  totalRequests++;
  
  res.on('finish', () => {
    activeConnections--;
  });
  
  next();
});

// Virtual endpoints matching production
// GET /public/rentals - List all rental listings
app.get('/public/rentals', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  
  // Simulate database delay
  await simulateDelay();
  
  // Randomly simulate errors
  if (Math.random() < ERROR_RATE) {
    totalErrors++;
    return res.status(500).json({ error: 'Database connection error' });
  }
  
  // Return mock data
  const rentals = Array.from({ length: limit }, (_, i) => ({
    id: `rental-${(page - 1) * limit + i + 1}`,
    title: `Căn hộ cho thuê ${(page - 1) * limit + i + 1}`,
    price: Math.floor(Math.random() * 20000000) + 3000000,
    location: `Quận ${Math.floor(Math.random() * 12) + 1}, TP.HCM`,
    status: 'available',
    rating: (Math.random() * 2 + 3).toFixed(1)
  }));
  
  res.json({
    success: true,
    data: rentals,
    pagination: {
      page,
      limit,
      total: 1000,
      pages: Math.ceil(1000 / limit)
    }
  });
});

// GET /public/search - Search rentals
app.get('/public/search', async (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  
  // Simulate complex search with longer delay
  await simulateDelay(100);
  
  // Higher error rate for search endpoint (as seen in real performance)
  if (Math.random() < ERROR_RATE * 3) {
    totalErrors++;
    return res.status(500).json({ error: 'Search service unavailable' });
  }
  
  // Return filtered mock data
  const results = Array.from({ length: limit }, (_, i) => ({
    id: `rental-${(page - 1) * limit + i + 1}`,
    title: `${query} - Căn hộ cho thuê`,
    price: Math.floor(Math.random() * 20000000) + 3000000,
    location: `Quận ${Math.floor(Math.random() * 12) + 1}, TP.HCM`,
    matchScore: (Math.random() * 0.5 + 0.5).toFixed(2)
  }));
  
  res.json({
    success: true,
    query,
    results,
    pagination: {
      page,
      limit,
      total: Math.floor(Math.random() * 500) + 100,
      pages: Math.ceil(500 / limit)
    }
  });
});

// GET /rooms - List rooms
app.get('/rooms', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const rentalId = req.query.rental_id;
  
  // Simulate database query
  await simulateDelay();
  
  if (Math.random() < ERROR_RATE) {
    totalErrors++;
    return res.status(500).json({ error: 'Database error' });
  }
  
  // Return mock room data
  const rooms = Array.from({ length: limit }, (_, i) => ({
    id: `room-${(page - 1) * limit + i + 1}`,
    rentalId: rentalId || `rental-${Math.floor(Math.random() * 100) + 1}`,
    type: ['Standard', 'Deluxe', 'Premium'][Math.floor(Math.random() * 3)],
    price: Math.floor(Math.random() * 10000000) + 2000000,
    capacity: Math.floor(Math.random() * 3) + 1,
    amenities: ['WiFi', 'AC', 'TV', 'Kitchen']
  }));
  
  res.json({
    success: true,
    data: rooms,
    pagination: {
      page,
      limit,
      total: 500,
      pages: Math.ceil(500 / limit)
    }
  });
});

// GET /health - Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeConnections,
    totalRequests,
    totalErrors,
    errorRate: ((totalErrors / totalRequests) * 100).toFixed(2) + '%'
  });
});

// GET /metrics - Server metrics
app.get('/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    server: {
      port: PORT,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    traffic: {
      totalRequests,
      totalErrors,
      errorRate: ((totalErrors / totalRequests) * 100).toFixed(2) + '%',
      activeConnections,
      requestsPerSecond: (totalRequests / process.uptime()).toFixed(2)
    },
    memory: {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  totalErrors++;
  res.status(500).json({ error: 'Internal server error' });
});

// Helper function to simulate database latency
function simulateDelay(baseDelay = RESPONSE_DELAY) {
  const jitter = Math.random() * 50 - 25; // ±25ms variation
  const delay = Math.max(baseDelay + jitter, 10);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           🖥️  VIRTUAL EZ-ROOM SERVER STARTED              ║
╠════════════════════════════════════════════════════════════╣
║ Port:                    ${PORT}                                 ║
║ Status:                  Running ✅                         ║
║ Base Response Delay:     ${RESPONSE_DELAY}ms                        ║
║ Simulated Error Rate:    ${(ERROR_RATE * 100).toFixed(1)}%                       ║
║ Max Concurrent Users:    ${CONCURRENT_REQUESTS_LIMIT}                      ║
╠════════════════════════════════════════════════════════════╣
║ AVAILABLE ENDPOINTS:                                       ║
║ • GET  /public/rentals   - List rentals                   ║
║ • GET  /public/search    - Search rentals                 ║
║ • GET  /rooms            - List rooms                     ║
║ • GET  /health           - Health status                  ║
║ • GET  /metrics          - Server metrics                 ║
╠════════════════════════════════════════════════════════════╣
║ 📊 Test with curl:                                         ║
║ curl http://localhost:${PORT}/public/rentals?page=1&limit=20       ║
║ curl http://localhost:${PORT}/health                              ║
║ curl http://localhost:${PORT}/metrics                             ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
