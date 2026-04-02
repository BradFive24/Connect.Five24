import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Sparkles, MapPin, Target, Loader2, Plus, Phone, Globe, Star, AlertCircle } from 'lucide-react';
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleGenAI, Type } from "@google/genai";
import { setDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Lead, LeadStatus } from '../types';

declare const google: any;

interface SearchResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  phoneNumber: string;
  rating?: number;
  userRatingCount?: number;
  location: {
    lat: number;
    lng: number;
  };
}

interface LeadGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadConverted: (lead: Lead) => void;
  isSimulationMode?: boolean;
  mapError?: string | null;
}

export const LeadGenerationModal: React.FC<LeadGenerationModalProps> = ({ 
  isOpen, 
  onClose, 
  onLeadConverted,
  isSimulationMode = false,
  mapError = null
}) => {
  const map = useMap();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          // Reverse geocode to get a friendly name if needed, but we'll just use coords for search
        },
        (error) => console.error("Geolocation error:", error)
      );
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt) return;
    
    setIsGenerating(true);
    setResults([]);

    // Fallback to Gemini if Map/Places is not available or in simulation mode
    if (!map || typeof google === 'undefined' || isSimulationMode || mapError) {
      console.warn("Maps API not available or in simulation mode, falling back to Gemini AI");
      await handleGenerateAI();
      return;
    }

    try {
      const service: any = new google.maps.places.PlacesService(map);
      
      const request: any = {
        query: prompt,
        location: userCoords ? new google.maps.LatLng(userCoords.lat, userCoords.lng) : undefined,
        radius: 5000, // 5km radius
      };

      service.textSearch(request, async (results: any[], status: string) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          const searchResults: SearchResult[] = results.map((result) => ({
            placeId: result.place_id,
            name: result.name || 'Unknown Business',
            rating: result.rating,
            userRatingCount: result.user_ratings_total,
            location: {
              lat: result.geometry?.location?.lat() || 0,
              lng: result.geometry?.location?.lng() || 0
            },
            formattedAddress: result.formatted_address,
            phoneNumber: '', 
          }));

          const detailedResultsPromises = searchResults.slice(0, 10).map(res => {
            return new Promise<SearchResult>((resolve) => {
              if (!res.placeId) return resolve(res);
              service.getDetails({
                placeId: res.placeId,
                fields: ['formatted_phone_number']
              }, (details: any, detailStatus: string) => {
                if (detailStatus === google.maps.places.PlacesServiceStatus.OK && details) {
                  resolve({
                    ...res,
                    phoneNumber: details.formatted_phone_number || '',
                  });
                } else {
                  resolve(res);
                }
              });
            });
          });

          const finalResults = await Promise.all(detailedResultsPromises);
          setResults(finalResults);
          setIsGenerating(false);
        } else {
          console.error("Places search failed, falling back to AI:", status);
          await handleGenerateAI();
        }
      });
    } catch (error) {
      console.error('Lead generation failed, falling back to AI:', error);
      await handleGenerateAI();
    }
  };

  const handleGenerateAI = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate 5 realistic business leads for a sales person. 
        Industry/Keyword: ${prompt}
        Location: Current immediate area
        Return the data as a JSON array of leads. Each lead should have:
        - name: string
        - rating: number (1-5)
        - userRatingCount: number
        - formattedAddress: string
        - phoneNumber: string
        - lat: number (near current location)
        - lng: number (near current location)
        - placeId: string (random unique string)`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                rating: { type: Type.NUMBER },
                userRatingCount: { type: Type.NUMBER },
                formattedAddress: { type: Type.STRING },
                phoneNumber: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                placeId: { type: Type.STRING }
              },
              required: ["name", "rating", "userRatingCount", "formattedAddress", "phoneNumber", "lat", "lng", "placeId"]
            }
          }
        }
      });

      const rawResults = JSON.parse(response.text || '[]');
      const processedResults: SearchResult[] = rawResults.map((l: any) => ({
        placeId: l.placeId,
        name: l.name,
        rating: l.rating,
        userRatingCount: l.userRatingCount,
        location: { lat: l.lat, lng: l.lng },
        formattedAddress: l.formattedAddress,
        phoneNumber: l.phoneNumber,
      }));

      setResults(processedResults);
    } catch (error) {
      console.error('AI Lead generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConvert = async (result: SearchResult) => {
    if (!auth.currentUser) return;
    setConvertingId(result.placeId);
    
    try {
      const leadId = `lead-${result.placeId}-${auth.currentUser.uid}`;
      const newLead: Lead = {
        id: leadId,
        userId: auth.currentUser.uid,
        placeId: result.placeId,
        source: {
          name: result.name,
          formattedAddress: result.formattedAddress,
          phoneNumber: result.phoneNumber,
          rating: result.rating,
          userRatingCount: result.userRatingCount,
          location: result.location,
          lastSynced: new Date().toISOString()
        },
        crm: {
          ownerName: '',
          managerName: '',
          email: '',
          notes: '',
          status: 'new',
          tags: [],
          interactionHistory: [
            {
              id: `init-${Date.now()}`,
              type: 'note',
              content: 'Lead converted from search results.',
              timestamp: new Date().toISOString()
            }
          ],
          monetaryValue: 0
        },
        compliance: {
          verifiedByEU: false,
          collectedAt: new Date().toISOString()
        }
      };

      await setDoc(doc(db, 'leads', leadId), newLead);
      onLeadConverted(newLead);
      setResults(prev => prev.filter(r => r.placeId !== result.placeId));
    } catch (error) {
      console.error('Failed to convert lead:', error);
    } finally {
      setConvertingId(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-[2rem] overflow-hidden shadow-2xl"
          >
            <div className="p-8 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-xl">
                  <MapPin className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight uppercase italic">Local Business Radar</h2>
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Real-Time Google Places Data</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                <X className="w-6 h-6 text-zinc-500" />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 ml-1">Search Nearby Businesses</label>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g. Lawn Care, Plumbers, Coffee..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-sm focus:border-emerald-500 outline-none transition-all"
                      onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    />
                  </div>
                  {(!map || typeof google === 'undefined' || isSimulationMode || mapError) ? (
                    <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <AlertCircle className="w-3 h-3 text-amber-500" />
                      <p className="text-[9px] text-amber-500 font-bold uppercase tracking-tighter">
                        Radar Offline - Using AI Simulation Fallback
                      </p>
                    </div>
                  ) : userCoords && (
                    <p className="text-[9px] text-emerald-500 font-mono uppercase tracking-tighter flex items-center gap-1">
                      <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      Using immediate geographic location
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-900/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {(!map || typeof google === 'undefined' || isSimulationMode || mapError) ? 'GENERATING AI PROSPECTS...' : 'FETCHING LIVE DATA...'}
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    {(!map || typeof google === 'undefined' || isSimulationMode || mapError) ? 'INITIALIZE AI SCAN' : 'SEARCH NEARBY'}
                  </>
                )}
              </button>

              {results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex justify-between items-center px-1">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Local Results ({results.length})</h3>
                    <button onClick={() => setResults([])} className="text-[10px] text-zinc-600 hover:text-zinc-400 uppercase font-bold">Clear All</button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {results.map((result) => (
                      <div key={result.placeId} className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl flex justify-between items-start group hover:border-emerald-500/50 transition-colors">
                        <div className="flex-1">
                          <h4 className="font-bold text-sm mb-1">{result.name}</h4>
                          <p className="text-[10px] text-zinc-500 mb-2 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {result.formattedAddress}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {result.phoneNumber && (
                              <span className="text-[9px] bg-zinc-900 px-2 py-0.5 rounded-full text-zinc-400 border border-zinc-800 flex items-center gap-1">
                                <Phone className="w-2.5 h-2.5" />
                                {result.phoneNumber}
                              </span>
                            )}
                            {result.rating && (
                              <div className="flex items-center gap-1 text-[9px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                                <span>{result.rating}</span>
                                <Star className="w-2.5 h-2.5 text-emerald-500 fill-emerald-500" />
                                <span className="text-zinc-600">({result.userRatingCount})</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleConvert(result)}
                          disabled={convertingId === result.placeId}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2"
                        >
                          {convertingId === result.placeId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          Convert
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-center pt-4">
                    <img 
                      src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" 
                      alt="Powered by Google"
                      className="h-4 opacity-50 grayscale hover:grayscale-0 transition-all"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
