import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Radio, 
  X, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  AlertCircle, 
  Check, 
  Activity
} from 'lucide-react';

interface LiveVoiceIntercomModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LiveVoiceIntercomModal: React.FC<LiveVoiceIntercomModalProps> = ({ isOpen, onClose }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to Live Voice Dispatch...');
  const [modelTalking, setModelTalking] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ sender: 'user' | 'gemini'; text: string; time: string }>>([
    {
      sender: 'gemini',
      text: 'Security Voice Intercom online. Connected to model gemini-3.8-live. Speak to request immediate surveillance status or dispatch protocols.',
      time: 'Just now'
    }
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const nextStartTimeRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      return;
    }

    startLiveSession();

    return () => {
      cleanup();
    };
  }, [isOpen]);

  const startLiveSession = () => {
    setErrorMessage(null);
    setStatusMessage('Initiating gemini-3.8-live session...');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Audio context for 24kHz model output
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      ws.onopen = () => {
        setIsConnected(true);
        setStatusMessage('Live Intercom Connected (gemini-3.8-live)');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            setErrorMessage(data.error);
            setStatusMessage('Session Error');
            return;
          }

          if (data.status === 'connected') {
            setIsConnected(true);
            setStatusMessage('Ready. Turn on mic or type to speak.');
          }

          if (data.text) {
            appendTranscript('gemini', data.text);
          }

          if (data.audio) {
            setModelTalking(true);
            queueAudioPlayback(data.audio);
          }

          if (data.interrupted) {
            // Stop current playback on interruption
            audioQueueRef.current = [];
            setModelTalking(false);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (e) => {
        console.error('Live API WebSocket error:', e);
        setErrorMessage('WebSocket connection failed. Ensure GEMINI_API_KEY is configured.');
        setStatusMessage('Disconnected');
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setStatusMessage('Session Closed');
      };
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to start Live API');
    }
  };

  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      inputAudioCtxRef.current = inputAudioCtx;

      const source = inputAudioCtx.createMediaStreamSource(stream);
      // Process 4096 frames
      const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16Base64 = floatTo16BitPCMBase64(inputData);
        wsRef.current.send(JSON.stringify({ audio: pcm16Base64 }));
      };

      source.connect(processor);
      processor.connect(inputAudioCtx.destination);
      setIsMicActive(true);
      setStatusMessage('Microphone Active (Streaming to gemini-3.8-live)');
    } catch (err: any) {
      console.error('Mic access error:', err);
      setErrorMessage('Microphone access denied or unavailable: ' + err.message);
    }
  };

  const stopMicrophone = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    setIsMicActive(false);
    setStatusMessage('Microphone Muted');
  };

  const toggleMic = () => {
    if (isMicActive) {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  };

  const floatTo16BitPCMBase64 = (input: Float32Array): string => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    let binary = '';
    const bytes = new Uint8Array(output.buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const queueAudioPlayback = (base64Audio: string) => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;

    try {
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      const startTime = Math.max(currentTime, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;

      source.onended = () => {
        if (ctx.currentTime >= nextStartTimeRef.current - 0.05) {
          setModelTalking(false);
        }
      };
    } catch (err) {
      console.error('Audio decode playback error:', err);
    }
  };

  const appendTranscript = (sender: 'user' | 'gemini', text: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setTranscript(prev => [...prev, { sender, text, time }]);
  };

  const sendQuickSpeechText = (query: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    appendTranscript('user', query);
    wsRef.current.send(JSON.stringify({ text: query }));
  };

  const cleanup = () => {
    stopMicrophone();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    setIsConnected(false);
    setModelTalking(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isConnected ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40' : 'bg-slate-800 text-slate-400'
            }`}>
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Security Voice Intercom</h3>
                <span className="px-2 py-0.5 rounded-full bg-blue-950 border border-blue-500/40 text-blue-400 font-mono text-[10px] font-bold">
                  gemini-3.8-live
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {statusMessage}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error notification if any */}
        {errorMessage && (
          <div className="p-3 bg-rose-950/70 border-b border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Live Audio Visualizer / Status Area */}
        <div className="p-6 bg-gradient-to-b from-slate-950 to-slate-900 flex flex-col items-center justify-center border-b border-slate-800 space-y-4">
          <div className="relative">
            {/* Pulsing ring when active */}
            {isMicActive && (
              <span className="absolute -inset-3 rounded-full bg-blue-500/20 animate-ping"></span>
            )}
            {modelTalking && (
              <span className="absolute -inset-3 rounded-full bg-emerald-500/30 animate-pulse"></span>
            )}

            <button
              onClick={toggleMic}
              disabled={!isConnected}
              className={`w-20 h-20 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all cursor-pointer ${
                isMicActive 
                  ? 'bg-rose-600 hover:bg-rose-500 text-white ring-4 ring-rose-500/30' 
                  : modelTalking 
                    ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/30' 
                    : 'bg-blue-600 hover:bg-blue-500 text-white ring-4 ring-blue-500/20'
              }`}
            >
              {isMicActive ? <Mic className="w-8 h-8" /> : <MicOff className="w-8 h-8" />}
            </button>
          </div>

          <div className="text-center">
            <div className="text-sm font-semibold text-white">
              {isMicActive ? 'Listening to your voice...' : modelTalking ? 'Security Dispatch is Speaking...' : 'Tap Mic to Speak'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 font-mono">
              Bidirectional 16kHz PCM In → 24kHz Low-Latency Audio Out
            </div>
          </div>

          {/* Quick Voice Prompt Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              onClick={() => sendQuickSpeechText('Security status check on all cameras.')}
              className="px-3 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              "Surveillance check"
            </button>
            <button
              onClick={() => sendQuickSpeechText('Any motion detected at Porch or Backyard?')}
              className="px-3 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              "Report recent motion"
            </button>
            <button
              onClick={() => sendQuickSpeechText('Is the Gate camera recording?')}
              className="px-3 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              "Gate camera status"
            </button>
          </div>
        </div>

        {/* Live Conversation Transcript */}
        <div className="p-4 space-y-3 max-h-56 overflow-y-auto font-mono text-xs">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            Live Intercom Audio Log
          </div>
          {transcript.map((item, idx) => (
            <div
              key={idx}
              className={`p-2.5 rounded-xl border ${
                item.sender === 'user'
                  ? 'bg-blue-950/40 border-blue-800/50 text-blue-200 ml-6'
                  : 'bg-slate-800/60 border-slate-700/50 text-slate-200 mr-6'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span className="font-bold uppercase tracking-wider text-white">
                  {item.sender === 'user' ? 'Operator (You)' : 'Gemini 3.8 Live'}
                </span>
                <span>{item.time}</span>
              </div>
              <p className="leading-relaxed font-sans">{item.text}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <span>Real-time voice stream active</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold cursor-pointer"
          >
            End Call
          </button>
        </div>
      </div>
    </div>
  );
};
