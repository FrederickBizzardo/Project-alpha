import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { 
  Plus, MessageSquare, Trash2, Edit2, Check, X, 
  Menu, Copy, Globe, Cpu, Cloud, Settings, 
  ArrowUp
} from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs))
}

interface ChatHistory {
  id: number;
  title: string;
  created_at: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Detect host for Termux (mobile browser access)
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:8000' : `http://${window.location.hostname}:8000`;

const SUGGESTIONS = [
  "Explain quantum computing in simple terms",
  "Write a polite email to decline a meeting",
  "Help me brainstorm names for a new tech startup",
  "What are some minimalistic home decor ideas?"
];

const CodeBlock = ({ node, className, children, ...props }: any) => {
  const isInline = !className;
  const code = String(children).replace(/\n$/, '');
  
  if (isInline) {
    return <code className="bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono text-blue-300">{children}</code>;
  }

  return (
    <div className="relative group my-4 rounded-xl bg-[#0f0f12] border border-white/10 overflow-hidden w-full">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
          {className?.replace('language-', '') || 'text'}
        </span>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(code);
            alert("Code copied!");
          }} 
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
        >
          <Copy size={12} /> Copy
        </button>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <SyntaxHighlighter
          language={className?.replace('language-', '') || 'text'}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: '1.25rem',
            fontSize: '13px',
            lineHeight: '1.6',
            background: 'transparent',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'inherit',
            }
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

function App() {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [currentResponse, setCurrentResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatId, setChatId] = useState<number | null>(null)
  const [history, setHistory] = useState<ChatHistory[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [provider, setProvider] = useState<'auto' | 'local' | 'cloud'>('auto')
  const [health, setHealth] = useState({ ollama: false, groq: false })
  const [editingChatId, setEditingChatId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchHistory();
    checkHealth();
    const interval = setInterval(checkHealth, 20000);
    return () => clearInterval(interval);
  }, [])

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentResponse])

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`)
      const data = await res.json()
      setHealth({ ollama: data.ollama_online, groq: data.groq_ready })
    } catch { /* silent */ }
  }

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats`)
      const data = await res.json()
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) { console.error('Failed to fetch history', err) }
  }

  const loadChat = async (id: number) => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API_BASE}/api/chats/${id}`)
      const data = await res.json()
      setMessages(Array.isArray(data) ? data : [])
      setChatId(id)
      setSidebarOpen(false)
    } catch (err) { console.error('Failed to load chat', err) }
    finally { setIsLoading(false) }
  }

  const deleteChat = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;
    try {
      await fetch(`${API_BASE}/api/chats/${id}`, { method: 'DELETE' });
      if (chatId === id) startNewChat();
      fetchHistory();
    } catch (err) { console.error('Delete failed', err) }
  }

  const renameChat = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/chats/${id}?title=${encodeURIComponent(editTitle)}`, { 
        method: 'PATCH' 
      });
      setEditingChatId(null);
      fetchHistory();
    } catch (err) { console.error('Rename failed', err) }
  }

  const startNewChat = () => {
    setChatId(null)
    setMessages([])
    setPrompt('')
    setSidebarOpen(false)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  }

  const handleSubmit = async (e: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const userMessage = customPrompt || prompt.trim();
    if (!userMessage || isLoading) return;

    setPrompt('')
    setMessages(prev => [...(prev || []), { role: 'user', content: userMessage }])
    
    if (abortControllerRef.current) abortControllerRef.current.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsLoading(true)
    setCurrentResponse('')
    
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMessage, provider, chat_id: chatId }),
        signal: abortController.signal
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      
      let fullText = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setCurrentResponse(fullText)
      }
      
      setMessages(prev => [...(prev || []), { role: 'assistant', content: fullText }])
      setCurrentResponse('')
      
      if (!chatId) {
        fetchHistory();
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Chat error:", error);
        setMessages(prev => [...(prev || []), { role: 'assistant', content: `[Error: ${error.message}]` }])
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      if (currentResponse) {
        setMessages(prev => [...(prev || []), { role: 'assistant', content: currentResponse }]);
        setCurrentResponse('');
      }
    }
  }

  return (
      <div className="flex h-screen bg-[#09090b] text-[#fafafa] font-sans selection:bg-blue-500/30 overflow-hidden">      {/* Sidebar Overlay for Mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-[70] w-72 bg-[#121214] border-r border-white/5 transition-transform duration-300 md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          <div className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-600/20">A</div>
              <span className="font-bold tracking-tight text-lg">Project Alpha</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="md:hidden p-2 hover:bg-white/5 rounded-lg text-gray-400">
              <X size={20} />
            </button>
          </div>

          <div className="px-3">
            <button 
              onClick={startNewChat}
              className="flex items-center gap-3 w-full p-3.5 mb-6 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all text-sm font-medium"
            >
              <Plus size={18} className="text-gray-400" />
              New Conversation
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 py-1">Recent Chats</p>
            {(history || []).map(chat => (
              <div 
                key={chat.id} 
                onClick={() => loadChat(chat.id)}
                className={cn(
                  "group relative flex items-center gap-3 w-full p-3 rounded-xl text-sm transition-all cursor-pointer border border-transparent",
                  chatId === chat.id ? "bg-white/10 border-white/5 text-white shadow-sm" : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
                )}
              >
                <MessageSquare size={16} className={cn("shrink-0", chatId === chat.id ? "text-blue-500" : "text-gray-500")} />
                
                {editingChatId === chat.id ? (
                  <input 
                    autoFocus
                    className="bg-transparent border-none outline-none w-full text-white"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.key === 'Enter' && renameChat(chat.id, e as any)}
                  />
                ) : (
                  <span className="truncate flex-1 pr-12">{chat.title}</span>
                )}

                <div className="absolute right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                  {editingChatId === chat.id ? (
                    <button onClick={(e) => renameChat(chat.id, e)} className="p-1 hover:text-emerald-500"><Check size={14} /></button>
                  ) : (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setEditingChatId(chat.id); setEditTitle(chat.title); }} className="p-1 hover:text-white"><Edit2 size={14} /></button>
                      <button onClick={(e) => deleteChat(chat.id, e)} className="p-1 hover:text-rose-500"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-black/20 border-t border-white/5">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-medium px-1">
                <span className="text-gray-500 flex items-center gap-1.5"><Cpu size={12} /> Local (Ollama)</span>
                <div className={cn("w-2 h-2 rounded-full", health.ollama ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500")} />
              </div>
              <div className="flex items-center justify-between text-[11px] font-medium px-1">
                <span className="text-gray-500 flex items-center gap-1.5"><Cloud size={12} /> Cloud (Groq)</span>
                <div className={cn("w-2 h-2 rounded-full", health.groq ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500")} />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-b from-[#09090b] to-[#0d0d10]">
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-white/5 z-50 backdrop-blur-md bg-[#09090b]/80">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 -ml-2 hover:bg-white/5 rounded-lg text-gray-400">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-white/5 px-3 py-1.5 rounded-full border border-white/5 text-[12px] hover:bg-white/10 transition-colors cursor-pointer">
              <select 
                value={provider} 
                onChange={(e) => setProvider(e.target.value as any)}
                className="bg-transparent border-none focus:ring-0 cursor-pointer text-gray-200 outline-none font-medium"
              >
                <option value="auto" className="bg-[#18181b]">Auto Intelligence</option>
                <option value="local" className="bg-[#18181b]">Local Engine</option>
                <option value="cloud" className="bg-[#18181b]">Cloud Engine</option>
              </select>
            </div>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold">JD</div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 pb-40 custom-scrollbar overflow-x-hidden">
          <div className="max-w-3xl mx-auto">
            {messages.length === 0 && !currentResponse ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-in fade-in duration-700 slide-in-from-bottom-4">
                <div className="w-16 h-16 rounded-3xl bg-blue-600 flex items-center justify-center mb-10 shadow-2xl shadow-blue-600/20 rotate-12">
                  <ArrowUp size={32} className="text-white -rotate-12" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">Welcome, I am Alpha.</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
                  {SUGGESTIONS.map((s, idx) => (
                    <button 
                      key={idx} 
                      onClick={(e) => handleSubmit(e, s)}
                      className="text-left p-4 rounded-2xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.08] hover:border-white/10 transition-all text-xs text-gray-400 hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-10 pb-10">
                {(messages || []).map((msg, idx) => (
                  <div key={idx} className={cn("flex flex-col animate-in fade-in duration-300", msg?.role === 'user' ? "items-end" : "items-start")}>
                    <div className={cn("flex gap-3 md:gap-4 max-w-[95%] sm:max-w-[85%] w-full", msg?.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                      {msg?.role === 'assistant' && (
                        <div className="w-8 h-8 shrink-0 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-xs mt-1 shadow-lg shadow-blue-600/10">A</div>
                      )}
                      <div className={cn("relative group px-5 py-3 rounded-2xl leading-relaxed text-[15px] min-w-0 break-words", msg?.role === 'user' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/5" : "bg-white/[0.03] border border-white/[0.05] text-gray-200")}>
                        {msg?.role === 'user' ? (
                          <p className="whitespace-pre-wrap">{msg?.content || ""}</p>
                        ) : (
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown components={{ code: CodeBlock }}>{msg?.content || ""}</ReactMarkdown>
                            <button 
                              onClick={() => copyToClipboard(msg?.content || "")} 
                              className="flex items-center gap-1.5 text-[11px] mt-4 opacity-50 hover:opacity-100 transition-opacity text-gray-500 hover:text-white"
                            >
                              <Copy size={12} /> Copy Entire Message
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {currentResponse && (
                  <div className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex gap-3 md:gap-4 max-w-[95%] sm:max-w-[85%] w-full flex-row">
                      <div className="w-8 h-8 shrink-0 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-xs mt-1 shadow-lg shadow-blue-600/10">A</div>
                      <div className="bg-white/[0.03] border border-white/[0.05] px-5 py-3 rounded-2xl prose prose-invert prose-sm max-w-none text-gray-200 text-[15px] leading-[1.7] relative min-w-0 break-words flex-1">
                        <ReactMarkdown components={{ code: CodeBlock }}>{currentResponse || ""}</ReactMarkdown>
                        <span className="inline-block w-2.5 h-4.5 ml-1 bg-white/70 animate-[pulse_0.8s_infinite] align-middle rounded-sm shadow-[0_0_8px_rgba(255,255,255,0.3)]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        <div className="absolute bottom-0 w-full z-40 bg-gradient-to-t from-[#09090b] via-[#09090b]/95 to-transparent pb-8 md:pb-12 pt-10">
          <div className="max-w-3xl mx-auto px-4 md:px-0">
            {isLoading && (
              <div className="flex justify-center mb-4 animate-in fade-in slide-in-from-bottom-2">
                <button 
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-medium hover:bg-white/10 transition-all text-gray-300"
                >
                  <X size={14} /> Stop Generating
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="relative flex flex-col items-center">
              <div className="w-full relative group">
                <textarea 
                  rows={1}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e as any);
                    }
                  }}
                  placeholder="Ask Alpha anything..."
                  disabled={isLoading}
                  className="w-full bg-[#1c1c1f]/80 backdrop-blur-xl border border-white/[0.05] rounded-3xl px-6 py-5 pr-16 text-[15px] text-white focus:outline-none focus:border-blue-500/30 transition-all resize-none min-h-[64px] max-h-48 custom-scrollbar"
                />
                <button type="submit" disabled={!prompt.trim() || isLoading} className="absolute right-3 bottom-3 p-2.5 rounded-2xl transition-all shadow-xl bg-blue-600 text-white disabled:opacity-30">
                  <ArrowUp size={20} strokeWidth={2.5} />
                </button>
              </div>
              <p className="mt-4 opacity-30 text-[10px]">Project Alpha v1.0 • Built for professional-grade productivity</p>
            </form>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export default App
