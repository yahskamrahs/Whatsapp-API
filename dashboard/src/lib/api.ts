// Use relative URL in production (when served from same origin)
// Use localhost:3001 in development
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : ''

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
  }
}

function authHeadersMultipart(): HeadersInit {
  return {}
}

function credentialFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, credentials: 'include' })
}

export interface HealthResponse {
  status: string
  whatsapp_connected: boolean
  connection_status: string
  connected_number: string | null
  timestamp: string
  uptime: number
  auth_required?: boolean
}

export interface StatusResponse {
  success: boolean
  connection: {
    status: string
    connected: boolean
    number: string | null
    registered: boolean
    error?: string | null
  }
  stats: {
    logs_count: number
    logs_by_type?: Record<string, number>
    uptime: number
    memory: {
      rss: number
      heapTotal: number
      heapUsed: number
      external: number
    }
    database?: string
  }
}

export interface LogEntry {
  id: string
  timestamp: string
  type: 'info' | 'error' | 'message_in' | 'message_out' | 'connection' | 'api'
  message: string
  details: Record<string, unknown>
}

export interface LogsResponse {
  success: boolean
  logs: LogEntry[]
  total: number
  database?: string
}

export interface LogStatsResponse {
  success: boolean
  total: number
  by_type: Record<string, number>
}

export interface PairingResponse {
  success: boolean
  pairingCode?: string
  phoneNumber?: string
  error?: string
}

export interface PairingQrResponse {
  success: boolean
  qrCode?: string | null
  connectionStatus?: string
  connected?: boolean
  error?: string | null
}

export interface ResolveJidsResponse {
  success: boolean
  mappings: Record<string, string>
}

export interface SendMessageResponse {
  success: boolean
  message?: string
  messageId?: string
  to?: string
  error?: string
}

export interface ApiKeyResponse {
  success: boolean
  api_key?: string
  api_keys?: BusinessApiKey[]
  masked?: string
  message?: string
  error?: string
}

export interface AuthUser {
  id: string
  username: string
  role: 'superadmin' | 'business' | 'business_api'
  businessId: string | null
  mustChangePassword: boolean
  impersonating: boolean
}

export interface BusinessInfo {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active?: number
  username?: string
  api_key_count?: number
  created_at?: string
}

export interface AuthResponse {
  success: boolean
  user: AuthUser
  business: BusinessInfo | null
}

export interface BusinessApiKey {
  id: string
  key_prefix: string
  label: string
  created_at: string
  last_used_at: string | null
}

export interface AutoReplyResponse {
  success: boolean
  auto_replies?: AutoReplyRule[]
  message?: string
  id?: number
  error?: string
}

export interface AutoReplyRule {
  id: number
  trigger_word: string
  reply_message: string
  is_active: boolean
  created_at: string
  updated_at: string
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data
}

export const api = {
  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ username, password })
    })
    return handleResponse(response)
  },

  async logout(): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async getCurrentUser(): Promise<AuthResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() })
    return handleResponse(response)
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    })
    return handleResponse(response)
  },

  async changeUsername(username: string, password: string): Promise<{ success: boolean; username: string }> {
    const response = await credentialFetch(`${API_BASE}/api/auth/change-username`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ username, password })
    })
    return handleResponse(response)
  },

  async stopImpersonation(): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/auth/stop-impersonation`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async getBusinesses(): Promise<{ success: boolean; businesses: BusinessInfo[] }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses`, { headers: authHeaders() })
    return handleResponse(response)
  },

  async createBusiness(input: { name: string; phone?: string; email?: string; address?: string; notes?: string; username: string; password: string }): Promise<{ success: boolean; business: BusinessInfo; apiKey: string }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input)
    })
    return handleResponse(response)
  },

  async updateBusiness(businessId: string, input: Partial<BusinessInfo>): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses/${encodeURIComponent(businessId)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(input)
    })
    return handleResponse(response)
  },

  async updateBusinessCredentials(businessId: string, username: string, password?: string): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses/${encodeURIComponent(businessId)}/credentials`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ username, password })
    })
    return handleResponse(response)
  },

  async impersonateBusiness(businessId: string): Promise<{ success: boolean; business: BusinessInfo }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses/${encodeURIComponent(businessId)}/impersonate`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async createAdminBusinessApiKey(businessId: string, label: string): Promise<{ success: boolean; apiKey: string }> {
    const response = await credentialFetch(`${API_BASE}/api/admin/businesses/${encodeURIComponent(businessId)}/api-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ label })
    })
    return handleResponse(response)
  },

  async getBusinessApiKeys(): Promise<{ success: boolean; apiKeys: BusinessApiKey[] }> {
    const response = await credentialFetch(`${API_BASE}/api/business/api-keys`, { headers: authHeaders() })
    return handleResponse(response)
  },

  async createBusinessApiKey(label: string): Promise<{ success: boolean; apiKey: string }> {
    const response = await credentialFetch(`${API_BASE}/api/business/api-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ label })
    })
    return handleResponse(response)
  },

  async revokeBusinessApiKey(keyId: string): Promise<{ success: boolean }> {
    const response = await credentialFetch(`${API_BASE}/api/business/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  // Health check (no auth required)
  async getHealth(): Promise<HealthResponse> {
    const response = await credentialFetch(`${API_BASE}/health`)
    if (!response.ok) throw new Error('Failed to fetch health')
    return response.json()
  },

  async getStatus(): Promise<StatusResponse> {
    const response = await credentialFetch(`${API_BASE}/api/status`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async getLogs(limit = 100, type?: string): Promise<LogsResponse> {
    const params = new URLSearchParams({ limit: limit.toString() })
    if (type) params.append('type', type)
    const response = await credentialFetch(`${API_BASE}/api/logs?${params}`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async resolveJids(jids: string[]): Promise<ResolveJidsResponse> {
    const response = await credentialFetch(`${API_BASE}/api/resolve-jids`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ jids })
    })
    return handleResponse(response)
  },

  async clearLogs(): Promise<{ success: boolean; message: string }> {
    const response = await credentialFetch(`${API_BASE}/api/logs`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async getLogStats(): Promise<LogStatsResponse> {
    const response = await credentialFetch(`${API_BASE}/api/logs/stats`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async requestPairing(phoneNumber: string): Promise<PairingResponse> {
    const response = await credentialFetch(`${API_BASE}/api/request-pairing`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ phoneNumber })
    })
    return handleResponse(response)
  },

  async requestQr(): Promise<{ success: boolean; error?: string }> {
    const response = await credentialFetch(`${API_BASE}/api/request-qr`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async getPairingQr(): Promise<PairingQrResponse> {
    const response = await credentialFetch(`${API_BASE}/api/pairing-qr`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async disconnect(): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await credentialFetch(`${API_BASE}/api/disconnect`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async reconnect(): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await credentialFetch(`${API_BASE}/api/reconnect`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async resetAuth(): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await credentialFetch(`${API_BASE}/api/reset-auth`, {
      method: 'POST',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async sendMessage(phoneNumber: string, message: string): Promise<SendMessageResponse> {
    const response = await credentialFetch(`${API_BASE}/api/send-message`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ phoneNumber, message })
    })
    return handleResponse(response)
  },

  async sendImage(phoneNumber: string, image: File, caption?: string): Promise<SendMessageResponse> {
    const formData = new FormData()
    formData.append('phoneNumber', phoneNumber)
    formData.append('image', image)
    if (caption) formData.append('caption', caption)
    
    const response = await credentialFetch(`${API_BASE}/api/send-image`, {
      method: 'POST',
      headers: authHeadersMultipart(),
      body: formData
    })
    return handleResponse(response)
  },

  // API Key management
  async getApiKeyInfo(): Promise<ApiKeyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/apikey`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async regenerateApiKey(): Promise<ApiKeyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/apikey/regenerate`, {
      method: 'POST',
      headers: authHeaders()
    })
    const data = await handleResponse<ApiKeyResponse>(response)
    return data
  },

  // Auto-reply management
  async getAutoReplies(): Promise<AutoReplyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auto-replies`, {
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async addAutoReply(triggerWord: string, replyMessage: string): Promise<AutoReplyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auto-replies`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ trigger_word: triggerWord, reply_message: replyMessage })
    })
    return handleResponse(response)
  },

  async deleteAutoReply(id: number): Promise<AutoReplyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auto-replies/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    return handleResponse(response)
  },

  async toggleAutoReply(id: number): Promise<AutoReplyResponse> {
    const response = await credentialFetch(`${API_BASE}/api/auto-replies/${id}/toggle`, {
      method: 'PUT',
      headers: authHeaders()
    })
    return handleResponse(response)
  }
}
