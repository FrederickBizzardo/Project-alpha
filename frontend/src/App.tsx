import React, { useState, useEffect } from 'react'

function App() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then(res => res.ok ? setHealth('ok') : setHealth('error'))
      .catch(() => setHealth('error'))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })
      const data = await response.json()
      setResponse(data.response || data.detail)
    } catch (error) {
      setResponse(`Error: ${error}`)
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
        />
        <button type="submit">Send</button>
      </form>
      <div style={{ marginTop: '20px' }}>
        <strong>Response:</strong>
        <p>{response}</p>
      </div>
    </div>
  )
}

export default App
