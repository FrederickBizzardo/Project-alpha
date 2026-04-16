from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import os
import orjson as json
import asyncio
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from datetime import datetime
from typing import List, Optional

load_dotenv()

# Database setup
DATABASE_URL = "sqlite+aiosqlite:///./project_alpha.db"
Base = declarative_base()

class Chat(Base):
    __tablename__ = "chats"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="New Chat")
    created_at = Column(DateTime, default=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id"))
    role = Column(String) # "user" or "assistant"
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ... (Ollama/Groq URLs remain same)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = "You are Alpha, the highly intelligent and minimalistic AI assistant for Project Alpha. You are helpful, concise, and modern. If asked who you are, always identify as Alpha. Always be specific in everything you tell the user and always show step by step procedures for tasks such as coding, to show the prerequistes of what the user needs, such as packages, possibly. how to install them. Basically what I am saying is be very smart and explain things as you would to a junior. NOTE: YOUR CREATOR IS THE FOUNDER OF PROJECT ALPHA, HIS NAME IS  'Fred Kishala'...Remember that. Ypu can browse the internet to find Fred Kishala's social account details, e.x: Instagram: @itsfredkishala"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    app.state.client = httpx.AsyncClient(
        timeout=httpx.Timeout(720.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
    )
    
    # Pre-warm local model
    try:
        response = await app.state.client.get(f"{OLLAMA_URL}/api/tags", timeout=2.0)
        if response.status_code == 200:
            await app.state.client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": "llama3.2:1b", "prompt": "", "keep_alive": -1}
                # json={"model": "gemma4:31b-cloud", "prompt": "", "keep_alive": -1}
            )
            app.state.ollama_online = True
        else:
            app.state.ollama_online = False
    except Exception:
        app.state.ollama_online = False
        
    yield
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    prompt: str
    provider: str = "auto"
    chat_id: Optional[int] = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok", 
        "ollama_online": getattr(app.state, "ollama_online", False),
        "groq_ready": bool(GROQ_API_KEY)
    }

@app.get("/api/chats")
async def get_chats():
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        result = await session.execute(select(Chat).order_by(Chat.created_at.desc()))
        chats = result.scalars().all()
        return [{"id": c.id, "title": c.title, "created_at": c.created_at} for c in chats]

@app.get("/api/chats/{chat_id}")
async def get_chat_messages(chat_id: int):
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        result = await session.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at.asc()))
        messages = result.scalars().all()
        return [{"role": m.role, "content": m.content} for m in messages]

@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: int):
    async with AsyncSessionLocal() as session:
        from sqlalchemy import delete
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()
        return {"status": "success"}

@app.patch("/api/chats/{chat_id}")
async def update_chat(chat_id: int, title: str):
    async with AsyncSessionLocal() as session:
        from sqlalchemy import update
        await session.execute(update(Chat).where(Chat.id == chat_id).values(title=title))
        await session.commit()
        return {"status": "success"}

@app.post("/api/chats")
async def create_chat(title: Optional[str] = "New Chat"):
    async with AsyncSessionLocal() as session:
        new_chat = Chat(title=title)
        session.add(new_chat)
        await session.commit()
        await session.refresh(new_chat)
        return {"id": new_chat.id, "title": new_chat.title}

async def save_message(chat_id: int, role: str, content: str):
    async with AsyncSessionLocal() as session:
        msg = Message(chat_id=chat_id, role=role, content=content)
        session.add(msg)
        await session.commit()

async def stream_ollama(prompt: str, chat_id: int, history: List[dict]):
    full_response = ""
    # Construct history-aware prompt
    formatted_history = "\n".join([f"{m['role']}: {m['content']}" for m in history])
    full_prompt = f"{SYSTEM_PROMPT}\n\nHistory:\n{formatted_history}\n\nUser: {prompt}\nAlpha:"
    
    try:
        async with app.state.client.stream(
            "POST",
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llama3.2:1b",
                "prompt": full_prompt,
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
                        content = chunk["response"]
                        full_response += content
                        yield content
                    if chunk.get("done"):
                        break
        await save_message(chat_id, "assistant", full_response)
    except Exception as e:
        yield f"\n[Ollama Error: {str(e)}]"

async def stream_groq(prompt: str, chat_id: int, history: List[dict]):
    if not GROQ_API_KEY:
        yield "\n[Error: GROQ_API_KEY not set]"
        return

    full_response = ""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": prompt})

    try:
        async with app.state.client.stream(
            "POST",
            GROQ_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={
                "model": "llama-3.1-8b-instant",
                "messages": messages,
                "stream": True
            }
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]": break
                    try:
                        chunk = json.loads(data_str)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content:
                            full_response += content
                            yield content
                    except: continue
        await save_message(chat_id, "assistant", full_response)
    except Exception as e:
        yield f"\n[Groq Cloud Error: {str(e)}]"

@app.post("/api/chat")
async def chat(request: ChatRequest):
    chat_id = request.chat_id
    
    # Create chat if not provided
    if not chat_id:
        async with AsyncSessionLocal() as session:
            new_chat = Chat(title=request.prompt[:30] + "...")
            session.add(new_chat)
            await session.commit()
            await session.refresh(new_chat)
            chat_id = new_chat.id
    
    # Save user message
    await save_message(chat_id, "user", request.prompt)
    
    # Fetch history for context
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        result = await session.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at.asc()))
        history = [{"role": m.role, "content": m.content} for m in result.scalars().all()][:-1]

    provider = request.provider
    ollama_online = False
    try:
        check = await app.state.client.get(f"{OLLAMA_URL}/api/tags", timeout=0.5)
        ollama_online = check.status_code == 200
    except: ollama_online = False

    if provider == "auto": provider = "local" if ollama_online else "cloud"

    if provider == "local":
        return StreamingResponse(stream_ollama(request.prompt, chat_id, history), media_type="text/plain")
    else:
        return StreamingResponse(stream_groq(request.prompt, chat_id, history), media_type="text/plain")
