import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  RefreshCw, 
  X, 
  MessageSquare, 
  Target, 
  AlertCircle, 
  Trash2,
  ChevronRight,
  Loader2,
  MapPin,
  DollarSign,
  Clock
} from 'lucide-react';
import axios from 'axios';
import { Lead } from '../types';
import { getCoachPrompts } from '../services/coachService';
import { cn } from '../lib/utils';

interface CoachPanelProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
}

interface NEPQPrompts {
  connecting: string;
  problem: string;
  consequence: string;
}

export const CoachPanel: React.FC<CoachPanelProps> = ({ lead, isOpen, onClose }) => {
  const [prompts, setPrompts] = useState<NEPQPrompts | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inferredIndustry, setInferredIndustry] = useState<string | null>(null);

  const inferIndustry = useCallback(async (placeId: string) => {
    try {
      const res = await axios.get(`/api/gcp/place-details/${placeId}`, { withCredentials: true });
      const details = res.data.result;
      if (details && details.types && details.types.length > 0) {
        const specificTypes = details.types.filter((t: string) => !['point_of_interest', 'establishment', 'premise'].includes(t));
        return specificTypes[0]?.replace(/_/g, ' ') || 'General Business';
      }
    } catch (err) {
      console.error('Failed to infer industry:', err);
    }
    return 'General Business';
  }, []);

  const fetchPrompts = useCallback(async (forceRefresh = false) => {
    if (!lead) return;
    
    setIsLoading(true);
    setError(null);
    try {
      let industry = lead.industry || inferredIndustry;
      
      if (!industry && lead.placeId) {
        industry = await inferIndustry(lead.placeId);
        setInferredIndustry(industry);
      }

      const data = await getCoachPrompts(industry || 'General', lead.name);
      setPrompts(data);
    } catch (err) {
      console.error('Failed to fetch coach prompts:', err);
      setError('Tactical link failed. Using default prompts.');
    } finally {
      setIsLoading(false);
    }
  }, [lead, inferredIndustry, inferIndustry]);

  useEffect(() => {
    if (isOpen && lead && !prompts && !isLoading) {
      fetchPrompts();
    }
  }, [isOpen, lead, prompts, isLoading, fetchPrompts]);

  // Reset state when lead changes
  useEffect(() => {
    setPrompts(null);
    setInferredIndustry(null);
    setError(null);
  }, [lead?.id]);

  const handleClear = () => {
    setPrompts(null);
    setError(null);
  };

  const handleRefresh = () => {
    fetchPrompts(true);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-[400px] bg-zinc-950 border-l border-zinc-800 z-[70] shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <Sparkles className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Coach Me</h2>
                  <p className="text-[10px] text-emerald-500 font-mono uppercase tracking-widest">NEPQ Tactical Assistant</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {lead ? (
                <>
                  {/* Lead Info Card */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-lg font-bold text-emerald-500">
                        {lead.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-white">{lead.name}</h3>
                        <p className="text-xs text-zinc-500">{lead.industry || 'Unknown Industry'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Prompts Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">NEPQ Prompts</h4>
                      <div className="flex gap-2">
                        <button 
                          onClick={handleClear}
                          className="p-1.5 text-zinc-500 hover:text-rose-500 transition-colors"
                          title="Clear Prompts"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={handleRefresh}
                          disabled={isLoading}
                          className={cn(
                            "p-1.5 text-zinc-500 hover:text-emerald-500 transition-colors",
                            isLoading && "animate-spin"
                          )}
                          title="Refresh Prompts"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isLoading ? (
                      <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-24 bg-zinc-900 animate-pulse rounded-2xl border border-zinc-800" />
                        ))}
                      </div>
                    ) : prompts ? (
                      <div className="space-y-4">
                        <PromptCard 
                          icon={<MessageSquare className="w-4 h-4 text-blue-400" />}
                          title="Connecting Question"
                          description="Lower resistance and establish rapport."
                          content={prompts.connecting}
                        />
                        <PromptCard 
                          icon={<Target className="w-4 h-4 text-amber-400" />}
                          title="Problem Awareness"
                          description="Uncover the underlying pain points."
                          content={prompts.problem}
                        />
                        <PromptCard 
                          icon={<AlertCircle className="w-4 h-4 text-rose-400" />}
                          title="Consequence Question"
                          description="Create urgency by highlighting inaction."
                          content={prompts.consequence}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                        <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
                          <Sparkles className="w-6 h-6 text-zinc-700" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-zinc-400">No prompts generated yet.</p>
                          <p className="text-[10px] text-zinc-600">Click refresh to initialize tactical coaching.</p>
                        </div>
                        <button 
                          onClick={handleRefresh}
                          className="px-4 py-2 bg-emerald-500 text-zinc-950 rounded-lg text-xs font-bold hover:bg-emerald-400 transition-colors"
                        >
                          Generate Prompts
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
                    <Target className="w-8 h-8 text-zinc-700" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-white">No Lead Selected</h3>
                    <p className="text-sm text-zinc-500">Select a lead from the radar to access tactical NEPQ coaching prompts.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-600 font-mono uppercase text-center">
                Powered by Gemini 3 Flash • NEPQ Methodology
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const PromptCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  content: string;
}> = ({ icon, title, description, content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-700 transition-colors group"
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h5 className="text-xs font-bold text-white uppercase tracking-tight">{title}</h5>
      </div>
      <p className="text-[10px] text-zinc-500 mb-3 leading-relaxed">{description}</p>
      <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800 group-hover:border-emerald-500/30 transition-colors">
        <p className="text-sm text-zinc-200 italic leading-relaxed">"{content}"</p>
      </div>
      <div className="mt-3 flex justify-end">
        <button 
          onClick={handleCopy}
          className="text-[9px] text-emerald-500 font-bold uppercase tracking-widest flex items-center gap-1 hover:text-emerald-400 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy to clipboard'} <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
};
