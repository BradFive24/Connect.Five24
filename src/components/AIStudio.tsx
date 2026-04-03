import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Brain, 
  MessageSquare, 
  Sparkles, 
  Send, 
  BookOpen, 
  Target, 
  Zap, 
  GraduationCap, 
  PlayCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  User,
  Bot,
  Clock
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { cn } from '../lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  completed?: boolean;
}

const TRAINING_MODULES: TrainingModule[] = [
  {
    id: 'nepq-basics',
    title: 'NEPQ Fundamentals',
    description: 'Master the core principles of Neuro-Emotional Persuasion Questioning.',
    icon: <Brain className="w-5 h-5 text-emerald-500" />,
    level: 'Beginner',
    duration: '45 mins',
    completed: true
  },
  {
    id: 'objection-handling',
    title: 'Advanced Objection Handling',
    description: 'Learn how to neutralize resistance and turn "no" into "not yet".',
    icon: <Target className="w-5 h-5 text-blue-500" />,
    level: 'Advanced',
    duration: '60 mins'
  },
  {
    id: 'discovery-mastery',
    title: 'Discovery Call Mastery',
    description: 'Uncover deep-seated pain points that drive high-value decisions.',
    icon: <Zap className="w-5 h-5 text-amber-500" />,
    level: 'Intermediate',
    duration: '30 mins'
  },
  {
    id: 'closing-psychology',
    title: 'The Psychology of Closing',
    description: 'Understand the emotional triggers that lead to a final commitment.',
    icon: <GraduationCap className="w-5 h-5 text-purple-500" />,
    level: 'Advanced',
    duration: '90 mins'
  }
];

export const AIStudio: React.FC<{ userGeminiKey?: string }> = ({ userGeminiKey }) => {
  const [activeTab, setActiveTab] = useState<'discussion' | 'training'>('discussion');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hello! I'm your AI Sales Coach. Ready to sharpen your skills? We can discuss a specific deal, practice objection handling, or dive into a training module. What's on your mind?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    const apiKey = userGeminiKey || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I'm sorry, but I can't connect to my brain right now. Please check your Gemini API key in the settings.",
          timestamp: new Date()
        }]);
        setIsTyping(false);
      }, 1000);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";
      
      const chatHistory = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: `You are a world-class sales coach specializing in NEPQ (Neuro-Emotional Persuasion Questioning). 
            Your goal is to help the user improve their sales skills, handle objections, and close more deals. 
            Be professional, encouraging, and highly strategic. 
            Keep your responses concise and actionable.` }]
          },
          ...chatHistory,
          {
            role: 'user',
            parts: [{ text: input }]
          }
        ],
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.text || "I'm having trouble processing that. Could you rephrase it?",
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("AI Studio Error:", error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I encountered an error while thinking. Let's try again in a moment.",
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Header */}
      <header className="p-8 border-b border-zinc-800 bg-zinc-900/30 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <Brain className="w-6 h-6 text-emerald-500" />
              </div>
              <h2 className="text-4xl font-black tracking-tighter uppercase italic">AI Studio</h2>
            </div>
            <p className="text-zinc-500 text-xs uppercase tracking-[0.4em] font-bold">Sales Training & Discussion Hub</p>
          </div>

          <div className="flex bg-zinc-900 p-1 rounded-2xl border border-zinc-800">
            <button 
              onClick={() => setActiveTab('discussion')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'discussion' ? "bg-zinc-800 text-emerald-500 shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <MessageSquare className="w-4 h-4" />
              Discussion
            </button>
            <button 
              onClick={() => setActiveTab('training')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'training' ? "bg-zinc-800 text-emerald-500 shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <BookOpen className="w-4 h-4" />
              Training
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'discussion' ? (
            <motion.div 
              key="discussion"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col max-w-4xl mx-auto p-6"
            >
              {/* Chat Area */}
              <div className="flex-1 overflow-y-auto space-y-6 p-4 custom-scrollbar">
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-4 max-w-[85%]",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center border",
                      msg.role === 'assistant' ? "bg-emerald-500/10 border-emerald-500/20" : "bg-zinc-800 border-zinc-700"
                    )}>
                      {msg.role === 'assistant' ? <Bot className="w-5 h-5 text-emerald-500" /> : <User className="w-5 h-5 text-zinc-400" />}
                    </div>
                    <div className={cn(
                      "p-4 rounded-3xl text-sm leading-relaxed",
                      msg.role === 'assistant' ? "bg-zinc-900 border border-zinc-800 text-zinc-200" : "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
                    )}>
                      {msg.content}
                    </div>
                  </motion.div>
                ))}
                {isTyping && (
                  <div className="flex gap-4 max-w-[85%]">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-3xl flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                      <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Coach is thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-6">
                <div className="relative">
                  <input 
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask your sales coach anything..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl py-4 pl-6 pr-16 text-sm text-white focus:border-emerald-500 outline-none transition-all shadow-2xl"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 bottom-2 w-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-emerald-900/20"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 text-center mt-4 uppercase tracking-widest font-bold">
                  Strategic Discussion Powered by Gemini 3 Flash
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="training"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full overflow-y-auto p-8 custom-scrollbar"
            >
              <div className="max-w-6xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                  <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
                      <GraduationCap className="w-6 h-6 text-emerald-500" />
                    </div>
                    <p className="text-2xl font-black tracking-tight">1/4</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Modules Completed</p>
                  </div>
                  <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
                      <Clock className="w-6 h-6 text-blue-500" />
                    </div>
                    <p className="text-2xl font-black tracking-tight">45m</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Training Time</p>
                  </div>
                  <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4">
                      <Target className="w-6 h-6 text-purple-500" />
                    </div>
                    <p className="text-2xl font-black tracking-tight">85%</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Avg. Assessment Score</p>
                  </div>
                  <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
                      <Sparkles className="w-6 h-6 text-amber-500" />
                    </div>
                    <p className="text-2xl font-black tracking-tight">Elite</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Current Sales Rank</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Available Training Modules</h3>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      1 Module Completed
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {TRAINING_MODULES.map((module) => (
                      <motion.div
                        key={module.id}
                        whileHover={{ y: -4 }}
                        className={cn(
                          "p-6 bg-zinc-900 border rounded-3xl group transition-all duration-300",
                          module.completed ? "border-emerald-500/20" : "border-zinc-800 hover:border-zinc-700"
                        )}
                      >
                        <div className="flex items-start justify-between mb-6">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center",
                            module.completed ? "bg-emerald-500/10" : "bg-zinc-800"
                          )}>
                            {module.icon}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className={cn(
                              "text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-full",
                              module.level === 'Beginner' ? "bg-emerald-500/10 text-emerald-500" :
                              module.level === 'Intermediate' ? "bg-blue-500/10 text-blue-500" :
                              "bg-purple-500/10 text-purple-500"
                            )}>
                              {module.level}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">{module.duration}</span>
                          </div>
                        </div>

                        <div className="mb-8">
                          <h4 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-500 transition-colors">{module.title}</h4>
                          <p className="text-xs text-zinc-500 leading-relaxed">{module.description}</p>
                        </div>

                        <button className={cn(
                          "w-full py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                          module.completed 
                            ? "bg-zinc-800 text-emerald-500 border border-emerald-500/20" 
                            : "bg-zinc-100 text-zinc-950 hover:bg-white"
                        )}>
                          {module.completed ? (
                            <>
                              <CheckCircle2 className="w-4 h-4" />
                              Review Module
                            </>
                          ) : (
                            <>
                              <PlayCircle className="w-4 h-4" />
                              Start Training
                            </>
                          )}
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
