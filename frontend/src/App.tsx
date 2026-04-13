import React, { useState, useEffect } from 'react'

function App() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then(res => res.ok ? setHealth('ok') : setHealth('error'))
      .catch(() => setHealth('error'))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResponse('') // Clear previous response
    setIsLoading(true)
    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        setResponse((prev) => prev + chunk)
      }
    } catch (error) {
      setResponse(`Error: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>AI Chat Service</h1>
      <p>Backend Status: <strong>{health}</strong></p>
      <form onSubmit={handleSubmit}>
        <input 
          type="text" 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask something..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !prompt}>
          {isLoading ? 'Thinking...' : 'Send'}
        </button>
      </form>
      <div style={{ marginTop: '20px' }}>
        <strong>Response:</strong>
        <p style={{ whiteSpace: 'pre-wrap' }}>{response || (isLoading && '...')}</p>
      </div>
    </div>
  )
}

export default App
