import { useCallback, useEffect, useState } from 'react'
import { Building2, Copy, KeyRound, Loader2, LogIn, LogOut, Plus, Save, ShieldCheck, UserRoundCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type AuthUser, type BusinessInfo } from '@/lib/api'
import { toast } from 'sonner'

interface SuperAdminProps {
  user: AuthUser
  onLogout: () => void
  onImpersonate: () => Promise<void>
}

type BusinessForm = {
  name: string
  phone: string
  email: string
  address: string
  notes: string
  username: string
  password: string
}

const emptyForm: BusinessForm = {
  name: '', phone: '', email: '', address: '', notes: '', username: '', password: ''
}

export function SuperAdmin({ user, onLogout, onImpersonate }: SuperAdminProps) {
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editBusiness, setEditBusiness] = useState<BusinessInfo | null>(null)
  const [credentialsBusiness, setCredentialsBusiness] = useState<BusinessInfo | null>(null)
  const [apiKeyDialog, setApiKeyDialog] = useState('')
  const [form, setForm] = useState<BusinessForm>(emptyForm)
  const [credentialForm, setCredentialForm] = useState({ username: '', password: '' })
  const [profileForm, setProfileForm] = useState({ currentPassword: '', username: '', newPassword: '' })

  const loadBusinesses = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getBusinesses()
      setBusinesses(result.businesses)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load businesses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadBusinesses() }, [loadBusinesses])

  const updateForm = (field: keyof BusinessForm, value: string) => setForm(current => ({ ...current, [field]: value }))

  const createBusiness = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await api.createBusiness({
        ...form,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        notes: form.notes || undefined
      })
      setApiKeyDialog(result.apiKey)
      setCreateOpen(false)
      setForm(emptyForm)
      await loadBusinesses()
      toast.success('Business created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create business')
    } finally {
      setSaving(false)
    }
  }

  const saveBusiness = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editBusiness) return
    setSaving(true)
    try {
      await api.updateBusiness(editBusiness.id, editBusiness)
      await loadBusinesses()
      setEditBusiness(null)
      toast.success('Business details updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update business')
    } finally {
      setSaving(false)
    }
  }

  const saveBusinessCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!credentialsBusiness) return
    setSaving(true)
    try {
      await api.updateBusinessCredentials(credentialsBusiness.id, credentialForm.username, credentialForm.password || undefined)
      setCredentialsBusiness(null)
      setCredentialForm({ username: '', password: '' })
      toast.success('Business login updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update business login')
    } finally {
      setSaving(false)
    }
  }

  const issueApiKey = async (business: BusinessInfo) => {
    setSaving(true)
    try {
      const result = await api.createAdminBusinessApiKey(business.id, 'Admin-issued key')
      setApiKeyDialog(result.apiKey)
      await loadBusinesses()
      toast.success(`API key created for ${business.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create API key')
    } finally {
      setSaving(false)
    }
  }

  const impersonate = async (business: BusinessInfo) => {
    setSaving(true)
    try {
      await api.impersonateBusiness(business.id)
      await onImpersonate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open business workspace')
    } finally {
      setSaving(false)
    }
  }

  const updateAdminCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (profileForm.username !== user.username) {
        await api.changeUsername(profileForm.username, profileForm.currentPassword)
      }
      if (profileForm.newPassword) {
        await api.changePassword(profileForm.currentPassword, profileForm.newPassword)
      }
      setProfileForm({ currentPassword: '', username: user.username, newPassword: '' })
      toast.success('Admin credentials updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update credentials')
    } finally {
      setSaving(false)
    }
  }

  const copyKey = async () => {
    await navigator.clipboard.writeText(apiKeyDialog)
    toast.success('API key copied')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></span>
            <div><p className="font-semibold">Superadmin</p><p className="text-xs text-muted-foreground">{user.username}</p></div>
          </div>
          <Button variant="outline" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-3xl font-bold tracking-tight">Businesses</h1><p className="mt-1 text-muted-foreground">Manage tenant accounts and WhatsApp workspaces.</p></div>
          <Button onClick={() => { setForm(emptyForm); setCreateOpen(true) }}><Plus className="mr-2 h-4 w-4" />Create business</Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRoundCog className="h-5 w-5 text-primary" />Admin credentials</CardTitle><CardDescription>Change the superadmin username or password.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={updateAdminCredentials} className="grid gap-3 md:grid-cols-4 md:items-end">
              <div className="space-y-2"><Label htmlFor="admin-username">Username</Label><Input id="admin-username" value={profileForm.username || user.username} onChange={event => setProfileForm(current => ({ ...current, username: event.target.value }))} required /></div>
              <div className="space-y-2"><Label htmlFor="admin-current-password">Current password</Label><Input id="admin-current-password" type="password" value={profileForm.currentPassword} onChange={event => setProfileForm(current => ({ ...current, currentPassword: event.target.value }))} required /></div>
              <div className="space-y-2"><Label htmlFor="admin-new-password">New password (optional)</Label><Input id="admin-new-password" type="password" minLength={12} value={profileForm.newPassword} onChange={event => setProfileForm(current => ({ ...current, newPassword: event.target.value }))} /></div>
              <Button type="submit" disabled={saving || !profileForm.currentPassword}><Save className="mr-2 h-4 w-4" />Save login</Button>
            </form>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : businesses.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {businesses.map(business => (
              <Card key={business.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
                      <div className="min-w-0"><CardTitle className="truncate">{business.name}</CardTitle><CardDescription className="truncate">{business.username} · {business.phone || 'No contact phone'}</CardDescription></div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs">{business.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="truncate">{business.email || '—'}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">API keys</dt><dd>{business.api_key_count || 0}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-muted-foreground">Address</dt><dd className="truncate">{business.address || '—'}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" onClick={() => void impersonate(business)} disabled={saving}><LogIn className="mr-1.5 h-4 w-4" />Open workspace</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditBusiness({ ...business })}>Edit details</Button>
                    <Button size="sm" variant="outline" onClick={() => { setCredentialsBusiness(business); setCredentialForm({ username: business.username || '', password: '' }) }}>Edit login</Button>
                    <Button size="sm" variant="ghost" onClick={() => void issueApiKey(business)} disabled={saving}><KeyRound className="mr-1.5 h-4 w-4" />New API key</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground"><Building2 className="h-9 w-9 opacity-50" /><p>No business accounts yet.</p></CardContent></Card>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Create business</DialogTitle><DialogDescription>Create a separate login and WhatsApp workspace.</DialogDescription></DialogHeader>
          <form onSubmit={createBusiness} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="business-name">Business name</Label><Input id="business-name" value={form.name} onChange={event => updateForm('name', event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="business-phone">Contact phone (optional)</Label><Input id="business-phone" inputMode="tel" value={form.phone} onChange={event => updateForm('phone', event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="business-email">Contact email</Label><Input id="business-email" type="email" value={form.email} onChange={event => updateForm('email', event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="business-address">Address</Label><Input id="business-address" value={form.address} onChange={event => updateForm('address', event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="business-username">Login username</Label><Input id="business-username" type="email" value={form.username} onChange={event => updateForm('username', event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="business-password">Temporary password</Label><Input id="business-password" type="password" minLength={12} value={form.password} onChange={event => updateForm('password', event.target.value)} required /></div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create business</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editBusiness)} onOpenChange={open => !open && setEditBusiness(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit business details</DialogTitle></DialogHeader>
          {editBusiness && <form onSubmit={saveBusiness} className="space-y-3">
            <div className="space-y-2"><Label>Name</Label><Input value={editBusiness.name} onChange={event => setEditBusiness(current => current && ({ ...current, name: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>Contact phone</Label><Input value={editBusiness.phone || ''} onChange={event => setEditBusiness(current => current && ({ ...current, phone: event.target.value || null }))} /></div>
            <div className="space-y-2"><Label>Contact email</Label><Input type="email" value={editBusiness.email || ''} onChange={event => setEditBusiness(current => current && ({ ...current, email: event.target.value || null }))} /></div>
            <div className="space-y-2"><Label>Address</Label><Input value={editBusiness.address || ''} onChange={event => setEditBusiness(current => current && ({ ...current, address: event.target.value || null }))} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={editBusiness.notes || ''} onChange={event => setEditBusiness(current => current && ({ ...current, notes: event.target.value || null }))} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(editBusiness.is_active)} onChange={event => setEditBusiness(current => current && ({ ...current, is_active: event.target.checked ? 1 : 0 }))} />Business active</label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditBusiness(null)}>Cancel</Button><Button type="submit" disabled={saving}>Save details</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(credentialsBusiness)} onOpenChange={open => !open && setCredentialsBusiness(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Business login</DialogTitle><DialogDescription>A new password is marked temporary and must be changed at next sign-in.</DialogDescription></DialogHeader>
          <form onSubmit={saveBusinessCredentials} className="space-y-3">
            <div className="space-y-2"><Label>Username</Label><Input type="email" value={credentialForm.username} onChange={event => setCredentialForm(current => ({ ...current, username: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>New temporary password (optional)</Label><Input type="password" minLength={12} value={credentialForm.password} onChange={event => setCredentialForm(current => ({ ...current, password: event.target.value }))} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCredentialsBusiness(null)}>Cancel</Button><Button type="submit" disabled={saving}>Save login</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(apiKeyDialog)} onOpenChange={open => !open && setApiKeyDialog('')}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy the business API key</DialogTitle><DialogDescription>This key is shown only once. Store it securely for external integrations.</DialogDescription></DialogHeader>
          <div className="flex gap-2"><Input readOnly value={apiKeyDialog} className="font-mono" /><Button size="icon" onClick={() => void copyKey()} aria-label="Copy API key"><Copy className="h-4 w-4" /></Button></div>
          <DialogFooter><Button onClick={() => setApiKeyDialog('')}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}