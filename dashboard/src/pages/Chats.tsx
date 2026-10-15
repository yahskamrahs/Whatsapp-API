import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeft,
  CheckCheck,
  Clock3,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useStatus } from '@/hooks/useApi'
import { api, type LogEntry } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type ChatDirection = 'incoming' | 'outgoing'

interface ChatMessage extends LogEntry {
  direction: ChatDirection
  content: string
}

interface ContactRef {
  key: string
  jid: string
  phoneNumber: string | null
  label: string
}

interface Conversation extends ContactRef {
  messages: ChatMessage[]
  latestAt: number
  preview: string
}

interface MessageDetails {
  to?: string
  from?: string
  content?: string
  preview?: string
  caption?: string
  fileName?: string
  fileType?: string
  trigger?: string
}

function cleanPhoneNumber(value: string): string {
  return value.replace(/\D/g, '')
}

function contactFromJid(jid: string, resolvedJids: Record<string, string>): ContactRef {
  const resolvedJid = resolvedJids[jid] || jid
  const [user = '', server = ''] = resolvedJid.split('@')
  const identifier = user.replace(/:\d+$/, '')
  const phoneNumber = /^\d+$/.test(identifier) && server !== 'lid' ? identifier : null

  return {
    key: phoneNumber ? `phone:${phoneNumber}` : `jid:${server}:${identifier}`,
    jid: resolvedJid,
    phoneNumber,
    label: phoneNumber ? `+${phoneNumber}` : server === 'lid' ? `WhatsApp ID ${identifier}` : identifier || 'Unknown contact'
  }
}

function messageContent(entry: LogEntry, details: MessageDetails): string {
  if (details.fileName) {
    const fileDescription = `[${details.fileType || 'file'}: ${details.fileName}]`
    return details.caption ? `${fileDescription} ${details.caption}` : fileDescription
  }

  if (details.content || details.preview || details.caption) {
    return details.content || details.preview || details.caption || ''
  }

  if (entry.message.startsWith('Auto-replied: ')) {
    return entry.message.slice('Auto-replied: '.length)
  }

  return ''
}

function timestampValue(value: string): number {
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function initials(label: string): string {
  const digits = label.replace(/\D/g, '')
  if (digits.length >= 2) return digits.slice(-2)
  return label.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function buildConversations(
  logs: Array<{ entry: LogEntry; direction: ChatDirection }>,
  resolvedJids: Record<string, string>,
  manualContacts: ContactRef[]
): Conversation[] {
  const grouped = new Map<string, Conversation>()

  for (const { entry, direction } of logs) {
    const details = entry.details as MessageDetails
    const peerJid = direction === 'outgoing' ? details.to : details.from
    if (!peerJid) continue

    const contact = contactFromJid(peerJid, resolvedJids)
    const message: ChatMessage = {
      ...entry,
      direction,
      content: messageContent(entry, details)
    }
    const latestAt = timestampValue(entry.timestamp)
    const conversation = grouped.get(contact.key) || {
      ...contact,
      messages: [],
      latestAt: 0,
      preview: ''
    }

    conversation.messages.push(message)
    if (latestAt >= conversation.latestAt) {
      conversation.latestAt = latestAt
      conversation.preview = message.content || 'Attachment'
    }
    grouped.set(contact.key, conversation)
  }

  for (const contact of manualContacts) {
    if (!grouped.has(contact.key)) {
      grouped.set(contact.key, { ...contact, messages: [], latestAt: 0, preview: 'Start a conversation' })
    }
  }

  return [...grouped.values()]
    .map(conversation => ({
      ...conversation,
      messages: [...conversation.messages].sort((a, b) => timestampValue(a.timestamp) - timestampValue(b.timestamp))
    }))
    .sort((a, b) => b.latestAt - a.latestAt || a.label.localeCompare(b.label))
}

export function Chats() {
  const { data: status } = useStatus()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [manualContacts, setManualContacts] = useState<ContactRef[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const isConnected = status?.connection.connected === true
  const activeConversation = conversations.find(conversation => conversation.key === activeKey)
  const filteredConversations = conversations.filter(conversation =>
    `${conversation.label} ${conversation.preview}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const [sent, received] = await Promise.all([
        api.getLogs(100, 'message_out'),
        api.getLogs(100, 'message_in')
      ])
      const logs = [
        ...sent.logs.map(entry => ({ entry, direction: 'outgoing' as const })),
        ...received.logs.map(entry => ({ entry, direction: 'incoming' as const }))
      ]
      const jids = [...new Set(logs.flatMap(({ entry, direction }) => {
        const details = entry.details as MessageDetails
        const jid = direction === 'outgoing' ? details.to : details.from
        return jid?.endsWith('@lid') ? [jid] : []
      }))]
      const resolved = jids.length ? await api.resolveJids(jids) : { mappings: {} }
      setConversations(buildConversations(logs, resolved.mappings, manualContacts))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
    }
  }, [manualContacts])

  useEffect(() => {
    void fetchMessages()
    const interval = window.setInterval(() => void fetchMessages(), 8000)
    return () => window.clearInterval(interval)
  }, [fetchMessages])

  const handleOpenNewChat = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const phoneNumber = cleanPhoneNumber(newNumber)
    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
      toast.error('Enter a valid number with its country code')
      return
    }

    const contact: ContactRef = {
      key: `phone:${phoneNumber}`,
      jid: `${phoneNumber}@s.whatsapp.net`,
      phoneNumber,
      label: `+${phoneNumber}`
    }
    setManualContacts(current => [contact, ...current.filter(item => item.key !== contact.key)])
    setConversations(current => current.some(item => item.key === contact.key)
      ? current
      : [{ ...contact, messages: [], latestAt: 0, preview: 'Start a conversation' }, ...current])
    setActiveKey(contact.key)
    setNewNumber('')
    setNewChatOpen(false)
  }

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !activeConversation) return
    if (!isConnected) {
      toast.error('WhatsApp is not connected')
      return
    }
    if (!activeConversation.phoneNumber) {
      toast.error('A phone number is not available for this WhatsApp ID')
      return
    }

    setSending(true)
    try {
      const result = await api.sendMessage(activeConversation.phoneNumber, text)
      if (!result.success) throw new Error(result.error || 'Failed to send message')
      setDraft('')
      await fetchMessages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chats</h1>
          <p className="mt-1 text-muted-foreground">Recent messages sent and received by this dashboard</p>
        </div>
        <Button onClick={() => setNewChatOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New chat
        </Button>
      </div>

      {!isConnected && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          WhatsApp is disconnected. You can review recent conversations, but sending is unavailable.
        </div>
      )}

      <section className="flex h-[calc(100dvh-230px)] min-h-[520px] max-h-[820px] overflow-hidden rounded-xl border bg-card shadow-sm">
        <aside className={cn('flex w-full shrink-0 flex-col border-r md:w-[320px] lg:w-[360px]', activeKey && 'hidden md:flex')}>
          <div className="space-y-3 border-b p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Conversations</h2>
              <Button variant="ghost" size="icon" onClick={() => void fetchMessages()} disabled={loading} aria-label="Refresh conversations">
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search chats" className="pl-9" />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {loading && conversations.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : filteredConversations.length ? (
              <div className="divide-y">
                {filteredConversations.map(conversation => (
                  <button
                    key={conversation.key}
                    type="button"
                    onClick={() => setActiveKey(conversation.key)}
                    className={cn('flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/60', activeKey === conversation.key && 'bg-primary/5')}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">
                      {initials(conversation.label)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{conversation.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {conversation.messages.length ? formatTime(conversation.messages.at(-1)?.timestamp || '') : ''}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-muted-foreground">{conversation.preview}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-52 flex-col items-center justify-center gap-2 px-5 text-center text-muted-foreground">
                <MessagesSquare className="h-7 w-7 opacity-50" />
                <p className="text-sm">{searchTerm ? 'No matching chats' : 'No recent messages yet'}</p>
                {!searchTerm && <p className="text-xs">Start a chat with a phone number.</p>}
              </div>
            )}
          </ScrollArea>
        </aside>

        <section className={cn('min-w-0 flex-1 flex-col', activeKey ? 'flex' : 'hidden md:flex')}>
          {activeConversation ? (
            <>
              <header className="flex h-[68px] shrink-0 items-center gap-3 border-b px-4">
                <Button className="md:hidden" variant="ghost" size="icon" onClick={() => setActiveKey('')} aria-label="Back to conversations">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">
                  {initials(activeConversation.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{activeConversation.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{activeConversation.phoneNumber || 'WhatsApp contact'}</span>
                </span>
              </header>

              <ScrollArea className="min-h-0 flex-1 bg-muted/30">
                {activeConversation.messages.length ? (
                  <div className="flex min-h-full flex-col gap-3 p-4 sm:p-6">
                    {activeConversation.messages.map(message => (
                      <div key={message.id} className={cn('flex max-w-[88%] flex-col gap-1 sm:max-w-[75%]', message.direction === 'outgoing' ? 'self-end' : 'self-start')}>
                        <div className={cn(
                          'rounded-2xl px-3.5 py-2.5 shadow-sm',
                          message.direction === 'outgoing'
                            ? 'rounded-br-sm bg-primary text-primary-foreground'
                            : 'rounded-bl-sm border bg-card'
                        )}>
                          <p className="whitespace-pre-wrap break-words text-sm">{message.content || '[No text content]'}</p>
                          <span className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', message.direction === 'outgoing' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                            {message.direction === 'incoming' && <ArrowDownLeft className="h-3 w-3" />}
                            <Clock3 className="h-3 w-3" />
                            {formatTime(message.timestamp)}
                            {message.direction === 'outgoing' && <CheckCheck className="h-3 w-3" />}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                    <MessageCircle className="h-8 w-8 opacity-50" />
                    <p className="text-sm">No messages in this conversation yet</p>
                    <p className="text-xs">Send a message to start the conversation.</p>
                  </div>
                )}
              </ScrollArea>

              <form onSubmit={handleSend} className="flex shrink-0 items-end gap-2 border-t bg-card p-3 sm:p-4">
                <textarea
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  rows={1}
                  disabled={!isConnected || sending || !activeConversation.phoneNumber}
                  placeholder={activeConversation.phoneNumber ? 'Type a message' : 'A phone number is unavailable for this contact'}
                  aria-label="Message text"
                  className="max-h-28 min-h-10 flex-1 resize-y rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button type="submit" size="icon" disabled={!draft.trim() || !isConnected || sending || !activeConversation.phoneNumber} aria-label="Send message">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <MessagesSquare className="h-12 w-12 opacity-40" />
              <p className="font-medium">Select a conversation</p>
              <p className="max-w-xs text-sm">Choose a recent chat or start a new one with a phone number.</p>
            </div>
          )}
        </section>
      </section>

      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new chat</DialogTitle>
            <DialogDescription>Enter the phone number with its country code.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOpenNewChat} className="space-y-4">
            <div className="relative">
              <Input
                autoFocus
                inputMode="tel"
                value={newNumber}
                onChange={event => setNewNumber(event.target.value)}
                placeholder="919075823589"
                aria-label="Phone number with country code"
              />
              {newNumber && (
                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 h-8 w-8" onClick={() => setNewNumber('')} aria-label="Clear phone number">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewChatOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={cleanPhoneNumber(newNumber).length < 8 || cleanPhoneNumber(newNumber).length > 15}>Open chat</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}