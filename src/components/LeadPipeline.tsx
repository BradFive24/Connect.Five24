import React from 'react';
import { motion, Reorder } from 'motion/react';
import { Lead, LeadStatus } from '../types';
import { DollarSign, Clock, MessageSquare, Target, CheckCircle2, XCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LeadPipelineProps {
  leads: Lead[];
  onUpdateStatus: (leadId: string, status: LeadStatus) => void;
  onSelectLead: (lead: Lead) => void;
}

const STATUS_COLUMNS: { id: LeadStatus; label: string; icon: any; color: string }[] = [
  { id: 'new', label: 'New Radar Hits', icon: Target, color: 'text-emerald-500' },
  { id: 'contacted', label: 'Initial Contact', icon: MessageSquare, color: 'text-blue-500' },
  { id: 'qualified', label: 'Qualified Leads', icon: TrendingUp, color: 'text-purple-500' },
  { id: 'proposal', label: 'Proposal Sent', icon: DollarSign, color: 'text-amber-500' },
  { id: 'closed', label: 'Closed Won', icon: CheckCircle2, color: 'text-emerald-400' },
  { id: 'lost', label: 'Closed Lost', icon: XCircle, color: 'text-rose-500' },
];

export const LeadPipeline: React.FC<LeadPipelineProps> = ({ leads, onUpdateStatus, onSelectLead }) => {
  const getLeadsByStatus = (status: LeadStatus) => leads.filter(l => l.crm.status === status);

  return (
    <div className="flex gap-6 h-full overflow-x-auto pb-6 px-6 custom-scrollbar">
      {STATUS_COLUMNS.map((column) => (
        <div key={column.id} className="flex flex-col w-80 shrink-0">
          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-2">
              <column.icon className={cn("w-4 h-4", column.color)} />
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">{column.label}</h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
              {getLeadsByStatus(column.id).length}
            </span>
          </div>

          <div className="flex-1 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-3 space-y-3 overflow-y-auto custom-scrollbar">
            {getLeadsByStatus(column.id).map((lead) => (
              <motion.div
                key={lead.id}
                layoutId={lead.id}
                onClick={() => onSelectLead(lead)}
                className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-all cursor-pointer group relative overflow-hidden"
              >
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-bold text-sm truncate pr-2 group-hover:text-emerald-400 transition-colors">{lead.source.name}</h4>
                  <div className="flex gap-1">
                    {lead.crm.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                    <DollarSign className="w-3 h-3 text-emerald-500" />
                    <span className={lead.crm.monetaryValue > 0 ? "text-emerald-400" : ""}>
                      ${lead.crm.monetaryValue.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                    <Clock className="w-3 h-3 text-zinc-600" />
                    <span>{new Date(lead.compliance.collectedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                  <div className="flex -space-x-1">
                    <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-900 flex items-center justify-center text-[8px] font-bold text-zinc-500">
                      {lead.crm.ownerName?.split(' ').map(n => n[0]).join('') || '??'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {STATUS_COLUMNS.filter(s => s.id !== column.id).slice(0, 2).map(s => (
                      <button
                        key={s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateStatus(lead.id, s.id);
                        }}
                        className="p-1 hover:bg-zinc-800 rounded transition-colors"
                        title={`Move to ${s.label}`}
                      >
                        <s.icon className="w-3 h-3 text-zinc-600 hover:text-zinc-400" />
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}

            {getLeadsByStatus(column.id).length === 0 && (
              <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-xl opacity-30">
                <AlertCircle className="w-6 h-6 mb-2" />
                <p className="text-[10px] uppercase tracking-widest font-bold">No Leads</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
