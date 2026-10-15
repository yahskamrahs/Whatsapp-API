import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Link2,
  MessageSquare,
  ScrollText,
  Settings,
  Menu,
  X,
  Smartphone,
  History,
  Bot,
  MessagesSquare
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { useHealth } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import type { AuthUser, BusinessInfo } from '@/lib/api'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/connection', icon: Link2, label: 'Connection' },
  { to: '/messages', icon: MessageSquare, label: 'Send Message' },
  { to: '/history', icon: History, label: 'Message History' },
  { to: '/chats', icon: MessagesSquare, label: 'Chats' },
  { to: '/auto-reply', icon: Bot, label: 'Auto Reply' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function NavItem({ to, icon: Icon, label, onClick }: { 
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
          'hover:bg-sidebar-accent group',
          isActive 
            ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20' 
            : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
        )
      }
    >
      <Icon className="w-5 h-5 transition-transform group-hover:scale-110" />
      <span className="font-medium">{label}</span>
    </NavLink>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: health } = useHealth()
  const isConnected = health?.whatsapp_connected

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30">
            <Smartphone className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-sidebar-foreground">Baileys</h1>
            <p className="text-xs text-sidebar-foreground/50">WhatsApp Dashboard</p>
          </div>
        </div>
      </div>

      <Separator className="bg-sidebar-border/50 mx-4" />

      {/* Status indicator */}
      <div className="px-4 py-4">
        <div className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl",
          isConnected ? "bg-primary/20" : "bg-destructive/20"
        )}>
          <div className={cn(
            "w-3 h-3 rounded-full",
            isConnected ? "bg-primary animate-pulse-glow" : "bg-destructive"
          )} />
          <div>
            <p className={cn(
              "text-sm font-medium",
              isConnected ? "text-primary" : "text-destructive"
            )}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </p>
            {health?.connected_number && (
              <p className="text-xs text-sidebar-foreground/50">
                +{health.connected_number}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4">
        <div className="px-4 py-3 rounded-xl bg-sidebar-accent/50 text-center">
          <p className="text-xs text-sidebar-foreground/50">
            Powered by Baileys
          </p>
        </div>
      </div>
    </div>
  )
}

interface LayoutProps {
  user: AuthUser
  business: BusinessInfo | null
  onLogout: () => void
  onExitImpersonation: () => void
}

export function Layout({ user, business, onLogout, onExitImpersonation }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 bg-sidebar border-r border-sidebar-border flex-col">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild className="lg:hidden fixed top-4 left-4 z-50">
          <Button variant="outline" size="icon" className="bg-background shadow-lg">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{business?.name || 'Business workspace'}</p>
              <p className="truncate text-xs text-muted-foreground">Signed in as {user.username}</p>
            </div>
            <div className="flex items-center gap-2">
              {user.impersonating && (
                <Button size="sm" variant="outline" onClick={onExitImpersonation}>Return to Super Admin</Button>
              )}
              <Button size="sm" variant="ghost" onClick={onLogout}>Sign out</Button>
            </div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
