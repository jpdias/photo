const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DIST_DIR = path.join(__dirname, 'dist');

// MIME types for different file extensions
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);
  
  // Security check to prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File not found, try to serve index.html for SPA behavior
      if (req.url !== '/' && !path.extname(req.url)) {
        filePath = path.join(DIST_DIR, 'index.html');
        fs.access(filePath, fs.constants.F_OK, (err) => {
          if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }
          serveFile(filePath, res);
        });
      } else {
        res.writeHead(404);
        res.end('File not found');
      }
      return;
    }

    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Server error');
      return;
    }

    res.writeHead(200, { 
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// Check if dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  console.error('❌ dist/ directory not found. Please run "npm run build" first.');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`🚀 Development server running at http://localhost:${PORT}`);
  console.log('📁 Serving files from:', DIST_DIR);
  console.log('🛑 Press Ctrl+C to stop the server');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});