# WhatsApp Bot with Dashboard - Baileys

![WhatsApp Bot Dashboard](image.png)

A powerful WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys) that provides a complete web dashboard for managing WhatsApp connections, sending messages, viewing logs, and more.

## 🌟 Features

- **WhatsApp Web Integration** - Connect via pairing code (no QR code needed)
- **Web Dashboard** - Modern React-based UI for easy management
- **REST API** - Full API for integration with other applications
- **Auto-reply System** - Built-in auto-reply for common messages
- **Message History** - View all sent and received messages
- **Real-time Logs** - Monitor all bot activities
- **SQLite Database** - Persistent storage for logs and configuration
- **HTTPS Support** - Secure HTTPS with SSL certificates
- **Docker Ready** - Easy deployment with Docker and Docker Compose
- **API Key Authentication** - Secure API access with auto-generated keys

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/chekuhakim/baileys-whatsapp.git
cd baileys-whatsapp

# Start with Docker
docker-compose up --build -d

# View logs
docker-compose logs -f
```

The bot will start and display the API key and pairing code URL.

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/chekuhakim/baileys-whatsapp.git
cd baileys-whatsapp

# Install dependencies
npm install

# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Build dashboard
cd dashboard && npm run build && cd ..

# Start the bot
node bot.js
```

## 📋 Prerequisites

- **Node.js** 20+ (for local development)
- **Docker & Docker Compose** (for containerized deployment)
- **WhatsApp Account** (for pairing)
- **Domain Name** (optional, for HTTPS setup)

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `3001` | Server port |

### API Key

The API key is automatically generated on first run and stored in the SQLite database. You can find it in the console logs:

```
🔐 API Key: wa_abc123def456ghi789jkl012mno345pqr678stu901vwx
```

## 📱 WhatsApp Setup

1. **Start the bot** using Docker or locally
2. **Get the pairing code** from the console or dashboard
3. **Open WhatsApp** on your phone
4. **Go to Settings → Linked Devices → Link a Device**
5. **Enter the 8-digit pairing code** (expires in 60 seconds)

The bot will automatically connect and show as "Baileys" in your Linked Devices.

## 🌐 HTTPS Setup with Traefik

For production deployment with HTTPS:

### 1. Setup Traefik

Ensure you have Traefik running with Let's Encrypt:

```yaml
# traefik/docker-compose.yml
version: '3.8'
services:
  traefik:
    image: traefik:v2.11
    command:
      - --api.dashboard=true
      - --api.insecure=true
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=your@email.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - traefik
```

### 2. Update docker-compose.yml

Add Traefik labels to enable HTTPS routing:

```yaml
version: '3.8'
services:
  whatsapp-bot:
    # ... existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.wagateway.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.wagateway.entrypoints=websecure"
      - "traefik.http.routers.wagateway.tls.certresolver=letsencrypt"
      - "traefik.http.services.wagateway.loadbalancer.server.port=3001"
      # HTTP to HTTPS redirect
      - "traefik.http.routers.wagateway-http.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.wagateway-http.entrypoints=web"
      - "traefik.http.routers.wagateway-http.middlewares=redirect-to-https"
      - "traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https"
    networks:
      - traefik

networks:
  traefik:
    external: true
```

### 3. Update DNS

Point your domain (`yourdomain.com`) to your server's IP address.

## 📊 Dashboard

Access the web dashboard at:
- **Local:** `http://localhost:3001`
- **Production:** `https://yourdomain.com`

### Dashboard Features

- **Connection Status** - View WhatsApp connection status
- **Message History** - Browse sent and received messages
- **Real-time Logs** - Monitor bot activities
- **API Key Management** - View and regenerate API keys
- **Settings** - API documentation and configuration

## 🔌 API Documentation

### Base URL
- **Local:** `http://localhost:3001`
- **Production:** `https://yourdomain.com`

### Authentication
All API endpoints (except `/health`) require an API key in the header:
```
X-API-Key: wa_your_api_key_here
```

### Endpoints

#### Health Check
```http
GET /health
```
Returns basic health status (no authentication required).

#### Get Status
```http
GET /api/status
```
Returns detailed connection status and statistics.

#### Send Text Message
```http
POST /api/send-message
Content-Type: application/json

{
  "phoneNumber": "60123456789",
  "message": "Hello from API!"
}
```

#### Send File (Universal)
```http
POST /api/send-file
Content-Type: multipart/form-data

phoneNumber: 60123456789
file: [file - auto-detects type]
caption: Optional caption
```

**Supported File Types:**
- **Images:** JPG, PNG, GIF, WebP
- **Videos:** MP4, AVI, MOV, MKV
- **Audio:** MP3, WAV, OGG, M4A
- **Documents:** PDF, DOC, DOCX, TXT, XLS, XLSX, PPT, PPTX, ZIP, RAR

#### Send Image (Legacy)
```http
POST /api/send-image
Content-Type: multipart/form-data

phoneNumber: 60123456789
image: [image file]
caption: Optional caption
```

#### Compress PDF (Async with Webhook)
```http
POST /api/compress-pdf
Content-Type: multipart/form-data

pdf: [pdf file]
webhookUrl: https://your-netlify-function-url
```

**Response:**
```json
{
  "success": true,
  "jobId": "unique-job-id",
  "message": "PDF compression started. Results will be sent to webhook.",
  "status": "processing"
}
```

**Webhook Payload (when completed):**
```json
{
  "jobId": "unique-job-id",
  "status": "completed",
  "originalFilename": "document.pdf",
  "compressedFilename": "compressed_1234567890_document.pdf",
  "originalSize": 2048576,
  "compressedSize": 1048576,
  "compressionRatio": 48.83,
  "fileData": "base64-encoded-pdf-data...",
  "mimeType": "application/pdf",
  "completedAt": "2026-01-18T06:30:00.000Z"
}
```

**Note:** The compressed PDF file data is sent directly in the webhook payload as base64, eliminating the need for additional downloads or phone number requirements.

#### Request Pairing Code
```http
POST /api/request-pairing
Content-Type: application/json

{
  "phoneNumber": "60123456789"
}
```

#### Get Logs
```http
GET /api/logs?limit=100&type=message_out
```

#### Disconnect
```http
POST /api/disconnect
```

#### API Key Management
```http
GET /api/apikey
POST /api/apikey/regenerate
```

### Code Examples

#### JavaScript
```javascript
const API_KEY = 'wa_your_api_key_here';

const response = await fetch('https://yourdomain.com/api/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  },
  body: JSON.stringify({
    phoneNumber: '60123456789',
    message: 'Hello from API!'
  })
});
```

#### Python
```python
import requests

API_KEY = 'wa_your_api_key_here'

# Send text message
response = requests.post(
    'https://yourdomain.com/api/send-message',
    headers={'X-API-Key': API_KEY},
    json={
        'phoneNumber': '60123456789',
        'message': 'Hello from API!'
    }
)

# Send file
with open('/path/to/your/file.pdf', 'rb') as file:
    files = {'file': file}
    data = {'phoneNumber': '60123456789', 'caption': 'Check this out!'}
    headers = {'X-API-Key': API_KEY}

    response = requests.post(
        'https://yourdomain.com/api/send-file',
        headers=headers,
        files=files,
        data=data
    )
```

#### cURL
```bash
# Send text message
curl -X POST https://yourdomain.com/api/send-message \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wa_your_api_key_here" \
  -d '{"phoneNumber": "60123456789", "message": "Hello from API!"}'

# Send file (any type)
curl -X POST https://yourdomain.com/api/send-file \
  -H "X-API-Key: wa_your_api_key_here" \
  -F "phoneNumber=60123456789" \
  -F "file=@/path/to/your/file.pdf" \
  -F "caption=Check out this document"
```

## 🤖 Auto-Reply System

The bot includes built-in auto-reply functionality:

- **"bong"** → replies "bing"
- **"hello"** → replies "Hi there! 👋"
- **"ping"** → replies "pong 🏓"

You can modify the auto-reply logic in `bot.js` in the message handler.

## 📁 Project Structure

```
├── bot.js                 # Main WhatsApp bot server
├── dashboard/            # React dashboard
│   ├── src/
│   │   ├── pages/       # Dashboard pages
│   │   ├── components/  # Reusable components
│   │   └── lib/         # API utilities
│   └── dist/            # Built dashboard (generated)
├── docker-compose.yml    # Docker configuration
├── Dockerfile           # Docker build instructions
├── package.json         # Backend dependencies
├── API_GUIDE.md         # Detailed API documentation
└── data/               # Persistent data (created by Docker)
    ├── logs.db         # SQLite database
    ├── auth_info_baileys/  # WhatsApp session data
    └── uploads/        # Uploaded files
```

## 🔧 Development

### Backend Development

```bash
# Install dependencies
npm install

# Run in development mode
node bot.js
```

### Dashboard Development

```bash
cd dashboard

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Database

The bot uses SQLite for persistent storage:
- **Location:** `data/logs.db`
- **Schema:** Auto-created on first run
- **Tables:** `logs`, `config`

## 🐛 Troubleshooting

### Common Issues

#### 1. "WhatsApp not initialized" error
- The bot needs to be connected first via pairing code
- Use the dashboard or API to request a new pairing code

#### 2. Connection keeps disconnecting
- Check internet connection
- WhatsApp Web session may have expired
- Reset auth and reconnect

#### 3. Docker container won't start
```bash
# Check logs
docker-compose logs

# Rebuild
docker-compose down
docker-compose up --build
```

#### 4. HTTPS not working
- Ensure DNS is pointing to your server
- Check Traefik logs: `docker logs traefik`
- Verify SSL certificates: `docker exec traefik ls -la /letsencrypt/`

#### 5. API returns 403 Forbidden
- Check your API key
- Ensure it's included in the `X-API-Key` header
- Regenerate API key if needed

### Logs

View logs in several ways:

```bash
# Docker logs
docker-compose logs -f

# API logs endpoint
curl -H "X-API-Key: your_key" https://yourdomain.com/api/logs

# Database logs
sqlite3 data/logs.db "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10;"
```

## 🔒 Security

- **API Key Authentication** - All sensitive endpoints require API keys
- **HTTPS Support** - SSL/TLS encryption for production
- **Input Validation** - Phone numbers and messages are validated
- **Rate Limiting** - Built-in request throttling
- **Session Isolation** - WhatsApp sessions are properly isolated

## 📄 License

This project is open source. Please check the license file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 🚀 Development Workflow

### GitHub Push Script

For easy pushing with authentication:

```bash
# Setup credentials (one-time)
echo "GITHUB_TOKEN=your_token_here" > .github_credentials
echo "GIT_USER=your_username" >> .github_credentials
echo "GIT_EMAIL=your_email" >> .github_credentials

# Push changes
./push.sh "Your commit message"

# Or use default message
./push.sh
```

**Note:** The `.github_credentials` file is gitignored for security.

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/chekuhakim/baileys-whatsapp/issues)
- **Documentation:** [API Guide](API_GUIDE.md)

---

**Happy WhatsApp Botting!** 📱🤖#   W h a t s a p p - A P I  
 