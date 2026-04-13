import React, { useState, useEffect, useRef } from 'react'

function App() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [provider, setProvider] = useState<'auto' | 'local' | 'cloud'>('auto')
  const [health, setHealth] = useState({
    ollama: false,
    groq: false,
    checking: true
  })
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:8000/health')
        const data = await res.json()
        setHealth({
          ollama: data.ollama_online,
          groq: data.groq_ready,
          checking: false
        })
      } catch {
        setHealth(prev => ({ ...prev, checking: false }))
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 10000) // Re-check every 10s
    return () => clearInterval(interval)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return

    if (abortControllerRef.current) abortControllerRef.current.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setResponse('') 
    setIsLoading(true)
    
    try {
      const res = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, provider }),
        signal: abortController.signal
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setResponse((prev) => prev + chunk)
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setResponse((prev) => prev + `\n[Error: ${error.message}]`)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }

  return (
    <div style={{ 
      maxWidth: '850px', 
      margin: '0 auto', 
      padding: '40px 20px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    }}>
      <header style={{ marginBottom: '30px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '15px', letterSpacing: '-0.02em' }}>AI Universal Chat</h1>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <span style={{ fontWeight: 600, color: '#666' }}>Engine:</span>
            <select 
              value={provider} 
              onChange={(e) => setProvider(e.target.value as any)}
              style={{ 
                padding: '6px 12px', 
                borderRadius: '6px', 
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                cursor: 'pointer'
              }}
            >
              <option value="auto">Auto (Fallback to Cloud)</option>
              <option value="local">Local (Ollama)</option>
              <option value="cloud">Cloud (Groq)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: health.ollama ? '#10b981' : '#ef4444' }} />
              <span style={{ color: health.ollama ? '#10b981' : '#666' }}>Local: {health.ollama ? 'Online' : 'Offline'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: health.groq ? '#10b981' : '#ef4444' }} />
              <span style={{ color: health.groq ? '#10b981' : '#666' }}>Cloud: {health.groq ? 'Ready' : 'API Key Missing'}</span>
            </div>
          </div>
        </div>
      </header>

      <main>
        <form onSubmit={handleSubmit} style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              value={prompt} 
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={provider === 'auto' ? "Local is preferred, Cloud is fallback..." : `Asking ${provider}...`}
              style={{
                flex: 1,
                padding: '14px 18px',
                borderRadius: '10px',
                border: '1px solid #e0e0e0',
                fontSize: '1rem',
                outline: 'none',
                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
              }}
              disabled={isLoading}
            />
            {isLoading ? (
              <button type="button" onClick={handleStop} style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', backgroundColor: '#333', color: 'white', cursor: 'pointer', fontWeight: 600 }}>
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!prompt.trim()} style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', backgroundColor: '#2563eb', color: 'white', cursor: 'pointer', fontWeight: 600, opacity: !prompt.trim() ? 0.6 : 1 }}>
                Send
              </button>
            )}
          </div>
        </form>

        <div style={{ 
          backgroundColor: '#fff',
          padding: '25px',
          borderRadius: '12px',
          minHeight: '250px',
          border: '1px solid #f0f0f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
            <strong style={{ color: '#4b5563', fontSize: '0.9rem' }}>RESPONSE</strong>
            {isLoading && <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 600 }}>STREAMSING...</span>}
          </div>
          <div style={{ 
            whiteSpace: 'pre-wrap', 
            lineHeight: '1.7',
            color: '#1f2937',
            fontSize: '1.05rem'
          }}>
            {response}
            {isLoading && !response && <span className="cursor" style={{ animation: 'blink 1s infinite' }}>|</span>}
            {isLoading && response && <span style={{ display: 'inline-block', width: '2px', height: '1.2em', backgroundColor: '#2563eb', marginLeft: '2px', verticalAlign: 'middle' }} />}
          </div>
        </div>
      </main>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export default App
