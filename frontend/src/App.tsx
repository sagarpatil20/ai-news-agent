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
  Copy,
  Check,
  Download,
  BookOpen,
  X,
  History,
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
  const [activeTab, setActiveTab] = useState<'tech' | 'biz' | 'space' | 'policy'>('tech');
  
  // Interactive Drawer States
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

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

          if (trimmed.startsWith('event: ')) {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const dataContent = trimmed.substring(6);
            try {
              const parsed = JSON.parse(dataContent);
              
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
                throw new Error(parsed.message);
              }
            } catch (err: any) {
              console.error('Error parsing streaming event:', err);
            }
          }
        }
      }

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
    setActiveSource(null);
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const downloadBriefing = (text: string, query: string) => {
    const element = document.createElement('a');
    const titleHeader = `AI NEWS MONITOR - BRIEFING\n`;
    const queryHeader = `Query: "${query}"\n`;
    const dateHeader = `Compiled On: May 26, 2026\n`;
    const separation = `----------------------------------------\n\n`;
    
    const file = new Blob(
      [titleHeader + queryHeader + dateHeader + separation + text],
      { type: 'text/plain;charset=utf-8' }
    );
    element.href = URL.createObjectURL(file);
    element.download = `briefing-${query.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'news'}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const getReadingStats = (text: string) => {
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const readTime = Math.max(1, Math.ceil(wordCount / 200)); // 200 WPM average
    return { wordCount, readTime };
  };

  const processCitations = (content: string, sources?: Source[]) => {
    if (!sources || sources.length === 0) return content;
    let text = content;
    for (let i = 0; i < sources.length; i++) {
      const idx = i + 1;
      const regex = new RegExp(`\\[${idx}\\](?!\\]|\\()`, 'g');
      // Set the citation target to the index rather than the url so we can catch click events
      text = text.replace(regex, `[[${idx}]](#source-${idx})`);
    }
    return text;
  };

  // Structured query recommendations by category
  const categorizedPrompts = {
    tech: [
      {
        title: 'OpenAI Frontiers',
        desc: 'Safety updates, GPT-5 rumors, and governance shakeups.',
        query: 'Latest news regarding OpenAI models, GPT-5 development, and safety policy updates',
      },
      {
        title: 'AI Hardware War',
        desc: 'NVIDIA Blackwell release, AMD chips, and TSMC outputs.',
        query: 'Latest news on NVIDIA Blackwell shipments, AMD MI325X, and semiconductor manufacturing',
      },
    ],
    biz: [
      {
        title: 'Tech Mergers & IPOs',
        desc: 'Latest major venture funding and public tech filings.',
        query: 'Recent tech industry venture capital funding rounds, IPO registrations, and mergers',
      },
      {
        title: 'Interest Rates & Markets',
        desc: 'Central bank announcements and global stock impacts.',
        query: 'Federal Reserve interest rate decisions and stock market impact from global inflation reports',
      },
    ],
    space: [
      {
        title: 'SpaceX Flight Tests',
        desc: 'Starship flight updates, booster catches, and orbital launches.',
        query: 'Latest SpaceX Starship orbital test flights, launch delays, and development timeline',
      },
      {
        title: 'NASA Artemis',
        desc: 'Crewed Moon missions, SLS progress, and spacesuits.',
        query: 'Artemis program milestones, NASA contracts with commercial space companies, and schedule',
      },
    ],
    policy: [
      {
        title: 'AI Security Laws',
        desc: 'EU AI Act enforceability, US executive orders, and safety bills.',
        query: 'Global AI regulatory frameworks, EU AI Act enforcement milestones, and US state AI laws',
      },
      {
        title: 'Data Privacy Reforms',
        desc: 'GDPR updates, scraper lawsuits, and copyright bills.',
        query: 'Latest lawsuits against AI companies regarding copyrighted training data and scraping regulation',
      },
    ],
  };

  // Compile list of all queries run in this chat session
  const queriesTimeline = messages
    .filter((msg) => msg.role === 'assistant' && msg.query)
    .map((msg) => msg.query);

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
            <button className="clear-btn-header" onClick={clearChat} title="Reset Conversation">
              <Trash2 size={14} />
              <span>RESET</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout containing optional Sidebar + Chat stream */}
      <div className="layout-body">
        {/* Left Side Query History Timeline (Desktop Only) */}
        {queriesTimeline.length > 0 && (
          <aside className="session-sidebar">
            <div className="sidebar-title">
              <History size={13} />
              <span>SEARCH TIMELINE</span>
            </div>
            <div className="sidebar-timeline">
              {queriesTimeline.map((q, qidx) => (
                <div key={qidx} className="timeline-node" onClick={() => startNewsQuery(q || '')}>
                  <div className="timeline-dot"></div>
                  <span className="timeline-text" title={q}>{q}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="main-content">
          {messages.length === 0 ? (
            /* Welcome Panel */
            <div className="welcome-panel">
              <div className="hero-section">
                <span className="hero-tagline">REAL-TIME NEWS BRIEFINGS</span>
                <h1 className="hero-title">
                  Decentralized Web Crawl. <br />
                  Synthesized Insights.
                </h1>
                <p className="hero-desc">
                  Input any query. The agent generates search paths, crawls news channels via Tavily, and drafts streaming briefings referenced with live sources.
                </p>
              </div>

              {/* Tab Selector for Starter Prompts */}
              <div className="tabs-container">
                <button className={`tab-btn ${activeTab === 'tech' ? 'active' : ''}`} onClick={() => setActiveTab('tech')}>TECH & HARDWARE</button>
                <button className={`tab-btn ${activeTab === 'biz' ? 'active' : ''}`} onClick={() => setActiveTab('biz')}>MARKETS & BIZ</button>
                <button className={`tab-btn ${activeTab === 'space' ? 'active' : ''}`} onClick={() => setActiveTab('space')}>SPACE EXP</button>
                <button className={`tab-btn ${activeTab === 'policy' ? 'active' : ''}`} onClick={() => setActiveTab('policy')}>POLICY & LAW</button>
              </div>

              {/* Swipeable/Grid Suggested Prompts */}
              <div className="suggested-grid">
                {categorizedPrompts[activeTab].map((prompt, i) => (
                  <div
                    key={i}
                    className="suggested-card"
                    onClick={() => startNewsQuery(prompt.query)}
                  >
                    <div className="card-header-icon">
                      <Compass size={16} className="mono-icon" />
                      <ChevronRight size={13} className="arrow-icon" />
                    </div>
                    <h3>{prompt.title}</h3>
                    <p>{prompt.desc}</p>
                  </div>
                ))}
              </div>

              {/* Status Footer */}
              <div className="welcome-status">
                <TrendingUp size={14} />
                <span>Monitoring: Federal Reserve rate shifts, SpaceX Lunar Starship, EU AI Act deadlines.</span>
              </div>
            </div>
          ) : (
            /* Conversation Chat Log */
            <div className="chat-thread">
              {messages.map((msg, index) => (
                <div key={index} className={`chat-message ${msg.role}`}>
                  <div className="message-header">
                    <span className="role-label">{msg.role === 'user' ? 'USER_QUERY' : 'AGENT_BRIEFING'}</span>
                    
                    {msg.role === 'assistant' && msg.query && (
                      <span className="search-query-badge">
                        <Globe size={11} />
                        SEARCH: "{msg.query}"
                      </span>
                    )}
                  </div>

                  <div className="message-body">
                    {msg.role === 'user' ? (
                      <p className="user-query-text">{msg.content}</p>
                    ) : (
                      <>
                        {/* Source Cards Carousel */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="sources-container">
                            <div className="sources-title">
                              <span>VERIFIED ARTICLES ({msg.sources.length})</span>
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
                                  <div
                                    key={idx}
                                    className="source-card"
                                    onClick={() => setActiveSource(src)}
                                    title="Click to view details"
                                  >
                                    <div className="source-card-header">
                                      <span className="source-index">[{idx + 1}]</span>
                                      <span className="source-domain">{domain}</span>
                                      <ExternalLink size={10} className="source-link-icon" />
                                    </div>
                                    <h4 className="source-card-title">{src.title}</h4>
                                    <p className="source-card-snippet">{src.content}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Stream Briefing Content with Actions */}
                        <div className="briefing-box">
                          {/* Briefing Toolbar (Word count, read time, copy, download) */}
                          {msg.content && !msg.isStreaming && (
                            <div className="briefing-toolbar">
                              <div className="toolbar-left">
                                <span className="toolbar-stat">
                                  <BookOpen size={11} />
                                  {getReadingStats(msg.content).readTime} min read
                                </span>
                                <span className="toolbar-stat">
                                  {getReadingStats(msg.content).wordCount} words
                                </span>
                              </div>
                              <div className="toolbar-right">
                                <button
                                  className="toolbar-btn"
                                  onClick={() => copyToClipboard(msg.content, index)}
                                  title="Copy Briefing"
                                >
                                  {copiedIndex === index ? (
                                    <>
                                      <Check size={12} className="copied-icon" />
                                      <span>COPIED</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={12} />
                                      <span>COPY</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  className="toolbar-btn"
                                  onClick={() => downloadBriefing(msg.content, msg.query || 'briefing')}
                                  title="Download Briefing"
                                >
                                  <Download size={12} />
                                  <span>SAVE</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Render Markdown with custom anchor click handler */}
                          <div className="briefing-content">
                            {msg.content ? (
                              <ReactMarkdown
                                components={{
                                  a: ({ node, href, children, ...props }) => {
                                    // Detect if click target is a source citation hash link like #source-1
                                    const sourceMatch = href?.match(/#source-(\d+)/);
                                    if (sourceMatch && msg.sources) {
                                      const srcIdx = parseInt(sourceMatch[1], 10) - 1;
                                      const matchSource = msg.sources[srcIdx];
                                      return (
                                        <button
                                          className="citation-link-btn"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            if (matchSource) {
                                              setActiveSource(matchSource);
                                            }
                                          }}
                                          title={`View snippet from ${matchSource?.title || 'source'}`}
                                        >
                                          {children}
                                        </button>
                                      );
                                    }
                                    return (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="citation-link"
                                        {...props}
                                      />
                                    );
                                  },
                                }}
                              >
                                {processCitations(msg.content, msg.sources)}
                              </ReactMarkdown>
                            ) : msg.error ? (
                              <div className="error-message-box">
                                <AlertCircle size={15} />
                                <span>{msg.error}</span>
                              </div>
                            ) : (
                              /* Streaming Indicator */
                              <div className="loading-placeholder">
                                <div className="line-skeleton pulse-anim"></div>
                                <div className="line-skeleton pulse-anim short"></div>
                              </div>
                            )}
                            {msg.isStreaming && <span className="typing-cursor"></span>}
                          </div>
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
      </div>

      {/* Floating Status Bar */}
      {loading && currentQuery && !messages[messages.length - 1]?.content && (
        <div className="floating-status-banner">
          <RefreshCw size={12} className="spin-anim" />
          <span>
            {currentSources.length > 0
              ? `Compiling search briefings for "${currentQuery}"...`
              : `Searching Tavily for "${currentQuery}"...`}
          </span>
        </div>
      )}

      {/* Global Error Banner */}
      {error && !loading && (
        <div className="global-error-banner">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button className="error-dismiss" onClick={() => setError(null)}>
            DISMISS
          </button>
        </div>
      )}

      {/* Bottom Sticky Input Field */}
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
              placeholder="Ask about live breaking news, company releases, or tech sector shifts..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <div className="input-actions">
              <span className="input-instructions">Enter to Search | Shift+Enter for new line</span>
              <button
                type="submit"
                className="submit-btn"
                disabled={loading || !input.trim()}
                title="Send query"
              >
                {loading ? (
                  <RefreshCw size={14} className="spin-anim" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
          </div>
        </form>
      </footer>

      {/* Slide-out Source citation Drawer */}
      {activeSource && (
        <div className="drawer-overlay" onClick={() => setActiveSource(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-header-left">
                <Compass size={14} />
                <span className="drawer-category">VERIFIED CITATION DETAILS</span>
              </div>
              <button className="drawer-close" onClick={() => setActiveSource(null)}>
                <X size={16} />
              </button>
            </div>
            
            <div className="drawer-scrollable">
              <h2 className="drawer-title">{activeSource.title}</h2>
              
              <div className="drawer-meta">
                <span className="meta-label">SOURCE DOMAIN:</span>
                <span className="meta-value">
                  {(() => {
                    try {
                      return new URL(activeSource.url).hostname;
                    } catch {
                      return 'external';
                    }
                  })()}
                </span>
              </div>

              <div className="drawer-body">
                <div className="snippet-header">RETRIEVED ARTICLE CONTEXT:</div>
                <div className="snippet-box">
                  <p>"{activeSource.content}"</p>
                </div>
              </div>
            </div>

            <div className="drawer-footer">
              <a
                href={activeSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="drawer-link-btn"
              >
                <span>OPEN FULL ARTICLE</span>
                <ExternalLink size={14} />
              </a>
              <button className="drawer-cancel-btn" onClick={() => setActiveSource(null)}>
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
