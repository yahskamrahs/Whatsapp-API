import { useEffect, useState } from 'react'
import { 
  Smartphone, 
  Link2, 
  Unlink, 
  RefreshCw, 
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useStatus } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function Connection() {
  const { data: status, refetch } = useStatus()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [pairingMode, setPairingMode] = useState<'code' | 'qr'>('code')
  const [qrActive, setQrActive] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrError, setQrError] = useState('')

  const isConnected = status?.connection?.connected
  const connectedNumber = status?.connection?.number

  useEffect(() => {
    if (pairingMode !== 'qr' || !qrActive) return

    let cancelled = false
    const pollQr = async () => {
      try {
        const result = await api.getPairingQr()
        if (cancelled) return
        setQrDataUrl(result.qrCode || '')
        setQrError(result.error || '')
        if (result.connected) {
          setQrActive(false)
          setQrDataUrl('')
          refetch()
          toast.success('WhatsApp connected!')
        }
      } catch (error) {
        if (!cancelled) {
          setQrError(error instanceof Error ? error.message : 'Failed to load QR code')
        }
      }
    }

    void pollQr()
    const interval = window.setInterval(pollQr, 1500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [pairingMode, qrActive, refetch])

  const handleRequestPairing = async () => {
    if (!phoneNumber) {
      toast.error('Please enter a phone number')
      return
    }

    setLoading(true)
    setPairingCode('')

    try {
      const result = await api.requestPairing(phoneNumber)
      if (result.success && result.pairingCode) {
        setPairingCode(result.pairingCode)
        toast.success('Pairing code generated!')
      } else {
        toast.error(result.error || 'Failed to generate pairing code')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  const handleRequestQr = async () => {
    setLoading(true)
    setQrActive(false)
    setQrDataUrl('')
    setQrError('')

    try {
      const result = await api.requestQr()
      if (result.success) {
        setQrActive(true)
        toast.success('Waiting for WhatsApp QR code...')
      } else {
        setQrError(result.error || 'Failed to start QR pairing')
      }
    } catch (error) {
      setQrError(error instanceof Error ? error.message : 'Failed to start QR pairing')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pairingCode)
    setCopied(true)
    toast.success('Code copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDisconnect = async () => {
    setLoading(true)
    try {
      const result = await api.disconnect()
      if (result.success) {
        toast.success('Disconnected successfully')
        refetch()
      } else {
        toast.error(result.error || 'Failed to disconnect')
      }
    } catch {
      toast.error('Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  const handleReconnect = async () => {
    setLoading(true)
    try {
      const result = await api.reconnect()
      if (result.success) {
        toast.success('Reconnection initiated')
        refetch()
      } else {
        toast.error(result.error || 'Failed to reconnect')
      }
    } catch {
      toast.error('Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  const handleResetAuth = async () => {
    setLoading(true)
    try {
      const result = await api.resetAuth()
      if (result.success) {
        toast.success('Auth reset. Restart the bot to connect a new number.')
        setResetDialogOpen(false)
        refetch()
      } else {
        toast.error(result.error || 'Failed to reset auth')
      }
    } catch {
      toast.error('Failed to connect to API')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in-up">
        <h1 className="text-3xl font-bold tracking-tight">Connection</h1>
        <p className="text-muted-foreground mt-1">
          Manage your WhatsApp connection and pair new devices
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current Status */}
        <Card className={cn(
          "animate-fade-in-up stagger-1",
          isConnected ? "border-primary/30" : "border-muted"
        )}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              Connection Status
            </CardTitle>
            <CardDescription>
              Current WhatsApp connection details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  isConnected ? "bg-primary/20" : "bg-muted"
                )}>
                  <Smartphone className={cn(
                    "w-6 h-6",
                    isConnected ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <div>
                  <p className="font-medium">
                    {isConnected ? 'WhatsApp Connected' : 'Not Connected'}
                  </p>
                  {connectedNumber && (
                    <p className="text-sm text-muted-foreground">+{connectedNumber}</p>
                  )}
                  {!isConnected && status?.connection?.error && (
                    <p className="mt-1 text-xs text-destructive">{status.connection.error}</p>
                  )}
                </div>
              </div>
              <Badge variant={isConnected ? "default" : "secondary"}>
                {status?.connection?.status || 'unknown'}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleReconnect}
                disabled={loading}
                className="flex-1"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Reconnect
              </Button>

              {isConnected && (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="flex-1 text-destructive hover:text-destructive"
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pair New Device */}
        <Card className="animate-fade-in-up stagger-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              Pair New Number
            </CardTitle>
            <CardDescription>
              Generate a pairing code to connect a new WhatsApp number
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2" role="tablist" aria-label="Pairing method">
              <Button
                type="button"
                role="tab"
                aria-selected={pairingMode === 'code'}
                variant={pairingMode === 'code' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setPairingMode('code')}
              >
                Pairing code
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={pairingMode === 'qr'}
                variant={pairingMode === 'qr' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setPairingMode('qr')}
              >
                QR code
              </Button>
            </div>

            {pairingMode === 'code' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    placeholder="60123456789"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the phone number with country code (without + or spaces)
                  </p>
                </div>

                <Button
                  onClick={handleRequestPairing}
                  disabled={loading || !phoneNumber}
                  className="w-full"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4 mr-2" />
                  )}
                  Generate Pairing Code
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleRequestQr} disabled={loading || isConnected} className="w-full">
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4 mr-2" />
                  )}
                  Generate QR Code
                </Button>
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border bg-muted/30 p-4 text-center">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="WhatsApp device linking QR code" className="h-64 w-64 max-w-full rounded bg-white p-2" />
                  ) : qrError ? (
                    <p className="text-sm text-destructive">{qrError}</p>
                  ) : qrActive ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Waiting for WhatsApp to provide a QR code...</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Generate a QR code to link this device.</p>
                  )}
                  {qrDataUrl && (
                    <p className="text-xs text-muted-foreground">
                      On your phone, open WhatsApp → Linked Devices → Link a Device, then scan this code.
                    </p>
                  )}
                </div>
              </>
            )}

            {pairingMode === 'code' && pairingCode && (
              <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 space-y-3">
                <p className="text-sm text-center text-muted-foreground">
                  Your pairing code:
                </p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-3xl font-bold tracking-[0.5em] text-primary">
                    {pairingCode}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyCode}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-primary" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <div className="text-xs text-center text-muted-foreground space-y-1">
                  <p>Open WhatsApp on your phone:</p>
                  <p className="font-medium">Settings → Linked Devices → Link a Device</p>
                  <p className="text-destructive">⚠️ Code expires in 60 seconds!</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Danger Zone */}
      <Card className="animate-fade-in-up stagger-3 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            These actions are irreversible. Proceed with caution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-xl border border-destructive/30 bg-destructive/5">
            <div>
              <p className="font-medium">Reset Authentication</p>
              <p className="text-sm text-muted-foreground">
                Delete all session data and start fresh
              </p>
            </div>
            <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Reset Auth
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you sure?</DialogTitle>
                  <DialogDescription>
                    This will delete all authentication data including session files.
                    You will need to restart the bot and pair a new number.
                    This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleResetAuth} disabled={loading}>
                    {loading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Yes, Reset Everything
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
