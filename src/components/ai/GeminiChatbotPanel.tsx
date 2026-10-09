import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Trash2, 
  Sparkles, 
  ShieldAlert, 
  Clock, 
  Check, 
  Copy, 
  Settings, 
  ChevronDown, 
  User, 
  AlertCircle,
  X,
  Maximize2,
  Minimize2,
  Tv
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  time: string;
  modelUsed?: string;
}

interface GeminiChatbotPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenVoiceIntercom?: () => void;
}

type GeminiModelChoice = 'gemini-3.5-flash' | 'gemini-3.1-flash-lite' | 'gemini-3.1-pro-preview';

export const GeminiChatbotPanel: React.FC<GeminiChatbotPanelProps> = ({
  isOpen,
  onClose,
  onOpenVoiceIntercom,
}) => {
  const [selectedModel, setSelectedModel] = useState<GeminiModelChoice>('gemini-3.5-flash');
  const [systemRole, setSystemRole] = useState<string>('Security Officer & NVR Dispatcher');
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      role: 'model',
      text: 'Greetings, Operator. I am your AI Security Officer and NVR Dispatcher. I monitor camera feeds, storage thresholds, motion events, and network daemons across your CCTV system. How can I assist you with security monitoring today?',
      time: 'Just now',
      modelUsed: 'gemini-3.5-flash',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputMessage;
    if (!query.trim() || isLoading) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text: query.trim(),
      time: timeStr,
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: newHistory.map(m => ({ role: m.role, text: m.text })),
          systemInstruction: `You are the ${systemRole} for CCTV Monitor, a professional local-first security surveillance system. Provide tactical security assessments, motion alert summaries, storage retention recommendations, and operational troubleshooting.`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to receive Gemini response');
      }

      const assistantMsg: ChatMessage = {
        id: `resp-${Date.now()}`,
        role: 'model',
        text: data.text,
        time: timeStr,
        modelUsed: data.modelUsed || selectedModel,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: `⚠️ Error: ${err.message || 'Unable to connect to Gemini API. Ensure GEMINI_API_KEY is configured in your Secrets.'}`,
        time: timeStr,
        modelUsed: selectedModel,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'model',
        text: 'Conversation thread cleared. How can I assist you with your CCTV system?',
        time: 'Just now',
        modelUsed: selectedModel,
      },
    ]);
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed z-40 transition-all duration-200 ${
      isExpanded 
        ? 'inset-6' 
        : 'bottom-6 right-6 w-[480px] h-[640px]'
    } bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-text`}>
      {/* Header */}
      <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-sm">Security AI Assistant</h3>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
              <span>{selectedModel}</span>
              <span>•</span>
              <span>{systemRole}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onOpenVoiceIntercom && (
            <button
              onClick={() => {
                onClose();
                onOpenVoiceIntercom();
              }}
              title="Switch to Live Voice Intercom (gemini-3.8-live)"
              className="p-1.5 rounded-lg text-blue-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowConfig(!showConfig)}
            title="Configure System Role and Models"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Expand Full View"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Model & System Role Configuration Drawer */}
      {showConfig && (
        <div className="p-3.5 bg-slate-950/90 border-b border-slate-800 space-y-3 text-xs animate-in slide-in-from-top-2 duration-150">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Gemini Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as GeminiModelChoice)}
              className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="gemini-3.5-flash">gemini-3.5-flash (General Tasks & Surveillance Analysis)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast Tasks & Rapid Response)</option>
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Complex Security & Multi-Step Reasoning)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">System Instruction / Persona Role</label>
            <input
              type="text"
              value={systemRole}
              onChange={(e) => setSystemRole(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. CCTV Security Officer & NVR Dispatcher"
            />
          </div>

          <div className="flex justify-between items-center pt-1 text-[11px] text-slate-400">
            <span>Maintains multi-turn context thread.</span>
            <button
              onClick={handleClearHistory}
              className="text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear History</span>
            </button>
          </div>
        </div>
      )}

      {/* Message Thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs font-sans">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}

              <div className={`max-w-[85%] rounded-2xl p-3.5 space-y-1.5 shadow-sm ${
                isUser
                  ? 'bg-blue-600 text-white rounded-br-xs'
                  : 'bg-slate-800/80 text-slate-200 border border-slate-700/60 rounded-bl-xs'
              }`}>
                <div className="flex items-center justify-between gap-4 text-[10px] opacity-70">
                  <span className="font-semibold uppercase tracking-wider">
                    {isUser ? 'You' : 'Gemini AI'}
                  </span>
                  <div className="flex items-center gap-1.5 font-mono">
                    {msg.modelUsed && <span>{msg.modelUsed}</span>}
                    <span>•</span>
                    <span>{msg.time}</span>
                  </div>
                </div>

                <div className="leading-relaxed whitespace-pre-wrap select-text">
                  {msg.text}
                </div>

                {!isUser && (
                  <div className="pt-1 flex items-center justify-end">
                    <button
                      onClick={() => handleCopy(msg.text, msg.id)}
                      className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-700/50 transition-colors"
                      title="Copy response"
                    >
                      {copyFeedback === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-lg bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-3 items-center">
            <div className="w-7 h-7 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 animate-spin" />
            </div>
            <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-3 text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
              <span>Gemini is analyzing surveillance data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompt Chips */}
      <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800/60 flex items-center gap-2 overflow-x-auto text-[11px] text-slate-300 no-scrollbar">
        <button
          onClick={() => handleSendMessage('Analyze recent motion events and assess perimeter threat.')}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
        >
          🚨 Motion alert audit
        </button>
        <button
          onClick={() => handleSendMessage('What is our current storage capacity and retention forecast?')}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
        >
          💾 Storage status & retention
        </button>
        <button
          onClick={() => handleSendMessage('Why is Camera 5 (Gate) offline and what steps should I take to reconnect it?')}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
        >
          🔧 Gate camera troubleshoot
        </button>
      </div>

      {/* Input Composer */}
      <div className="p-3 bg-slate-950 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Ask Gemini about security cameras, recordings, storage..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isLoading}
            className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
