import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ts': 'text/typescript',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Set headers required for SharedArrayBuffer
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  let filePath = req.url === '/' ? '/example-webworker.html' : req.url;
  filePath = join(__dirname, filePath);

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('404 Not Found');
    } else {
      res.writeHead(500);
      res.end('500 Internal Server Error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}/`);
  console.log(`📦 Serving with SharedArrayBuffer support`);
  console.log(`   Cross-Origin-Opener-Policy: same-origin`);
  console.log(`   Cross-Origin-Embedder-Policy: require-corp`);
  console.log(`\n💡 Open http://localhost:${PORT}/example-webworker.html to test\n`);
});

