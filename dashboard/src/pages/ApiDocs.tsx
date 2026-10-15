import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Terminal
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useHealth } from '@/hooks/useApi'
import { api, type BusinessApiKey } from '@/lib/api'

export function ApiDocs() {
  const { data: health, loading: healthLoading } = useHealth()
  const [apiKeys, setApiKeys] = useState<BusinessApiKey[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null)
  const [newKeyLabel, setNewKeyLabel] = useState('Production Integration')
  const [creatingKey, setCreatingKey] = useState(false)

  // Interactive Tester state
  const [testPhone, setTestPhone] = useState('')
  const [testMessage, setTestMessage] = useState('Hello! This is a test message from the WhatsApp API.')
  const [testCustomKey, setTestCustomKey] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResponse, setTestResponse] = useState<{
    status: number | null
    timeMs: number | null
    data: unknown
    error?: string
  } | null>(null)

  const apiBase = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin

  const loadApiKeys = useCallback(async () => {
    try {
      const result = await api.getBusinessApiKeys()
      setApiKeys(result.apiKeys)
      if (result.apiKeys.length > 0) {
        const keyWithValue = result.apiKeys.find(k => k.key_value)
        if (keyWithValue && keyWithValue.key_value) {
          setSelectedKey(keyWithValue.key_value)
        } else {
          setSelectedKey(result.apiKeys[0].key_value || `${result.apiKeys[0].key_prefix}YOUR_KEY_SECRET`)
        }
      }
    } catch {
      // Ignore
    }
  }, [])

  useEffect(() => {
    void loadApiKeys()
  }, [loadApiKeys])

  const createNewKey = async () => {
    setCreatingKey(true)
    try {
      const result = await api.createBusinessApiKey(newKeyLabel.trim() || 'API Key')
      toast.success('New API key generated!')
      setSelectedKey(result.apiKey)
      await loadApiKeys()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create API key')
    } finally {
      setCreatingKey(false)
    }
  }

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const copyKey = async (key: BusinessApiKey) => {
    if (key.key_value) {
      await navigator.clipboard.writeText(key.key_value)
      setCopiedKeyId(key.id)
      setTimeout(() => setCopiedKeyId(null), 2000)
      toast.success('API key copied to clipboard!')
    } else {
      toast.info('This earlier key cannot be viewed in plain text. Please generate a new key above.')
    }
  }

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedSnippet(label)
    setTimeout(() => setCopiedSnippet(null), 2000)
    toast.success(`${label} copied to clipboard!`)
  }

  const activeApiKey = testCustomKey.trim() || selectedKey || 'YOUR_API_KEY'

  // Run interactive test
  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testPhone.trim()) {
      toast.error('Please enter a recipient phone number')
      return
    }
    setSendingTest(true)
    setTestResponse(null)
    const startTime = performance.now()

    try {
      const res = await fetch(`${apiBase}/api/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': activeApiKey,
        },
        body: JSON.stringify({
          phoneNumber: testPhone.trim(),
          message: testMessage,
        }),
      })

      const timeMs = Math.round(performance.now() - startTime)
      const data = await res.json()

      setTestResponse({
        status: res.status,
        timeMs,
        data,
      })

      if (res.ok && data.success) {
        toast.success('Test message sent successfully!')
      } else {
        toast.error(data.error || 'Failed to send message')
      }
    } catch (err) {
      const timeMs = Math.round(performance.now() - startTime)
      setTestResponse({
        status: 0,
        timeMs,
        data: null,
        error: err instanceof Error ? err.message : 'Network request failed',
      })
      toast.error('Network error while calling API')
    } finally {
      setSendingTest(false)
    }
  }

  // Generate Postman Collection v2.1 JSON
  const downloadPostmanCollection = () => {
    const postmanJson = {
      info: {
        name: 'WhatsApp Business API',
        description: `Collection for WhatsApp API deployed at ${apiBase}`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [
        { key: 'baseUrl', value: apiBase, type: 'string' },
        { key: 'apiKey', value: activeApiKey, type: 'string' },
      ],
      item: [
        {
          name: '1. Health Check',
          request: {
            method: 'GET',
            header: [],
            url: {
              raw: '{{baseUrl}}/health',
              host: ['{{baseUrl}}'],
              path: ['health'],
            },
            description: 'Check WhatsApp connectivity status and bot health.',
          },
        },
        {
          name: '2. Send Text Message',
          request: {
            method: 'POST',
            header: [
              { key: 'Content-Type', value: 'application/json' },
              { key: 'X-API-Key', value: '{{apiKey}}' },
            ],
            body: {
              mode: 'raw',
              raw: JSON.stringify(
                {
                  phoneNumber: testPhone || '919876543210',
                  message: 'Hello from Postman!',
                },
                null,
                2
              ),
              options: { raw: { language: 'json' } },
            },
            url: {
              raw: '{{baseUrl}}/api/send-message',
              host: ['{{baseUrl}}'],
              path: ['api', 'send-message'],
            },
            description: 'Send a text message to any WhatsApp phone number.',
          },
        },
        {
          name: '3. Send File / Media / Document',
          request: {
            method: 'POST',
            header: [
              { key: 'X-API-Key', value: '{{apiKey}}' },
            ],
            body: {
              mode: 'formdata',
              formdata: [
                { key: 'phoneNumber', value: testPhone || '919876543210', type: 'text' },
                { key: 'caption', value: 'Check out this document', type: 'text' },
                { key: 'file', type: 'file', src: [] },
              ],
            },
            url: {
              raw: '{{baseUrl}}/api/send-file',
              host: ['{{baseUrl}}'],
              path: ['api', 'send-file'],
            },
            description: 'Send PDF, image, document, audio or video with optional caption.',
          },
        },
        {
          name: '4. Connection Status',
          request: {
            method: 'GET',
            header: [
              { key: 'X-API-Key', value: '{{apiKey}}' },
            ],
            url: {
              raw: '{{baseUrl}}/api/status',
              host: ['{{baseUrl}}'],
              path: ['api', 'status'],
            },
            description: 'Get live socket status and device number.',
          },
        },
      ],
    }

    const blob = new Blob([JSON.stringify(postmanJson, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `whatsapp-api-postman-collection.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Postman collection downloaded!')
  }

  // Code snippets
  const curlSnippet = `curl -X POST "${apiBase}/api/send-message" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${activeApiKey}" \\
  -d '{
    "phoneNumber": "${testPhone || '919876543210'}",
    "message": "${testMessage || 'Hello from WhatsApp API!'}"
  }'`

  const nodeSnippet = `// Node.js (fetch / Native or node-fetch)
async function sendWhatsAppMessage() {
  const response = await fetch("${apiBase}/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "${activeApiKey}"
    },
    body: JSON.stringify({
      phoneNumber: "${testPhone || '919876543210'}",
      message: "${testMessage || 'Hello from WhatsApp API!'}"
    })
  });

  const data = await response.json();
  console.log("Response:", data);
}

sendWhatsAppMessage();`

  const pythonSnippet = `# Python 3 (requests)
import requests

url = "${apiBase}/api/send-message"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "${activeApiKey}"
}
payload = {
    "phoneNumber": "${testPhone || '919876543210'}",
    "message": "${testMessage || 'Hello from WhatsApp API!'}"
}

response = requests.post(url, json=payload, headers=headers)
print("Status:", response.status_code)
print("Response:", response.json())`

  const phpSnippet = `<?php
// PHP cURL
$ch = curl_init('${apiBase}/api/send-message');

$payload = json_encode([
    'phoneNumber' => '${testPhone || '919876543210'}',
    'message'     => '${testMessage || 'Hello from WhatsApp API!'}'
]);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'X-API-Key: ${activeApiKey}'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);

$response = curl_exec($ch);
curl_close($ch);

echo $response;
?>`

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Terminal className="h-8 w-8 text-primary" />
            API & Integration Guide
          </h1>
          <p className="text-muted-foreground mt-1">
            Test and integrate WhatsApp messaging into your CRM, software, ERP, or web application.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => downloadPostmanCollection()}>
            <Download className="h-4 w-4 mr-2" />
            Download Postman Collection
          </Button>
          <Button variant="default" size="sm" asChild>
            <Link to="/connection">
              <Smartphone className="h-4 w-4 mr-2" />
              WhatsApp Connection
            </Link>
          </Button>
        </div>
      </div>

      {/* WhatsApp Status Alert */}
      {!healthLoading && (
        <Card className={health?.whatsapp_connected ? 'border-primary/30 bg-primary/5' : 'border-amber-500/30 bg-amber-500/5'}>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${health?.whatsapp_connected ? 'bg-primary animate-pulse' : 'bg-amber-500'}`} />
              <div>
                <p className="text-sm font-semibold">
                  {health?.whatsapp_connected ? 'WhatsApp Connected & Ready' : 'WhatsApp is Disconnected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {health?.whatsapp_connected
                    ? `Linked Number: +${health.connected_number || 'Connected'} — API requests will be delivered immediately.`
                    : 'Messages sent via API will fail until you scan the QR code in the Connection tab.'}
                </p>
              </div>
            </div>
            {!health?.whatsapp_connected && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/connection">
                  Connect WhatsApp
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* API Key Management Section */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                Your Business API Keys
              </CardTitle>
              <CardDescription>
                View, copy, and manage keys. Select a key to populate all code examples below automatically.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit">
              Base URL: {apiBase}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick Create Key */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-muted/30 rounded-xl border">
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label htmlFor="key-label" className="text-xs">New Key Label</Label>
              <Input
                id="key-label"
                value={newKeyLabel}
                onChange={e => setNewKeyLabel(e.target.value)}
                placeholder="e.g. CRM Integration, Billing Bot"
                className="h-9"
              />
            </div>
            <Button size="sm" onClick={createNewKey} disabled={creatingKey}>
              {creatingKey ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Generate New API Key
            </Button>
          </div>

          {/* Keys List */}
          <div className="divide-y rounded-xl border bg-card">
            {apiKeys.map(key => {
              const isSelected = selectedKey === key.key_value
              const isVisible = visibleKeys[key.id]
              const isCopied = copiedKeyId === key.id

              return (
                <div key={key.id} className="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-muted/20 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{key.label}</span>
                      <Badge variant={key.last_used_at ? 'secondary' : 'outline'} className="text-[10px] py-0 px-1.5">
                        {key.last_used_at ? 'Active' : 'Unused'}
                      </Badge>
                      {isSelected && (
                        <Badge variant="default" className="text-[10px] py-0 px-1.5">
                          Selected in Examples
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1.5">
                      <code className="font-mono text-xs bg-muted px-2.5 py-1 rounded border select-all">
                        {isVisible && key.key_value
                          ? key.key_value
                          : `${key.key_prefix}••••••••••••••••••••••••••••••••`}
                      </code>

                      {key.key_value && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => toggleKeyVisibility(key.id)}
                          title={isVisible ? 'Hide full key' : 'View full key'}
                        >
                          {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => copyKey(key)}
                        title="Copy API key"
                      >
                        {isCopied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {key.key_value && (
                      <Button
                        size="sm"
                        variant={isSelected ? 'secondary' : 'outline'}
                        className="h-8 text-xs"
                        onClick={() => {
                          setSelectedKey(key.key_value!)
                          toast.success(`Key "${key.label}" selected for code examples`)
                        }}
                      >
                        {isSelected ? 'In Use' : 'Use in Code'}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}

            {!apiKeys.length && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No API keys created yet. Generate your first API key above to start testing!
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Interactive API Tester Sandbox */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="h-5 w-5 text-primary" />
            Live API Sandbox & Message Tester
          </CardTitle>
          <CardDescription>
            Test sending a real message right now using your API endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSendTest} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="test-phone" className="text-sm font-medium">
                  Recipient Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="test-phone"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="e.g. 919876543210 (with country code, no +)"
                  className="font-mono text-sm"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Include country code without <code>+</code> or dashes. Example: India is <code>91XXXXXXXXXX</code>, US is <code>1XXXXXXXXXX</code>.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="test-msg" className="text-sm font-medium">Message Content</Label>
                <Textarea
                  id="test-msg"
                  value={testMessage}
                  onChange={e => setTestMessage(e.target.value)}
                  rows={3}
                  placeholder="Type message here..."
                  className="text-sm resize-none"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="custom-key" className="text-xs text-muted-foreground">
                  API Key Used (Auto-filled from above)
                </Label>
                <Input
                  id="custom-key"
                  value={testCustomKey}
                  onChange={e => setTestCustomKey(e.target.value)}
                  placeholder={activeApiKey}
                  className="font-mono text-xs bg-muted/40"
                />
              </div>

              <Button type="submit" disabled={sendingTest} className="w-full">
                {sendingTest ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Sending Message...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Test Message
                  </>
                )}
              </Button>
            </div>

            {/* Response Console */}
            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wider">Live Response Console</span>
                {testResponse && (
                  <div className="flex items-center gap-2">
                    <Badge variant={testResponse.status === 200 ? 'default' : 'destructive'} className="text-[10px]">
                      {testResponse.status ? `HTTP ${testResponse.status}` : 'ERROR'}
                    </Badge>
                    <span>{testResponse.timeMs}ms</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-[220px] rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-100 overflow-auto border border-zinc-800">
                {testResponse ? (
                  <pre className="whitespace-pre-wrap break-all">
                    {testResponse.error
                      ? `Error: ${testResponse.error}`
                      : JSON.stringify(testResponse.data, null, 2)}
                  </pre>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-center py-10">
                    <Terminal className="h-8 w-8 mb-2 opacity-50" />
                    <p>Click "Send Test Message" to execute the request.</p>
                    <p className="text-[11px] mt-1">Real-time HTTP response and messageId will display here.</p>
                  </div>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Code Snippets & Quickstart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                Integration Code Examples
              </CardTitle>
              <CardDescription>
                Copy ready-to-run code for Postman, terminal, or your backend programming language.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyText(activeApiKey, 'API Key')}
              className="text-xs w-fit"
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy Active Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="curl" className="w-full">
            <TabsList className="grid grid-cols-2 md:grid-cols-5 mb-4">
              <TabsTrigger value="curl">cURL / Terminal</TabsTrigger>
              <TabsTrigger value="postman">Postman Guide</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="php">PHP</TabsTrigger>
            </TabsList>

            {/* cURL */}
            <TabsContent value="curl" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Run directly in PowerShell, macOS Terminal, or Linux terminal:</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => copyText(curlSnippet, 'cURL command')}
                >
                  {copiedSnippet === 'cURL command' ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  Copy cURL
                </Button>
              </div>
              <div className="relative rounded-xl bg-zinc-950 p-4 font-mono text-xs text-emerald-400 overflow-x-auto border border-zinc-800">
                <pre>{curlSnippet}</pre>
              </div>
            </TabsContent>

            {/* Postman */}
            <TabsContent value="postman" className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-primary" />
                    How to Setup in Postman Manually:
                  </h4>
                  <Button size="sm" onClick={() => downloadPostmanCollection()}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download Postman Collection (.json)
                  </Button>
                </div>

                <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground">
                  <li>Open Postman and create a new request with method <strong>POST</strong>.</li>
                  <li>
                    Set Request URL to: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">{apiBase}/api/send-message</code>
                  </li>
                  <li>
                    Go to the <strong>Headers</strong> tab and add two headers:
                    <div className="mt-1.5 ml-4 space-y-1 font-mono text-[11px]">
                      <div>• <code>Content-Type</code>: <code>application/json</code></div>
                      <div>• <code>X-API-Key</code>: <code className="text-primary">{activeApiKey}</code></div>
                    </div>
                  </li>
                  <li>
                    Go to the <strong>Body</strong> tab, select <strong>raw</strong>, and choose <strong>JSON</strong> format:
                  </li>
                </ol>

                <div className="rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-100 border border-zinc-800">
                  <pre>{`{
  "phoneNumber": "${testPhone || '919876543210'}",
  "message": "Hello from Postman!"
}`}</pre>
                </div>

                <p className="text-xs text-muted-foreground">
                  5. Click <strong>Send</strong>. If your WhatsApp is connected, you'll receive a <code>200 OK</code> with the WhatsApp <code>messageId</code>.
                </p>
              </div>
            </TabsContent>

            {/* Node.js */}
            <TabsContent value="node" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Modern JavaScript / TypeScript (Node.js 18+ native fetch):</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => copyText(nodeSnippet, 'Node.js snippet')}
                >
                  {copiedSnippet === 'Node.js snippet' ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  Copy Code
                </Button>
              </div>
              <div className="relative rounded-xl bg-zinc-950 p-4 font-mono text-xs text-sky-400 overflow-x-auto border border-zinc-800">
                <pre>{nodeSnippet}</pre>
              </div>
            </TabsContent>

            {/* Python */}
            <TabsContent value="python" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Python 3 with requests package (<code>pip install requests</code>):</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => copyText(pythonSnippet, 'Python snippet')}
                >
                  {copiedSnippet === 'Python snippet' ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  Copy Code
                </Button>
              </div>
              <div className="relative rounded-xl bg-zinc-950 p-4 font-mono text-xs text-yellow-400 overflow-x-auto border border-zinc-800">
                <pre>{pythonSnippet}</pre>
              </div>
            </TabsContent>

            {/* PHP */}
            <TabsContent value="php" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Native PHP cURL script (compatible with WordPress, Laravel, or standalone):</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => copyText(phpSnippet, 'PHP snippet')}
                >
                  {copiedSnippet === 'PHP snippet' ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  Copy Code
                </Button>
              </div>
              <div className="relative rounded-xl bg-zinc-950 p-4 font-mono text-xs text-purple-400 overflow-x-auto border border-zinc-800">
                <pre>{phpSnippet}</pre>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Complete API Reference Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Complete Endpoints Reference
          </CardTitle>
          <CardDescription>
            All endpoints support authentication via header <code>X-API-Key: wa_...</code>, <code>Authorization: Bearer wa_...</code>, or query param <code>?api_key=...</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Endpoint 1: Send Message */}
          <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-600 hover:bg-emerald-700 font-mono">POST</Badge>
                <code className="text-sm font-bold font-mono">/api/send-message</code>
              </div>
              <span className="text-xs text-muted-foreground">Send Text Message</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sends an outgoing text message to a specific WhatsApp phone number or contact.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground uppercase text-[10px]">Request Body (JSON)</span>
                <pre className="bg-zinc-950 text-zinc-100 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto">{`{
  "phoneNumber": "919876543210", // required
  "message": "Your text message"    // required
}`}</pre>
              </div>
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground uppercase text-[10px]">Success Response (200 OK)</span>
                <pre className="bg-zinc-950 text-emerald-400 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto">{`{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "3EB0ABC12345DEF",
  "to": "919876543210@s.whatsapp.net"
}`}</pre>
              </div>
            </div>
          </div>

          {/* Endpoint 2: Send File */}
          <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-600 hover:bg-emerald-700 font-mono">POST</Badge>
                <code className="text-sm font-bold font-mono">/api/send-file</code>
              </div>
              <span className="text-xs text-muted-foreground">Send Media / Document / PDF</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sends an attachment (PDF invoice, JPEG/PNG image, MP4 video, audio, or document) with an optional caption.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground uppercase text-[10px]">Request (multipart/form-data)</span>
                <pre className="bg-zinc-950 text-zinc-100 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto">{`// Form Fields:
phoneNumber: "919876543210"
caption:     "Here is your monthly invoice"
file:        <binary file data>`}</pre>
              </div>
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground uppercase text-[10px]">Success Response (200 OK)</span>
                <pre className="bg-zinc-950 text-emerald-400 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto">{`{
  "success": true,
  "message": "File sent successfully",
  "messageId": "3EB0ABC98765XYZ",
  "fileName": "invoice.pdf"
}`}</pre>
              </div>
            </div>
          </div>

          {/* Endpoint 3: Health */}
          <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-600 hover:bg-blue-700 font-mono">GET</Badge>
                <code className="text-sm font-bold font-mono">/health</code>
              </div>
              <span className="text-xs text-muted-foreground">Public Status & Health Check</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Quick health probe to verify if the server is alive and if WhatsApp is currently paired and active. No API key required.
            </p>
            <div className="text-xs font-mono">
              <pre className="bg-zinc-950 text-emerald-400 p-2.5 rounded-lg border border-zinc-800 overflow-x-auto">{`{
  "status": "OK",
  "whatsapp_connected": true,
  "connection_status": "open",
  "connected_number": "919876543210",
  "timestamp": "2026-10-15T18:00:00.000Z"
}`}</pre>
            </div>
          </div>

          {/* Endpoint 4: Status */}
          <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-600 hover:bg-blue-700 font-mono">GET</Badge>
                <code className="text-sm font-bold font-mono">/api/status</code>
              </div>
              <span className="text-xs text-muted-foreground">Detailed Connection & Stats</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Returns deep connection diagnostics, uptime statistics, and RAM / memory consumption.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Official Baileys Documentation Footer */}
      <Card className="border-muted bg-gradient-to-br from-card to-muted/20">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-bold text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Powered by Baileys (WhiskeySockets)
              </h3>
              <p className="text-xs text-muted-foreground max-w-2xl">
                This WhatsApp API gateway is powered by <strong>Baileys</strong>, the open-source TypeScript library that implements WhatsApp's Multi-Device WebSocket protocol directly without Selenium or Chromium overhead.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://baileys.whiskeysockets.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Baileys Docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://github.com/WhiskeySockets/Baileys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Baileys GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-muted-foreground border-t">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span><strong>End-to-End Encrypted:</strong> Cryptographic keys remain isolated inside your server.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span><strong>Direct WebSocket:</strong> Zero headless browser lag; fast message delivery.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span><strong>Multi-Device:</strong> Keeps running 24/7 even if your mobile phone is offline.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
