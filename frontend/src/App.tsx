import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Globe,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Compass,
  Trash2,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import './App.css';

interface Source {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  query?: string;
  sources?: Source[];
  error?: string;
  isStreaming?: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentQuery, setCurrentQuery] = useState('');
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sync theme with document element
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Adjust textarea height dynamically
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const startNewsQuery = (queryText: string) => {
    setInput(queryText);
    setTimeout(() => {
      handleSubmit(queryText);
    }, 50);
  };

  const handleSubmit = async (overrideInput?: string) => {
    const queryToSend = (overrideInput || input).trim();
    if (!queryToSend || loading) return;

    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    setError(null);
    setLoading(true);
    setCurrentQuery('');
    setCurrentSources([]);

    // 1. Add user message
    const userMsg: Message = { role: 'user', content: queryToSend };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // 2. Add empty streaming assistant message
    const assistantMsgIndex = updatedMessages.length;
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        query: '',
        sources: [],
        isStreaming: true,
      },
    ]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported by response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let detectedQuery = '';
      let detectedSources: Source[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // SSE format:
          // event: [event_name]
          // data: [json_string]
          // We need a simple, single-pass parser
          if (trimmed.startsWith('event: ')) {
            // Wait for data line which follows
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const dataContent = trimmed.substring(6);
            try {
              const parsed = JSON.parse(dataContent);
              
              // We check the last active event by scanning the surrounding lines
              // In our backend, they are strictly structured as:
              // event: query \n data: {...}
              // event: sources \n data: [...]
              // event: content \n data: {...}
              // event: error \n data: {...}
              
              // Let's deduce what type of packet it is based on fields present
              if (parsed.query !== undefined) {
                detectedQuery = parsed.query;
                setCurrentQuery(detectedQuery);
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantMsgIndex] = {
                    ...copy[assistantMsgIndex],
                    query: detectedQuery,
                  };
                  return copy;
                });
              } else if (Array.isArray(parsed)) {
                detectedSources = parsed;
                setCurrentSources(detectedSources);
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantMsgIndex] = {
                    ...copy[assistantMsgIndex],
                    sources: detectedSources,
                  };
                  return copy;
                });
              } else if (parsed.text !== undefined) {
                accumulatedText += parsed.text;
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantMsgIndex] = {
                    ...copy[assistantMsgIndex],
                    content: accumulatedText,
                  };
                  return copy;
                });
              } else if (parsed.message !== undefined) {
                // This is an error event
                throw new Error(parsed.message);
              }
            } catch (err: any) {
              console.error('Error parsing streaming event:', err);
            }
          }
        }
      }

      // Mark streaming as complete
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantMsgIndex]) {
          copy[assistantMsgIndex].isStreaming = false;
        }
        return copy;
      });

    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Something went wrong. Please check your backend connection.');
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantMsgIndex]) {
          copy[assistantMsgIndex] = {
            ...copy[assistantMsgIndex],
            error: err.message || 'Stream connection failed.',
            isStreaming: false,
          };
        }
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setCurrentQuery('');
    setCurrentSources([]);
    setError(null);
  };

  // Convert raw text citations like [1] to markdown links to their respective source URLs
  const processCitations = (content: string, sources?: Source[]) => {
    if (!sources || sources.length === 0) return content;
    let text = content;
    for (let i = 0; i < sources.length; i++) {
      const idx = i + 1;
      const url = sources[i].url;
      // Regex matches [i] if not followed by '(' (already marked down) or ']'
      const regex = new RegExp(`\\[${idx}\\](?!\\]|\\()`, 'g');
      text = text.replace(regex, `[[${idx}]](${url})`);
    }
    return text;
  };

  const suggestedPrompts = [
    {
      title: 'OpenAI Developments',
      desc: 'What is the latest news regarding OpenAI models & safety updates?',
      query: 'What is the latest news regarding OpenAI models and AI safety updates?',
    },
    {
      title: 'AI Chip Wars',
      desc: 'Get recent updates on NVIDIA, AMD, and Intel hardware releases.',
      query: 'Latest updates on NVIDIA, AMD, and Intel AI GPU hardware releases and market competition',
    },
    {
      title: 'Tech Regulation',
      desc: 'What bills or policies are being passed globally for AI governance?',
      query: 'Recent bills, laws, and policies passed globally regarding AI governance and regulation',
    },
    {
      title: 'Space Breakthroughs',
      desc: 'Latest news about space missions, Starship launches, and NASA.',
      query: 'Latest news on SpaceX Starship tests, NASA missions, and commercial space exploration',
    },
  ];

  return (
    <div className="app-container">
      {/* Premium Mono Header */}
      <header className="site-header">
        <div className="header-left">
          <span className="brand-name">NEWS.AGENT</span>
          <span className="live-pill">
            <span className="pulse-dot"></span>
            LIVE MONITOR
          </span>
        </div>
        <div className="header-right">
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle Theme"
          >
            {theme === 'dark' ? 'LIGHT_MODE' : 'DARK_MODE'}
          </button>
          {messages.length > 0 && (
            <button className="clear-btn-header" onClick={clearChat} title="Clear Session">
              <Trash2 size={15} />
              <span>RESET</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {messages.length === 0 ? (
          /* Welcome Panel */
          <div className="welcome-panel">
            <div className="hero-section">
              <span className="hero-tagline">REAL-TIME NEWS MONITORING</span>
              <h1 className="hero-title">
                Decentralized Search. <br />
                Synthesized Intelligence.
              </h1>
              <p className="hero-desc">
                Ask any question. The agent crawls the live web via Tavily, fetches the latest articles, and streams a structured briefings cited with sources instantly.
              </p>
            </div>

            {/* Prompt Cards Grid */}
            <div className="suggested-grid">
              {suggestedPrompts.map((prompt, i) => (
                <div
                  key={i}
                  className="suggested-card"
                  onClick={() => startNewsQuery(prompt.query)}
                >
                  <div className="card-header-icon">
                    <Compass size={18} className="mono-icon" />
                    <ChevronRight size={14} className="arrow-icon" />
                  </div>
                  <h3>{prompt.title}</h3>
                  <p>{prompt.desc}</p>
                </div>
              ))}
            </div>

            {/* Status Footer */}
            <div className="welcome-status">
              <TrendingUp size={16} />
              <span>Trending Topics: AI Safety Regulation, Nvidia Blackwell GPUs, commercial spaceflight</span>
            </div>
          </div>
        ) : (
          /* Conversation Logs */
          <div className="chat-thread">
            {messages.map((msg, index) => (
              <div key={index} className={`chat-message ${msg.role}`}>
                <div className="message-header">
                  <span className="role-label">{msg.role === 'user' ? 'USER_QUERY' : 'AGENT_BRIEFING'}</span>
                  {msg.role === 'assistant' && msg.query && (
                    <span className="search-query-badge">
                      <Globe size={12} />
                      SEARCH: "{msg.query}"
                    </span>
                  )}
                </div>

                <div className="message-body">
                  {msg.role === 'user' ? (
                    <p className="user-query-text">{msg.content}</p>
                  ) : (
                    <>
                      {/* Source Cards Panel */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="sources-container">
                          <div className="sources-title">
                            <span>VERIFIED SOURCES ({msg.sources.length})</span>
                          </div>
                          <div className="sources-scroll">
                            {msg.sources.map((src, idx) => {
                              let domain = '';
                              try {
                                domain = new URL(src.url).hostname.replace('www.', '');
                              } catch {
                                domain = 'link';
                              }
                              return (
                                <a
                                  key={idx}
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="source-card"
                                  title={src.content}
                                >
                                  <div className="source-card-header">
                                    <span className="source-index">[{idx + 1}]</span>
                                    <span className="source-domain">{domain}</span>
                                    <ExternalLink size={10} className="source-link-icon" />
                                  </div>
                                  <h4 className="source-card-title">{src.title}</h4>
                                  <p className="source-card-snippet">{src.content}</p>
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Stream Response Body */}
                      <div className="briefing-content">
                        {msg.content ? (
                          <ReactMarkdown
                            components={{
                              a: ({ node, ...props }) => (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="citation-link"
                                />
                              ),
                            }}
                          >
                            {processCitations(msg.content, msg.sources)}
                          </ReactMarkdown>
                        ) : msg.error ? (
                          <div className="error-message-box">
                            <AlertCircle size={16} />
                            <span>{msg.error}</span>
                          </div>
                        ) : (
                          /* Loading skeleton while fetching search or waiting for first token */
                          <div className="loading-placeholder">
                            <div className="line-skeleton pulse-anim"></div>
                            <div className="line-skeleton pulse-anim short"></div>
                          </div>
                        )}
                        {msg.isStreaming && <span className="typing-cursor"></span>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Floating Status Indicator for searches */}
      {loading && currentQuery && !messages[messages.length - 1]?.content && (
        <div className="floating-status-banner">
          <RefreshCw size={14} className="spin-anim" />
          <span>
            {currentSources.length > 0
              ? `Synthesizing ${currentSources.length} articles for "${currentQuery}"...`
              : `Searching live news for "${currentQuery}"...`}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && !loading && (
        <div className="global-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button className="error-dismiss" onClick={() => setError(null)}>
            DISMISS
          </button>
        </div>
      )}

      {/* Bottom Form */}
      <footer className="input-footer">
        <form
          className="input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="input-container">
            <textarea
              ref={inputRef}
              className="query-textarea"
              placeholder="Ask about breaking news, global trends, or sector insights..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <div className="input-actions">
              <span className="input-instructions">Press Enter to Search</span>
              <button
                type="submit"
                className="submit-btn"
                disabled={loading || !input.trim()}
                title="Send query"
              >
                {loading ? (
                  <RefreshCw size={16} className="spin-anim" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        </form>
      </footer>
    </div>
  );
}

export default App;
