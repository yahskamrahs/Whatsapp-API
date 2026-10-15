import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Save, Server, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHealth } from '@/hooks/useApi'
import { api, type BusinessApiKey } from '@/lib/api'
import { toast } from 'sonner'

export function AccountSettings() {
  const { data: health } = useHealth()
  const [apiKeys, setApiKeys] = useState<BusinessApiKey[]>([])
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [keyLabel, setKeyLabel] = useState('External integration')
  const [newApiKey, setNewApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [username, setUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const loadApiKeys = useCallback(async () => {
    try {
      const result = await api.getBusinessApiKeys()
      setApiKeys(result.apiKeys)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load business API keys')
    }
  }, [])

  useEffect(() => {
    void loadApiKeys()
    void api.getCurrentUser().then(result => setUsername(result.user.username)).catch(() => undefined)
  }, [loadApiKeys])

  const createApiKey = async () => {
    setLoading(true)
    try {
      const result = await api.createBusinessApiKey(keyLabel.trim() || 'External integration')
      setNewApiKey(result.apiKey)
      await loadApiKeys()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create API key')
    } finally {
      setLoading(false)
    }
  }

  const revokeApiKey = async (key: BusinessApiKey) => {
    setLoading(true)
    try {
      await api.revokeBusinessApiKey(key.id)
      await loadApiKeys()
      toast.success('API key revoked')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke API key')
    } finally {
      setLoading(false)
    }
  }

  const updateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    try {
      if (username.trim()) await api.changeUsername(username.trim(), currentPassword)
      if (newPassword) await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Account credentials updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update account')
    } finally {
      setLoading(false)
    }
  }

  const copyApiKey = async () => {
    await navigator.clipboard.writeText(newApiKey)
    setCopied(true)
    toast.success('API key copied')
  }

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const copyExistingKey = async (key: BusinessApiKey) => {
    if (key.key_value) {
      await navigator.clipboard.writeText(key.key_value)
      setCopiedKeyId(key.id)
      setTimeout(() => setCopiedKeyId(null), 2000)
      toast.success('API key copied to clipboard')
    } else {
      toast.info('This is an earlier key whose plain text was not saved. Create a new key above to view and copy anytime.')
    }
  }

  const apiBase = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Account security and business integrations</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Account credentials</CardTitle>
          <CardDescription>Change your username or password. Passwords require at least 12 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={updateAccount} className="grid gap-4 md:grid-cols-3 md:items-end">
            <div className="space-y-2"><Label htmlFor="account-username">Username</Label><Input id="account-username" type="email" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="account-current-password">Current password</Label><Input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="account-new-password">New password (optional)</Label><Input id="account-new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></div>
            <Button type="submit" disabled={loading || !currentPassword} className="md:col-span-3 md:justify-self-end"><Save className="mr-2 h-4 w-4" />Save account</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Business API keys</CardTitle>
          <CardDescription>Keys are scoped to this business for external integrations. Dashboard login uses your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-2"><Label htmlFor="api-key-label">Key label</Label><Input id="api-key-label" value={keyLabel} onChange={event => setKeyLabel(event.target.value)} maxLength={80} /></div>
            <Button onClick={() => void createApiKey()} disabled={loading}><KeyRound className="mr-2 h-4 w-4" />Create API key</Button>
          </div>
          <div className="divide-y rounded-lg border">
            {apiKeys.map(key => (
              <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{key.label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="font-mono text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                      {visibleKeys[key.id] && key.key_value
                        ? key.key_value
                        : `${key.key_prefix}••••••••••••••••••••`}
                    </code>
                    {key.key_value && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleKeyVisibility(key.id)}
                        title={visibleKeys[key.id] ? 'Hide key' : 'View key'}
                      >
                        {visibleKeys[key.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => void copyExistingKey(key)}
                      title="Copy API key"
                    >
                      {copiedKeyId === key.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{key.last_used_at ? 'Used' : 'Not used'}</Badge>
                  <Button variant="ghost" size="icon" aria-label="Revoke API key" disabled={loading} onClick={() => void revokeApiKey(key)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {!apiKeys.length && <p className="p-4 text-sm text-muted-foreground">No active API keys.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Server className="h-5 w-5 text-primary" />API server</CardTitle><CardDescription>External integrations can use this business’s API keys.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/40 p-4">
          <div><p className="text-sm font-medium">{apiBase}</p><p className="text-xs text-muted-foreground">Health: {health?.status || 'Checking'}</p></div>
          <Badge variant={health?.status === 'OK' ? 'default' : 'outline'}>{health?.status || 'Unknown'}</Badge>
        </CardContent>
      </Card>

      <Dialog open={Boolean(newApiKey)} onOpenChange={open => { if (!open) { setNewApiKey(''); setCopied(false) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy your new API key</DialogTitle><DialogDescription>This secret is shown once. Store it safely before closing this dialog.</DialogDescription></DialogHeader>
          <div className="flex gap-2"><Input readOnly value={newApiKey} className="font-mono" /><Button size="icon" onClick={() => void copyApiKey()} aria-label="Copy API key">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
          <DialogFooter><Button onClick={() => setNewApiKey('')}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}