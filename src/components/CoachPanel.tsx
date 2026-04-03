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
  Clock,
  Phone,
  Navigation,
  User,
  ShieldCheck,
  Save,
  Globe,
  Star,
  Mail,
  Tag,
  History,
  Plus,
  CheckCircle2
} from 'lucide-react';
import axios from 'axios';
import { Lead, LeadStatus, Interaction } from '../types';
import { getCoachPrompts } from '../services/coachService';
import { cn } from '../lib/utils';

interface CoachPanelProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateLead?: (lead: Lead) => void;
  userGeminiKey?: string;
}

interface NEPQPrompts {
  connecting: string;
  problem: string;
  consequence: string;
}

export const CoachPanel: React.FC<CoachPanelProps> = ({ lead, isOpen, onClose, onUpdateLead, userGeminiKey }) => {
  const [prompts, setPrompts] = useState<NEPQPrompts | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inferredIndustry, setInferredIndustry] = useState<string | null>(null);
  
  // CRM States
  const [ownerName, setOwnerName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<LeadStatus>('new');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [monetaryValue, setMonetaryValue] = useState(0);
  const [nextStep, setNextStep] = useState('');
  const [verifiedByEU, setVerifiedByEU] = useState(false);

  // Interaction Log State
  const [logContent, setLogContent] = useState('');
  const [logType, setLogType] = useState<Interaction['type']>('note');

  useEffect(() => {
    if (lead) {
      setOwnerName(lead.crm.ownerName || '');
      setManagerName(lead.crm.managerName || '');
      setEmail(lead.crm.email || '');
      setNotes(lead.crm.notes || '');
      setStatus(lead.crm.status || 'new');
      setTags(lead.crm.tags || []);
      setMonetaryValue(lead.crm.monetaryValue || 0);
      setNextStep(lead.crm.nextStep || '');
      setVerifiedByEU(lead.compliance.verifiedByEU || false);
    }
  }, [lead]);

  const handleToggleVerification = async () => {
    if (!lead || !onUpdateLead) return;
    const newValue = !verifiedByEU;
    setVerifiedByEU(newValue);
    
    // Save immediately to Firestore
    onUpdateLead({
      ...lead,
      compliance: {
        ...lead.compliance,
        verifiedByEU: newValue
      }
    });
  };

  const handleSaveCRM = async () => {
    if (!lead || !onUpdateLead) return;
    setIsSaving(true);
    try {
      onUpdateLead({
        ...lead,
        crm: {
          ...lead.crm,
          ownerName,
          managerName,
          email,
          notes,
          status,
          tags,
          monetaryValue,
          nextStep,
        },
        compliance: {
          ...lead.compliance,
          verifiedByEU
        }
      });
    } finally {
      setIsSaving(false);
    }
  };

  const addInteraction = async (type: Interaction['type'], content: string) => {
    if (!lead || !onUpdateLead || !content.trim()) return;
    
    const newInteraction: Interaction = {
      id: `int-${Date.now()}`,
      type,
      content,
      timestamp: new Date().toISOString()
    };

    onUpdateLead({
      ...lead,
      crm: {
        ...lead.crm,
        interactionHistory: [newInteraction, ...lead.crm.interactionHistory]
      }
    });
    setLogContent('');
  };

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
      let industry = inferredIndustry;
      
      if (!industry && lead.placeId) {
        industry = await inferIndustry(lead.placeId);
        setInferredIndustry(industry);
      }

      const data = await getCoachPrompts(industry || 'General', lead.source.name, userGeminiKey);
      setPrompts(data);
    } catch (err) {
      console.error('Failed to fetch coach prompts:', err);
      setError('Connection failed. Using default prompts.');
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
                  <p className="text-[10px] text-emerald-500 font-mono uppercase tracking-widest">NEPQ Sales Assistant</p>
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
            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              {lead ? (
                <>
                  {/* Source Data Layer (Read-Only) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Source Data Layer</h4>
                      <span className="text-[9px] text-zinc-600 font-mono">Synced: {new Date(lead.source.lastSynced).toLocaleDateString()}</span>
                    </div>
                    
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-xl font-bold text-zinc-500 border border-zinc-700">
                          {lead.source?.name?.charAt(0) || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-white truncate">{lead.source?.name || 'Unknown Business'}</h3>
                          <p className="text-[10px] text-zinc-500 truncate flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {lead.source?.formattedAddress || 'No Address'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {lead.source?.phoneNumber && (
                          <a 
                            href={`tel:${lead.source.phoneNumber}`}
                            className="flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-900/20"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            CALL NOW
                          </a>
                        )}
                        <a 
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lead.source?.formattedAddress || lead.source?.name || '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          NAVIGATE
                        </a>
                      </div>

                      <div className="pt-4 border-t border-zinc-800 grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">Google Rating</p>
                          <div className="flex items-center gap-1 text-xs font-bold text-white">
                            <Star className="w-3 h-3 text-emerald-500 fill-emerald-500" />
                            {lead.source?.rating || 'N/A'}
                            <span className="text-[10px] text-zinc-600 font-normal">({lead.source?.userRatingCount || 0})</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">Place ID</p>
                          <p className="text-[10px] text-zinc-600 font-mono truncate">{lead.placeId}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CRM Data Layer (Editable) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">CRM Data Layer</h4>
                      <button 
                        onClick={handleSaveCRM}
                        disabled={isSaving}
                        className="text-[10px] text-emerald-500 hover:text-emerald-400 font-bold uppercase flex items-center gap-1 transition-colors"
                      >
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save CRM
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Status Selector */}
                      <div className="grid grid-cols-4 gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                        {(['new', 'contacted', 'follow-up', 'closed'] as LeadStatus[]).map((s) => (
                          <button
                            key={s}
                            onClick={() => setStatus(s)}
                            className={cn(
                              "py-1.5 text-[8px] font-bold uppercase tracking-widest rounded-lg transition-all",
                              status === s ? "bg-zinc-800 text-emerald-500 shadow-lg" : "text-zinc-600 hover:text-zinc-400"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[9px] text-zinc-600 uppercase font-bold ml-1">Owner Name</label>
                          <div className="relative">
                            <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                            <input 
                              type="text"
                              value={ownerName}
                              onChange={(e) => setOwnerName(e.target.value)}
                              placeholder="Owner..."
                              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:border-emerald-500 outline-none transition-all"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] text-zinc-600 uppercase font-bold ml-1">Manager Name</label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                            <input 
                              type="text"
                              value={managerName}
                              onChange={(e) => setManagerName(e.target.value)}
                              placeholder="Manager..."
                              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:border-emerald-500 outline-none transition-all"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] text-zinc-600 uppercase font-bold ml-1">Email Address</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                          <input 
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="business@email.com"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:border-emerald-500 outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] text-zinc-600 uppercase font-bold ml-1">Notes</label>
                        <textarea 
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Log general notes here..."
                          rows={3}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-emerald-500 outline-none transition-all resize-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] text-zinc-600 uppercase font-bold ml-1">Tags</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {tags.map((tag, i) => (
                            <span key={i} className="text-[9px] bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-800 text-zinc-400 flex items-center gap-1">
                              <Tag className="w-2.5 h-2.5" />
                              {tag}
                              <button onClick={() => setTags(tags.filter((_, idx) => idx !== i))} className="hover:text-rose-500">×</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (setTags([...tags, newTag]), setNewTag(''))}
                            placeholder="Add tag..."
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-4 text-xs text-white focus:border-emerald-500 outline-none transition-all"
                          />
                          <button 
                            onClick={() => { if(newTag) { setTags([...tags, newTag]); setNewTag(''); } }}
                            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl border border-zinc-700"
                          >
                            <Plus className="w-4 h-4 text-zinc-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Interaction Log */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Interaction History</h4>
                      <History className="w-3.5 h-3.5 text-zinc-600" />
                    </div>

                    <div className="space-y-4">
                      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
                        <div className="flex gap-2">
                          {(['call', 'visit', 'note'] as Interaction['type'][]).map((t) => (
                            <button
                              key={t}
                              onClick={() => setLogType(t)}
                              className={cn(
                                "flex-1 py-1.5 text-[8px] font-bold uppercase tracking-widest rounded-lg border transition-all",
                                logType === t ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500" : "bg-zinc-950 border-zinc-800 text-zinc-600"
                              )}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        <textarea 
                          value={logContent}
                          onChange={(e) => setLogContent(e.target.value)}
                          placeholder={`Log a ${logType}...`}
                          rows={2}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-emerald-500 outline-none transition-all resize-none"
                        />
                        <button 
                          onClick={() => addInteraction(logType, logContent)}
                          disabled={!logContent.trim()}
                          className="w-full py-2 bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                        >
                          <Plus className="w-3 h-3" />
                          Log Interaction
                        </button>
                      </div>

                      <div className="space-y-3">
                        {lead.crm.interactionHistory.map((int) => (
                          <div key={int.id} className="relative pl-6 pb-4 border-l border-zinc-800 last:pb-0">
                            <div className="absolute left-[-4.5px] top-0 w-2 h-2 rounded-full bg-zinc-800 border border-zinc-700" />
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className={cn(
                                  "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                                  int.type === 'call' ? "bg-blue-500/10 text-blue-500" :
                                  int.type === 'visit' ? "bg-amber-500/10 text-amber-500" :
                                  int.type === 'status_change' ? "bg-purple-500/10 text-purple-500" :
                                  "bg-zinc-800 text-zinc-400"
                                )}>
                                  {int.type}
                                </span>
                                <span className="text-[8px] text-zinc-600 font-mono">{new Date(int.timestamp).toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-zinc-300">{int.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Compliance & Verification */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Compliance</h4>
                      {lead.compliance.verifiedByEU ? (
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold uppercase tracking-widest">Verified</span>
                      ) : (
                        <span className="text-[9px] bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-full border border-rose-500/20 font-bold uppercase tracking-widest">Unverified</span>
                      )}
                    </div>
                    
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-white">Verified by EU</p>
                          <p className="text-[10px] text-zinc-500">Exempt from 28-day compliance purge.</p>
                        </div>
                        <button
                          onClick={handleToggleVerification}
                          className={cn(
                            "w-12 h-6 rounded-full transition-all relative",
                            verifiedByEU ? "bg-emerald-600" : "bg-zinc-800"
                          )}
                        >
                          <motion.div 
                            animate={{ x: verifiedByEU ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>

                      <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-[10px] text-zinc-500 font-mono">Collected: {new Date(lead.compliance.collectedAt).toLocaleDateString()}</span>
                        </div>
                        {!verifiedByEU && (
                          <div className="flex items-center gap-1 text-[9px] text-rose-500 font-bold uppercase">
                            <AlertCircle className="w-3 h-3" />
                            Purge in {Math.max(0, 28 - Math.ceil(Math.abs(new Date().getTime() - new Date(lead.compliance.collectedAt).getTime()) / (1000 * 60 * 60 * 24)))} days
                          </div>
                        )}
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
                          <p className="text-[10px] text-zinc-600">Click refresh to initialize sales coaching.</p>
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
                    <p className="text-sm text-zinc-500">Select a lead from the radar to access NEPQ coaching prompts.</p>
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
