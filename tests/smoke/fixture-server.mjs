import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(__dirname, '..', 'fixture')

export async function startFixtureServer(port = 0) {
  const server = http.createServer((req, res) => {
    // Strip query string and normalise to a file path
    const urlPath = req.url.split('?')[0]
    const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = path.join(FIXTURE_DIR, relPath)

    // Prevent directory traversal outside FIXTURE_DIR
    if (!filePath.startsWith(FIXTURE_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h1>404 Not Found</h1></body></html>')
        return
      }
      const contentType = filePath.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: assignedPort } = server.address()
      resolve({ server, url: `http://127.0.0.1:${assignedPort}` })
    })
    server.on('error', reject)
  })
}

export function stopFixtureServer(server) {
  return new Promise(resolve => server.close(resolve))
}
