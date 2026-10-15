import { useState, useEffect } from 'react'
import { 
  MessageSquare, 
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Search,
  User,
  Clock,
  CheckCheck
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { LogEntry } from '@/lib/api'
import { cn } from '@/lib/utils'

interface MessageLog extends LogEntry {
  details: {
    to?: string
    from?: string
    messageId?: string
    preview?: string
    content?: string
    caption?: string
    type?: string
    fileName?: string
    fileType?: string
    mimeType?: string
  }
}

function formatContact(jid: string, resolvedJids: Record<string, string>): string {
  const resolvedJid = resolvedJids[jid] || jid
  const identifier = resolvedJid?.split('@')[0]?.replace(/:\d+$/, '') || 'Unknown'
  if (/^\d+$/.test(identifier) && !resolvedJid.endsWith('@lid')) {
    return `+${identifier}`
  }
  return resolvedJid.endsWith('@lid') ? `WhatsApp ID ${identifier}` : identifier
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  
  if (isToday) {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    })
  }
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

function MessageCard({ message, type, resolvedJids }: { message: MessageLog; type: 'out' | 'in'; resolvedJids: Record<string, string> }) {
  const isOutgoing = type === 'out'
  const contactJid = isOutgoing ? message.details.to || '' : message.details.from || ''
  const contact = formatContact(contactJid, resolvedJids)

  // Enhanced content extraction with file type information
  let content = ''
  if (message.details.fileName && message.details.fileType) {
    // File message - show file info
    const fileEmoji = {
      'image': '🖼️',
      'video': '🎬',
      'audio': '🎵',
      'document': '📄'
    }[message.details.fileType] || '📎'
    content = `${fileEmoji} [${message.details.fileType}: ${message.details.fileName}]`
    if (message.details.caption) {
      content += ` ${message.details.caption}`
    } else if (message.details.preview) {
      content += ` ${message.details.preview}`
    } else if (message.details.content) {
      content += ` ${message.details.content}`
    }
  } else {
    // Text message - use preview, content, or caption
    const autoReplyContent = message.message.startsWith('Auto-replied: ')
      ? message.message.slice('Auto-replied: '.length)
      : ''
    content = message.details.preview || message.details.content || message.details.caption || autoReplyContent
  }
  
  return (
    <div className={cn(
      "flex gap-3 p-4 rounded-xl border transition-all duration-200 hover:shadow-md",
      isOutgoing ? "bg-primary/5 border-primary/20" : "bg-card"
    )}>
      {/* Avatar */}
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
        isOutgoing ? "bg-primary/20" : "bg-muted"
      )}>
        {isOutgoing ? (
          <ArrowUpRight className="w-5 h-5 text-primary" />
        ) : (
          <ArrowDownLeft className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{contact}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {isOutgoing ? 'Sent' : 'Received'}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime(message.timestamp)}
          </span>
        </div>
        
        {/* Message content */}
        <p className="text-sm text-foreground/80 break-words">
          {content || <span className="text-muted-foreground italic">[No text content]</span>}
        </p>
        
        {/* Message ID */}
        {message.details.messageId && (
          <div className="flex items-center gap-2 mt-2">
            <CheckCheck className="w-3 h-3 text-primary" />
            <code className="text-[10px] text-muted-foreground font-mono">
              {message.details.messageId}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

export function History() {
  const [outgoing, setOutgoing] = useState<MessageLog[]>([])
  const [incoming, setIncoming] = useState<MessageLog[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('outgoing')
  const [resolvedJids, setResolvedJids] = useState<Record<string, string>>({})

  const fetchMessages = async () => {
    setLoading(true)
    try {
      const [outRes, inRes] = await Promise.all([
        api.getLogs(100, 'message_out'),
        api.getLogs(100, 'message_in')
      ])
      const nextOutgoing = outRes.logs as MessageLog[]
      const nextIncoming = inRes.logs as MessageLog[]
      setOutgoing(nextOutgoing)
      setIncoming(nextIncoming)

      const jids = [...new Set([
        ...nextOutgoing.map(message => message.details.to),
        ...nextIncoming.map(message => message.details.from)
      ].filter((jid): jid is string => Boolean(jid && jid.endsWith('@lid'))))]
      try {
        const result = await api.resolveJids(jids)
        setResolvedJids(result.mappings)
      } catch {
        setResolvedJids({})
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [])

  // Filter messages by search term
  const filterMessages = (messages: MessageLog[]) => {
    if (!searchTerm) return messages
    const term = searchTerm.toLowerCase()
    return messages.filter(m => 
      m.details.to?.toLowerCase().includes(term) ||
      m.details.from?.toLowerCase().includes(term) ||
      m.details.preview?.toLowerCase().includes(term) ||
      m.details.content?.toLowerCase().includes(term) ||
      resolvedJids[m.details.to || m.details.from || '']?.toLowerCase().includes(term)
    )
  }

  const filteredOutgoing = filterMessages(outgoing)
  const filteredIncoming = filterMessages(incoming)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in-up">
        <h1 className="text-3xl font-bold tracking-tight">Message History</h1>
        <p className="text-muted-foreground mt-1">
          View all sent and received messages
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up stagger-1">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <ArrowUpRight className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{outgoing.length}</p>
                <p className="text-xs text-muted-foreground">Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <ArrowDownLeft className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{incoming.length}</p>
                <p className="text-xs text-muted-foreground">Received</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{outgoing.length + incoming.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {new Set([
                    ...outgoing.map(m => m.details.to),
                    ...incoming.map(m => m.details.from)
                  ].filter(Boolean)).size}
                </p>
                <p className="text-xs text-muted-foreground">Contacts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Messages */}
      <Card className="animate-fade-in-up stagger-2">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Messages
              </CardTitle>
              <CardDescription>
                All WhatsApp messages sent and received via API
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search messages..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
              <Button variant="outline" size="icon" onClick={fetchMessages} disabled={loading}>
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="outgoing" className="gap-2">
                <ArrowUpRight className="w-4 h-4" />
                Sent ({filteredOutgoing.length})
              </TabsTrigger>
              <TabsTrigger value="incoming" className="gap-2">
                <ArrowDownLeft className="w-4 h-4" />
                Received ({filteredIncoming.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="outgoing" className="mt-4">
              <ScrollArea className="h-[500px] pr-4">
                {filteredOutgoing.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <ArrowUpRight className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No sent messages</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Messages sent via API will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredOutgoing.map((msg) => (
                      <MessageCard key={msg.id} message={msg} type="out" resolvedJids={resolvedJids} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="incoming" className="mt-4">
              <ScrollArea className="h-[500px] pr-4">
                {filteredIncoming.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <ArrowDownLeft className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No received messages</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Incoming messages will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredIncoming.map((msg) => (
                      <MessageCard key={msg.id} message={msg} type="in" resolvedJids={resolvedJids} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
