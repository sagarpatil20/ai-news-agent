import os
import json
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from groq import AsyncGroq
from tavily import TavilyClient

# Load environment variables
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

app = FastAPI(title="AI News Agent Backend")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the actual frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize clients if keys exist
groq_client = None
tavily_client = None

if GROQ_API_KEY:
    groq_client = AsyncGroq(api_key=GROQ_API_KEY)
else:
    print("WARNING: GROQ_API_KEY is not set.")

if TAVILY_API_KEY:
    tavily_client = TavilyClient(api_key=TAVILY_API_KEY)
else:
    print("WARNING: TAVILY_API_KEY is not set.")


class Message(BaseModel):
    role: str  # "user", "assistant", or "system"
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


async def generate_search_query(messages: List[Message]) -> str:
    """
    Given the chat history, use a fast Groq model to generate a search query.
    If it fails or is a single message, default to the last user message.
    """
    if not groq_client or len(messages) <= 1:
        return messages[-1].content

    try:
        # Prompt the model to extract a search query based on chat context
        history_str = ""
        for msg in messages[:-1]:
            history_str += f"{msg.role.upper()}: {msg.content}\n"
        
        prompt = (
            "You are an assistant that extracts optimized web search queries from conversation history.\n"
            "Based on the conversation history below and the user's latest request, output a single, "
            "search-engine friendly query that will retrieve the most relevant news. "
            "Do not include quotes, punctuation, or explanations. Respond with ONLY the query.\n\n"
            f"Conversation History:\n{history_str}\n"
            f"User's Latest Request: {messages[-1].content}\n\n"
            "Search Query:"
        )

        response = await groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=60,
            temperature=0.0,
        )
        
        query = response.choices[0].message.content.strip()
        # Clean any accidental outer quotes
        if (query.startswith('"') and query.endswith('"')) or (query.startswith("'") and query.endswith("'")):
            query = query[1:-1]
        
        return query if query else messages[-1].content
    except Exception as e:
        print(f"Error generating search query: {e}")
        return messages[-1].content


def perform_news_search(query: str) -> List[Dict[str, Any]]:
    """
    Perform a Tavily news search. Falls back to a standard web search if news topic search fails.
    """
    if not tavily_client:
        return []

    try:
        # Try to search specifically for news
        search_res = tavily_client.search(query=query, topic="news", max_results=6)
        results = search_res.get("results", [])
        if results:
            return results
    except Exception as e:
        print(f"Tavily news search failed for query '{query}': {e}. Falling back to general search...")

    try:
        # Fall back to general web search
        search_res = tavily_client.search(query=query, max_results=6)
        return search_res.get("results", [])
    except Exception as e:
        print(f"Tavily general search failed for query '{query}': {e}")
        return []


async def event_generator(messages: List[Message]):
    """
    Generator that streams search results and LLM answers via Server-Sent Events (SSE).
    """
    if not groq_client or not tavily_client:
        yield f"event: error\ndata: {json.dumps({'message': 'API keys are not properly configured on the server. Please check your .env file.'})}\n\n"
        return

    try:
        # 1. Generate optimized search query
        search_query = await generate_search_query(messages)
        yield f"event: query\ndata: {json.dumps({'query': search_query})}\n\n"

        # 2. Perform news search
        # Run synchronous Tavily call in an executor to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        sources = await loop.run_in_executor(None, perform_news_search, search_query)
        
        # Format sources to send to frontend
        formatted_sources = []
        for src in sources:
            formatted_sources.append({
                "title": src.get("title", "No Title"),
                "url": src.get("url", "#"),
                "content": src.get("content", ""),
                "published_date": src.get("published_date") or src.get("score") # sometimes score is there
            })

        yield f"event: sources\ndata: {json.dumps(formatted_sources)}\n\n"

        # 3. Create context for LLM prompt
        context = ""
        if formatted_sources:
            context = "Search Results:\n"
            for i, src in enumerate(formatted_sources, 1):
                context += f"[{i}] Title: {src['title']}\n"
                context += f"    URL: {src['url']}\n"
                context += f"    Content: {src['content']}\n"
                if src.get("published_date"):
                    context += f"    Date/Score: {src['published_date']}\n"
                context += "\n"
        else:
            context = "No news articles found for this topic. Answer based on your existing knowledge, but clarify that no web results were retrieved.\n"

        # 4. Define system instructions
        system_prompt = (
            "You are a professional AI News Agent. Your task is to provide a comprehensive, "
            "unbiased, and clear news briefing based on the provided search results.\n"
            "Today's date is May 26, 2026.\n\n"
            "Rules:\n"
            "1. Synthesize the provided search results to answer the user's latest query.\n"
            "2. Cite your sources using bracketed numbers, e.g. [1], [2], corresponding to their order in the search results.\n"
            "   Place these citations inline immediately after the claim they support.\n"
            "3. If different sources present conflicting info, present both perspectives objectively.\n"
            "4. Organize your response using Markdown (headers, lists, tables, bold text).\n"
            "5. Answer in a professional, news-reporting style.\n"
        )

        # Build message history for the LLM
        messages_for_llm = [
            {"role": "system", "content": f"{system_prompt}\nContext:\n{context}"}
        ]

        # Add conversation history
        for msg in messages[:-1]:
            messages_for_llm.append({"role": msg.role, "content": msg.content})

        # Add latest user message
        messages_for_llm.append({"role": "user", "content": messages[-1].content})

        # 5. Call Groq client with streaming
        # We use llama-3.3-70b-versatile for high quality news compilation
        completion = await groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages_for_llm,
            stream=True,
            temperature=0.3,
            max_tokens=2048,
        )

        async for chunk in completion:
            text = chunk.choices[0].delta.content
            if text:
                yield f"event: content\ndata: {json.dumps({'text': text})}\n\n"

        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        print(f"Stream error: {e}")
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"


@app.post("/api/chat")
async def chat_stream(request: ChatRequest):
    """
    Streaming endpoint using SSE to send back news search results and LLM generated briefings.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="Messages list cannot be empty")

    return StreamingResponse(
        event_generator(request.messages),
        media_type="text/event-stream"
    )


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "groq_configured": groq_client is not None,
        "tavily_configured": tavily_client is not None
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
