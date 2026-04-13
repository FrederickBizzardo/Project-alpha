from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import os
import orjson as json
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv() # Load variables from .env if present

# Use environment variables for API keys and URLs
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "") # User should set this
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create client with optimized settings
    app.state.client = httpx.AsyncClient(
        timeout=httpx.Timeout(720.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
    )
    
    # Pre-warm local model if Ollama is running
    try:
        response = await app.state.client.get(f"{OLLAMA_URL}/api/tags", timeout=2.0)
        if response.status_code == 200:
            print(f"Ollama detected. Pre-warming model llama3.2:1b...")
            await app.state.client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": "llama3.2:1b", "prompt": "", "keep_alive": -1}
            )
            app.state.ollama_online = True
        else:
            app.state.ollama_online = False
    except Exception:
        print("Ollama not detected locally. Will default to Cloud (Groq) if needed.")
        app.state.ollama_online = False
        
    yield
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    prompt: str
    provider: str = "auto" # "local", "cloud", or "auto"

@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "ollama_online": getattr(app.state, "ollama_online", False),
        "groq_ready": bool(GROQ_API_KEY)
    }

async def stream_ollama(prompt: str):
    try:
        async with app.state.client.stream(
            "POST",
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llama3.2:1b",
                "prompt": prompt,
                "stream": True,
                "keep_alive": -1,
                "options": {"num_thread": 8, "temperature": 0.7}
            }
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    chunk = json.loads(line)
                    if "response" in chunk:
                        yield chunk["response"]
                    if chunk.get("done"):
                        break
    except Exception as e:
        yield f"\n[Ollama Error: {str(e)}]"

async def stream_groq(prompt: str):
    if not GROQ_API_KEY:
        yield "\n[Error: GROQ_API_KEY not set in backend environment variables]"
        return

    try:
        async with app.state.client.stream(
            "POST",
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "llama-3.1-8b-instant", # Fast, free model on Groq
                "messages": [{"role": "user", "content": prompt}],
                "stream": True
            }
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content:
                            yield content
                    except:
                        continue
    except Exception as e:
        yield f"\n[Groq Cloud Error: {str(e)}]"

@app.post("/api/chat")
async def chat(request: ChatRequest):
    # Logic to determine provider
    provider = request.provider
    
    # Check if Ollama is actually online
    ollama_online = False
    try:
        check = await app.state.client.get(f"{OLLAMA_URL}/api/tags", timeout=1.0)
        ollama_online = check.status_code == 200
    except:
        ollama_online = False

    # Auto-fallback logic
    if provider == "auto":
        provider = "local" if ollama_online else "cloud"
    elif provider == "local" and not ollama_online:
        # User specifically asked for local but it's down
        return StreamingResponse(
            iter([f"Error: Local Ollama is not running at {OLLAMA_URL}. Please start it or switch to Cloud (Groq)."]),
            media_type="text/plain"
        )

    if provider == "local":
        return StreamingResponse(stream_ollama(request.prompt), media_type="text/plain")
    else:
        return StreamingResponse(stream_groq(request.prompt), media_type="text/plain")
