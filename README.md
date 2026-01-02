# Nixtla MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-000000?style=for-the-badge&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

MCP server for multitenant Nixtla TimeGPT forecasting with fine-tuning, rolling backtests, and comprehensive usage tracking.

## Features

- 🔐 **Multitenant Auth**: Token-based authentication with organization isolation
- 🎯 **Fine-tuning**: Train and manage organization-specific models with metadata
- 🤖 **Smart Base Model Selection**: Automatically selects timegpt-1 or timegpt-1-long-horizon based on data characteristics
- 📊 **Rolling Backtest**: Prove fine-tuned models outperform baseline
- 🚨 **Anomaly Detection**: Detect anomalies with baseline or finetuned models
- 📈 **Usage Tracking**: Granular consumption tracking with performance metrics
- 🌐 **HTTP MCP**: JSON-RPC 2.0 over HTTPS (not stdio)
- 🏢 **Unified Organization Management**: Models, tokens, and configs in one place
- 💾 **Blob Storage**: Secure 30-day TTL storage with organization-based access control
- 🔮 **X_future Support**: Use future exogenous variables for better forecasts

## Quick Start

### 1. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/VaclavRut/nixtla-mcp)

Or manually:

```bash
# Clone the repository
git clone https://github.com/VaclavRut/nixtla-mcp.git
cd nixtla-mcp

# Install dependencies
npm install

# Deploy to Vercel
vercel
```

### 2. Set Environment Variables

In your Vercel project settings, add these environment variables:

```env
# Nixtla API Key (get from https://dashboard.nixtla.io)
NIXTLA_API_KEY=your_nixtla_api_key_here

# HMAC secret for hashing authentication tokens (generate a strong random string)
MCP_AUTH_TOKEN_SECRET=your_strong_random_secret_here

# Admin token for bootstrap endpoint (generate a strong random string)
ADMIN_SETUP_TOKEN=your_admin_token_here

# MongoDB connection string (MongoDB Atlas or your own MongoDB instance)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority

# Vercel Blob storage token (for storing forecast/anomaly results)
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token_here
```

**Generating Secure Secrets:**

```bash
# Generate random secrets (run these in your terminal)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Set Up MongoDB

You have two options:

**Option A: MongoDB Atlas (Recommended - Free tier available)**

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Create a database user
4. Whitelist Vercel's IP addresses (or use 0.0.0.0/0 for all IPs)
5. Get your connection string and add it to `MONGODB_URI`

**Option B: Self-hosted MongoDB**

```bash
# Install MongoDB locally or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Connection string for local MongoDB
MONGODB_URI=mongodb://localhost:27017/nixtla-mcp
```

### 4. Set Up Vercel Blob Storage

1. Go to your Vercel project dashboard
2. Navigate to Storage → Create Database → Blob
3. Copy the `BLOB_READ_WRITE_TOKEN` and add it to environment variables

### 5. Bootstrap Your First Organization

After deploying, create your first organization:

```bash
curl -X POST https://your-deployment.vercel.app/api/admin/bootstrap-company \
  -H "Authorization: Bearer YOUR_ADMIN_SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "my-organization"
  }'
```

**Response:**
```json
{
  "orgId": "my-organization",
  "authToken": "abc123xyz...",
  "message": "Organization bootstrapped successfully. Store the authToken securely - it will not be shown again."
}
```

**⚠️ Important**: Save the `authToken` - it's returned only once and is needed for all API calls!

## Architecture

```
AI Agent (Claude, GPT, etc.)
    ↓ HTTP POST with Bearer token
MCP Server (Vercel)
    ↓ Auth via MongoDB → Organization resolution
    ↓ Load dataset from URL or inline data
    ↓ Call Nixtla TimeGPT API
    ↓ Track granular usage → MongoDB
    ↓ Store results → Vercel Blob (30-day TTL)
    ↓ Return JSON-RPC response with download URLs
```

## Dataset Format

Datasets can be provided via `datasetUrl` (URL or blob storage path) or `datasetData` (inline JSON) in Nixtla multi-series format:

```json
{
  "series": {
    "y": [100, 105, 110, 108, 112, 115],
    "sizes": [3, 3],
    "X": [[1.0, 2.0], [1.1, 2.1], [1.2, 2.2], [1.3, 2.3], [1.4, 2.4], [1.5, 2.5]],
    "X_future": [[1.6, 2.6], [1.7, 2.7]]
  },
  "freq": "D",
  "meta": {
    "seriesNames": ["series_a", "series_b"],
    "timestamps": ["2024-01-01", "2024-01-02", "2024-01-03"]
  }
}
```

- `y`: Concatenated values across all series (historical)
- `sizes`: Length of each series (must sum to `y.length`)
- `X`: Optional exogenous variables (historical, same length as `y`)
- `X_future`: Optional future exogenous variables for forecast period
- `freq`: D=Daily, H=Hourly, W=Weekly, M=Monthly, MS=Month Start

## MCP Tools

### Authentication

All MCP requests require:
```
POST https://your-deployment.vercel.app/mcp
Authorization: Bearer <YOUR_AUTH_TOKEN>
Content-Type: application/json
```

### Available Tools

#### 1. `validate_dataset`

Validate dataset format before forecasting.

#### 2. `finetune_model`

Fine-tune a model on your data with automatic base model selection:

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "finetune_model",
    "arguments": {
      "datasetUrl": "https://blob.vercel-storage.com/...",
      "finetuneOptions": {
        "model": "timegpt-1-long-horizon",  // Optional: override auto-selection
        "finetune_steps": 300,
        "finetune_loss": "mae",
        "finetune_depth": 4,
        "output_model_id": "my-custom-model"
      }
    }
  }
}
```

**Smart Base Model Selection:**
- **Auto-selected** by default based on average series length
- **Manual override** available via `model` parameter
- Automatically runs rolling backtest to validate improvement

#### 3. `forecast`

Generate forecasts using your organization's active model or baseline:

```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "method": "tools/call",
  "params": {
    "name": "forecast",
    "arguments": {
      "datasetUrl": "https://blob.vercel-storage.com/...",
      "h": 14,
      "level": [80, 95],
      "feature_contributions": true
    }
  }
}
```

**Returns**: JSON and CSV download URLs (30-day expiration)

#### 4. `anomaly_detect`

Detect anomalies in time series data:

```json
{
  "jsonrpc": "2.0",
  "id": "5",
  "method": "tools/call",
  "params": {
    "name": "anomaly_detect",
    "arguments": {
      "datasetUrl": "https://blob.vercel-storage.com/...",
      "useFinetunedModel": true,
      "params": {
        "level": 99,
        "clean_ex_first": true
      }
    }
  }
}
```

#### 5. `list_org_models`

List all fine-tuned models for your organization.

## Connecting AI Agents

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "nixtla": {
      "url": "https://your-deployment.vercel.app/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer YOUR_AUTH_TOKEN"
      }
    }
  }
}
```

### Custom Integration

```python
import requests

MCP_SERVER_URL = "https://your-deployment.vercel.app/mcp"
AUTH_TOKEN = "your-auth-token"

response = requests.post(
    MCP_SERVER_URL,
    headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
    json={
        "jsonrpc": "2.0",
        "id": "1",
        "method": "tools/call",
        "params": {
            "name": "forecast",
            "arguments": {
                "datasetUrl": "https://blob.vercel-storage.com/...",
                "h": 14
            }
        }
    }
)

print(response.json())
```

## Development

```bash
# Install dependencies
npm install

# Run type checking
npm run build

# Run locally (requires environment variables)
vercel dev
```

## Security Features

- **Hashed tokens**: Raw tokens never stored, only HMAC hashes
- **Organization isolation**: All data scoped by orgId with MongoDB indexes
- **Permission system**: Admin vs user access controls
- **Idempotency**: Prevents duplicate usage charges via request IDs
- **Secure blob storage**: 30-day TTL with organization-scoped access

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

- Issues: [GitHub Issues](https://github.com/VaclavRut/nixtla-mcp/issues)
- Documentation: [Full API Reference](docs/API.md)
- Nixtla Docs: [https://docs.nixtla.io](https://docs.nixtla.io)
