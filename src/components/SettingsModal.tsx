import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, MapPin, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  geminiKey: string;
  mapsKey: string;
  onSave: (geminiKey: string, mapsKey: string) => void;
}

export function SettingsModal({ isOpen, onClose, geminiKey, mapsKey, onSave }: SettingsModalProps) {
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiKey);
  const [localMapsKey, setLocalMapsKey] = useState(mapsKey);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setLocalGeminiKey(geminiKey);
    setLocalMapsKey(mapsKey);
  }, [geminiKey, mapsKey]);

  const handleSave = () => {
    onSave(localGeminiKey, localMapsKey);
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[2rem] shadow-2xl overflow-hidden"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-xl">
                    <Key className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h2 className="text-xl font-bold tracking-tight uppercase italic">Connection Settings</h2>
                </div>
                <button 
                  onClick={onClose}
                  className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Key className="w-3 h-3" />
                    Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={localGeminiKey}
                    onChange={(e) => setLocalGeminiKey(e.target.value)}
                    placeholder="Enter your Gemini API Key"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <p className="text-[9px] text-zinc-600 leading-relaxed">
                    Used for AI-powered lead generation and sales coaching.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <MapPin className="w-3 h-3" />
                    Google Maps Platform Key
                  </label>
                  <input
                    type="password"
                    value={localMapsKey}
                    onChange={(e) => setLocalMapsKey(e.target.value)}
                    placeholder="Enter your Google Maps API Key"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <p className="text-[9px] text-zinc-600 leading-relaxed">
                    Used for real-time radar tracking and local business search.
                  </p>
                </div>

                <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
                  <div className="flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-500/80 leading-relaxed font-medium">
                      Keys are stored locally in your browser. They are used only for client-side API calls and are never sent to our servers.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-10">
                <button
                  onClick={handleSave}
                  disabled={isSaved}
                  className={cn(
                    "w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
                    isSaved 
                      ? "bg-emerald-500 text-zinc-950" 
                      : "bg-white text-zinc-950 hover:bg-zinc-200"
                  )}
                >
                  {isSaved ? (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      SETTINGS SAVED
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      SAVE CONNECTION KEYS
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
