import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Layout } from '@/components/Layout'
import { ApiKeySetup } from '@/components/ApiKeySetup'
import { Dashboard } from '@/pages/Dashboard'
import { Connection } from '@/pages/Connection'
import { Messages } from '@/pages/Messages'
import { History } from '@/pages/History'
import { Chats } from '@/pages/Chats'
import { Logs } from '@/pages/Logs'
import { AccountSettings as Settings } from '@/pages/AccountSettings'
import { AutoReply } from '@/pages/AutoReply'
import { ApiDocs } from '@/pages/ApiDocs'
import { api, type AuthResponse } from '@/lib/api'
import { ForcePasswordChange } from '@/components/ForcePasswordChange'
import { SuperAdmin } from '@/pages/SuperAdmin'

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    const checkAuth = async () => {
      try {
        const current = await api.getCurrentUser()
        if (active) setAuth(current)
      } catch {
        if (active) setAuth(null)
      } finally {
        if (active) setChecking(false)
      }
    }
    void checkAuth()
    return () => { active = false }
  }, [])

  const refreshAuth = async () => {
    const current = await api.getCurrentUser()
    setAuth(current)
  }

  const handleLogout = async () => {
    await api.logout()
    setAuth(null)
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!auth) {
    return (
      <>
        <ApiKeySetup onSuccess={setAuth} />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  if (auth.user.mustChangePassword) {
    return <ForcePasswordChange username={auth.user.username} onComplete={refreshAuth} />
  }

  if (auth.user.role === 'superadmin' && !auth.user.impersonating) {
    return <SuperAdmin user={auth.user} onLogout={handleLogout} onImpersonate={refreshAuth} />
  }

  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={(
            <Layout
              user={auth.user}
              business={auth.business}
              onLogout={handleLogout}
              onExitImpersonation={async () => { await api.stopImpersonation(); await refreshAuth() }}
            />
          )}>
            <Route index element={<Dashboard />} />
            <Route path="connection" element={<Connection />} />
            <Route path="messages" element={<Messages />} />
            <Route path="history" element={<History />} />
            <Route path="chats" element={<Chats />} />
            <Route path="api-docs" element={<ApiDocs />} />
            <Route path="auto-reply" element={<AutoReply />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  )
}

export default App
