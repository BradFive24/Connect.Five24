import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Calendar, 
  Bell, 
  UserPlus, 
  ChevronRight, 
  Star, 
  Phone, 
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Target
} from 'lucide-react';
import { Lead, Interaction } from '../types';
import { cn } from '../lib/utils';

interface ActivityCenterProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
}

export default function ActivityCenter({ leads, onSelectLead }: ActivityCenterProps) {
  // Extract all appointments and reminders from all leads
  const activities = useMemo(() => {
    const all: { lead: Lead; interaction: Interaction }[] = [];
    leads.forEach(lead => {
      lead.crm.interactionHistory.forEach(int => {
        if ((int.type === 'appointment' || int.type === 'reminder') && !int.completed) {
          all.push({ lead, interaction: int });
        }
      });
    });
    
    // Sort by due date
    return all.sort((a, b) => {
      const dateA = new Date(a.interaction.dueDate || '').getTime();
      const dateB = new Date(b.interaction.dueDate || '').getTime();
      return dateA - dateB;
    });
  }, [leads]);

  const appointments = activities.filter(a => a.interaction.type === 'appointment');
  const reminders = activities.filter(a => a.interaction.type === 'reminder');

  // "Who to Contact Next" Logic
  const topProspects = useMemo(() => {
    return [...leads]
      .map(lead => {
        let score = 0;
        
        // 1. Rating Count (Lower count = higher potential for growth services)
        const ratingCount = lead.source.userRatingCount || 0;
        score += Math.max(0, 100 - ratingCount);
        
        // 2. Phone Number (Presence is a huge plus for outreach)
        if (lead.source.phoneNumber) score += 50;
        
        // 3. Age of Listing (Older collected date without recent contact = higher priority)
        const collectedDate = new Date(lead.compliance.collectedAt).getTime();
        const now = Date.now();
        const daysOld = (now - collectedDate) / (1000 * 60 * 60 * 24);
        score += Math.min(100, daysOld * 2);
        
        // 4. Status Penalty (Don't prioritize closed or lost)
        if (lead.crm.status === 'closed' || lead.crm.status === 'lost' || lead.crm.status === 'rejected') {
          score = -100;
        }

        return { lead, score };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [leads]);

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-12">
      <header>
        <h2 className="text-4xl font-black tracking-tighter uppercase italic mb-2">Activity Center</h2>
        <p className="text-zinc-500 text-xs uppercase tracking-[0.4em] font-bold">Strategic Planning & Outreach Intelligence</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Appointments Column */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Appointments</h3>
            </div>
            <span className="text-[10px] bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full font-bold">{appointments.length}</span>
          </div>
          
          <div className="space-y-3">
            {appointments.length === 0 ? (
              <div className="p-8 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl border-dashed flex flex-col items-center justify-center text-center">
                <Calendar className="w-8 h-8 text-zinc-800 mb-2" />
                <p className="text-xs text-zinc-600 font-bold uppercase tracking-widest">No scheduled meetings</p>
              </div>
            ) : (
              appointments.map(({ lead, interaction }, i) => (
                <motion.div
                  key={interaction.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onSelectLead(lead)}
                  className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-blue-500/50 transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">
                        {new Date(interaction.dueDate || '').toLocaleDateString()} @ {new Date(interaction.dueDate || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">{lead.source.name}</p>
                    </div>
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Clock className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{interaction.content}</p>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Reminders Column */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Reminders</h3>
            </div>
            <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full font-bold">{reminders.length}</span>
          </div>

          <div className="space-y-3">
            {reminders.length === 0 ? (
              <div className="p-8 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl border-dashed flex flex-col items-center justify-center text-center">
                <Bell className="w-8 h-8 text-zinc-800 mb-2" />
                <p className="text-xs text-zinc-600 font-bold uppercase tracking-widest">All caught up</p>
              </div>
            ) : (
              reminders.map(({ lead, interaction }, i) => (
                <motion.div
                  key={interaction.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onSelectLead(lead)}
                  className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-amber-500/50 transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">
                        Due: {new Date(interaction.dueDate || '').toLocaleDateString()}
                      </p>
                      <p className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">{lead.source.name}</p>
                    </div>
                    <div className="p-2 bg-amber-500/10 rounded-lg">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{interaction.content}</p>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Who to Contact Next Column */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Who to Contact Next</h3>
          </div>

          <div className="space-y-4">
            {topProspects.length === 0 ? (
              <div className="p-8 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl border-dashed flex flex-col items-center justify-center text-center">
                <UserPlus className="w-8 h-8 text-zinc-800 mb-2" />
                <p className="text-xs text-zinc-600 font-bold uppercase tracking-widest">No high-priority leads</p>
              </div>
            ) : (
              topProspects.map(({ lead, score }, i) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => onSelectLead(lead)}
                  className="p-5 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-emerald-500/50 transition-all cursor-pointer group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-12 -mt-12 blur-2xl" />
                  
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500 group-hover:text-emerald-500 transition-colors">
                        {lead.source.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{lead.source.name}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{lead.crm.status}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Priority</p>
                      <p className="text-lg font-black text-white">{Math.round(score)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-zinc-950/50 rounded-xl p-2 border border-zinc-800/50">
                      <div className="flex items-center gap-1 mb-1">
                        <Star className="w-2.5 h-2.5 text-amber-500" />
                        <span className="text-[8px] text-zinc-500 font-bold uppercase">Ratings</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-300">{lead.source.userRatingCount || 0}</p>
                    </div>
                    <div className="bg-zinc-950/50 rounded-xl p-2 border border-zinc-800/50">
                      <div className="flex items-center gap-1 mb-1">
                        <Phone className="w-2.5 h-2.5 text-blue-500" />
                        <span className="text-[8px] text-zinc-500 font-bold uppercase">Phone</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-300">{lead.source.phoneNumber ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="bg-zinc-950/50 rounded-xl p-2 border border-zinc-800/50">
                      <div className="flex items-center gap-1 mb-1">
                        <Clock className="w-2.5 h-2.5 text-purple-500" />
                        <span className="text-[8px] text-zinc-500 font-bold uppercase">Age</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-300">
                        {Math.floor((Date.now() - new Date(lead.compliance.collectedAt).getTime()) / (1000 * 60 * 60 * 24))}d
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">High Potential</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-emerald-500 transition-colors" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
