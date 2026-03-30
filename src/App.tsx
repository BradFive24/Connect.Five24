import React, { useState, useEffect, useCallback } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { Radar, Target, MessageSquare, Plus, RefreshCw, DollarSign, Clock, MapPin, Loader2, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { db, auth } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, addDoc, serverTimestamp, updateDoc, doc, getDoc, where } from 'firebase/firestore';
import { Lead } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { seedInitialLeads } from './seed';
import { getCoachPrompts, validateGeminiConnection } from './services/coachService';
import { signIn, signOut } from './firebase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-10">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl">
            <h1 className="text-2xl font-bold text-red-500 mb-4">SYSTEM CRITICAL ERROR</h1>
            <p className="text-zinc-400 mb-6">The tactical radar has encountered an unrecoverable failure.</p>
            <pre className="bg-black p-4 rounded-lg text-xs text-red-400 overflow-auto mb-6">
              {this.state.error?.message || 'Unknown Error'}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-100 text-zinc-950 rounded-xl font-bold hover:bg-white transition-colors"
            >
              REBOOT SYSTEM
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

const DEBUG_MODE = false;

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isCoachOpen, setIsCoachOpen] = useState(false);
  const [huntLocation, setHuntLocation] = useState({ lat: 37.42, lng: -122.08 });
  const [coachData, setCoachData] = useState<{ connecting: string; problem: string; consequence: string } | null>(null);
  const [isCoaching, setIsCoaching] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  
  // Mission Briefing & Auth State
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; onboardingCompleted: boolean; hasAccessToken: boolean; expiryDate?: number } | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [hasBeenAuthenticated, setHasBeenAuthenticated] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [tacticalStatus, setTacticalStatus] = useState<string>('');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState(false);
  
  const displayLeads = (DEBUG_MODE && leads.length === 0) ? [
    {
      id: 'debug-1',
      name: "Tactical Coffee Co.",
      industry: "Coffee Shop",
      rating: 4.8,
      userRatingCount: 412,
      location: { lat: 37.422, lng: -122.084 },
      formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043",
      monetaryValue: 5000,
      bornOn: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      notes: "Debug mode active."
    },
    {
      id: 'debug-2',
      name: "Precision Auto Repair",
      industry: "Automotive",
      rating: 4.5,
      userRatingCount: 128,
      location: { lat: 37.415, lng: -122.075 },
      formattedAddress: "800 N Shoreline Blvd, Mountain View, CA 94043",
      monetaryValue: 12000,
      bornOn: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      notes: "Owner is looking for lead gen."
    }
  ] : leads;

  const checkAuthStatus = useCallback(async (retries = 3) => {
    setIsCheckingAuth(true);
    console.log(`TACTICAL LOG: Checking auth status at /api/auth/status (Retries left: ${retries})`);
    try {
      const res = await axios.get('/api/auth/status', { withCredentials: true });
      console.log('TACTICAL LOG: Auth status response status:', res.status);
      const data = res.data;
      console.log('TACTICAL LOG: Auth status data:', data);
      if (data.debug) {
        console.log('TACTICAL DEBUG: Server Redirect URI:', data.debug.redirectUri);
        console.log('TACTICAL DEBUG: Server App URL:', data.debug.appUrl);
        console.log('TACTICAL DEBUG: Client ID Set:', data.debug.clientIdSet);
        
        if (data.debug.redirectUri && !data.debug.redirectUri.startsWith(window.location.origin)) {
          console.warn('TACTICAL WARNING: Server REDIRECT_URI mismatch with current origin:', window.location.origin);
        }
      }
      setAuthStatus(data);
      
      if (data.authenticated) {
        setHasBeenAuthenticated(true);
        if (data.onboardingCompleted) {
          setOnboardingStep(3); // Skip to Tactical Radar
        } else {
          setOnboardingStep(2); // Go to Step 2 of onboarding
        }
      } else {
        console.log('TACTICAL LOG: User not authenticated.');
      }
    } catch (error: any) {
      console.error('TACTICAL ERROR: Failed to check auth status:', error);
      if (error.response) {
        console.error('TACTICAL ERROR: Response data:', error.response.data);
        console.error('TACTICAL ERROR: Response status:', error.response.status);
        
        // Break the loop if 401 (Unauthorized)
        if (error.response.status === 401) {
          console.warn('TACTICAL WARNING: 401 Unauthorized - Clearing session state.');
          setAuthStatus({ authenticated: false, onboardingCompleted: false, hasAccessToken: false });
          setHasBeenAuthenticated(false);
          return; // Stop retrying
        }
      } else if (error.request) {
        console.error('TACTICAL ERROR: Request made but no response received:', error.request);
      } else {
        console.error('TACTICAL ERROR: Error setting up request:', error.message);
      }
      
      if (retries > 0) {
        console.log('TACTICAL LOG: Retrying auth check in 2s...');
        setTimeout(() => checkAuthStatus(retries - 1), 2000);
      }
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    console.log('Auth Status Changed:', authStatus);
  }, [authStatus]);

  useEffect(() => {
    console.log('Tactical Radar Initializing...');
    console.log('API Key Status:', GOOGLE_MAPS_API_KEY ? `PRESENT (ends in ...${GOOGLE_MAPS_API_KEY.slice(-4)})` : 'MISSING');
    
    if (DEBUG_MODE) {
      setAuthStatus({ authenticated: true, onboardingCompleted: true, hasAccessToken: true });
      setOnboardingStep(3);
      setIsCheckingAuth(false);
    }
    checkAuthStatus();
    
    // Only validate once per session
    if (!sessionStorage.getItem('gemini_validated')) {
      validateGeminiConnection().then(success => {
        if (success) sessionStorage.setItem('gemini_validated', 'true');
      });
    }

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);
    });
    
    // Catch Google Maps API errors
    const originalError = console.error;
    console.error = (...args) => {
      const message = args.join(' ');
      if (message.includes('ApiTargetBlockedMapError')) {
        setMapError('ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.');
      }
      originalError.apply(console, args);
    };

    // Standard Google Maps auth failure handler
    (window as any).gm_authFailure = () => {
      console.error('Google Maps authentication failed (gm_authFailure)');
      setMapError('ApiTargetBlockedMapError: Authentication failed. Please check your API key restrictions in Google Cloud Console.');
    };

    // Map loading timeout
    const mapTimeout = setTimeout(() => {
      if (!simulationMode && !mapError) {
        console.warn('Map loading timeout - offering Simulation Mode');
        setMapError('Map loading timeout: The radar is taking too long to initialize. This could be due to API key restrictions or network issues.');
      }
    }, 15000);

    const handleMessage = (event: MessageEvent) => {
      console.log('Received message from origin:', event.origin, 'Data:', event.data);
      
      // Validate origin is from AI Studio preview, localhost, or any Firebase Auth domain
      const origin = event.origin;
      const isAuthorizedOrigin = 
        origin.endsWith('.run.app') || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        origin.endsWith('.firebaseapp.com') ||
        origin === 'https://connect.five24creativestudio.com';
      
      if (!isAuthorizedOrigin) {
        console.warn('Unauthorized message origin:', origin);
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log('IDENTITY CONNECTED: Re-establishing tactical link in 1s...');
        setTimeout(() => {
          checkAuthStatus();
        }, 1000);
      }
    };
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
      authUnsubscribe();
      console.error = originalError;
      clearTimeout(mapTimeout);
    };
  }, [checkAuthStatus, simulationMode, mapError]);

  const handleSelectLead = useCallback((lead: Lead) => {
    setSelectedLead(lead);
    setIsCoachOpen(true);
    setCoachData(null); // Reset coach data for new lead
  }, []);

  // Firestore Sync Effect
  useEffect(() => {
    if (!isAuthReady || !firebaseUser) {
      setLeads([]);
      return;
    }

    console.log('Syncing data for user:', firebaseUser.uid);
    seedInitialLeads(firebaseUser.uid);

    const q = query(collection(db, 'leads'), where('userId', '==', firebaseUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Lead[];
      setLeads(leadsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leads');
    });

    return () => unsubscribe();
  }, [isAuthReady, firebaseUser]);

  const handleConnectIdentity = async () => {
    console.log('TACTICAL LOG: Initiating identity connection sequence...');
    
    try {
      // Step 1: Ensure Firebase Auth
      if (!auth.currentUser) {
        console.log('TACTICAL LOG: Step 1 - Firebase Auth Popup');
        try {
          await signIn();
          console.log('TACTICAL LOG: Firebase Auth successful. User should click again for GCP link.');
          // We stop here to ensure the next window.open is a direct user gesture
          return;
        } catch (firebaseError: any) {
          if (firebaseError.code === 'auth/unauthorized-domain') {
            const domain = window.location.hostname;
            alert(`TACTICAL ERROR: Domain Unauthorized.\n\nPlease add "${domain}" to your Firebase Authorized Domains list in the Firebase Console.`);
          } else if (firebaseError.code === 'auth/popup-blocked') {
            alert('TACTICAL ERROR: Popup blocked. Please allow popups for this site to sign in.');
          } else {
            throw firebaseError;
          }
          return;
        }
      }

      // Step 2: Fetch GCP OAuth URL
      console.log('TACTICAL LOG: Step 2 - Fetching GCP OAuth URL...');
      const res = await fetch('/api/auth/url', { credentials: 'include' });
      if (!res.ok) throw new Error(`Server error (${res.status}) fetching auth URL`);
      
      const { url, redirectUri } = await res.json();
      console.log('TACTICAL LOG: Redirect URI being used:', redirectUri);
      
      if (url && !url.includes('undefined')) {
        console.log('TACTICAL LOG: Opening GCP OAuth popup...');
        const authWindow = window.open(
          url,
          'oauth_popup',
          'width=600,height=700'
        );
        if (!authWindow) {
          alert('TACTICAL ERROR: Popup blocked. Please allow popups for this site to connect your GCP identity.');
        }
      } else {
        throw new Error('Invalid OAuth URL received from server');
      }
    } catch (error: any) {
      console.error('TACTICAL ERROR: Identity connection failed:', error);
      alert(`TACTICAL ERROR: Connection failed: ${error.message}`);
    }
  };

  const handleInitializeRadar = async () => {
    setIsInitializing(true);
    setInitializationError(null);
    setTacticalStatus('Establishing Satellite Link...');
    
    try {
      // Status progression for long-running GCP tasks
      const statusTimer1 = setTimeout(() => setTacticalStatus('Enabling Maps & Places APIs...'), 3000);
      const statusTimer2 = setTimeout(() => setTacticalStatus('Synching Tactical Database...'), 8000);
      
      const res = await fetch('/api/gcp/initialize', { 
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      
      clearTimeout(statusTimer1);
      clearTimeout(statusTimer2);
      
      if (data.success) {
        setTacticalStatus('Radar Active.');
        setOnboardingStep(3);
      } else {
        setInitializationError(data.error || 'Failed to initialize radar');
      }
    } catch (error) {
      setInitializationError('Tactical link failed. Check connection.');
    } finally {
      setIsInitializing(false);
    }
  };

  // Loading Tactical Environment Splash Screen
  if ((isCheckingAuth || isInitializing) && !DEBUG_MODE) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="relative w-24 h-24 mx-auto mb-8">
            <motion.div 
              className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
            <motion.div 
              className="absolute inset-0 border-t-4 border-emerald-500 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Radar className="w-10 h-10 text-emerald-500" />
            </div>
          </div>
          <h2 className="text-xl font-bold tracking-widest uppercase italic mb-2">
            {isInitializing ? 'Initializing Tactical Radar' : 'Loading Tactical Environment'}
          </h2>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] font-bold animate-pulse">
            {isInitializing ? tacticalStatus : 'Establishing Secure Connection...'}
          </p>
        </motion.div>
      </div>
    );
  }

  // Login Screen (Initial)
  if (!authStatus?.authenticated && !hasBeenAuthenticated && !DEBUG_MODE) {
    const isFirebaseAuthed = !!firebaseUser;
    
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md w-full bg-zinc-900 border border-zinc-800 p-12 rounded-[2.5rem] shadow-2xl"
        >
          <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <Radar className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tighter uppercase italic">Five24 Connect</h1>
          <p className="text-zinc-500 mb-12 text-sm font-medium leading-relaxed">
            {isFirebaseAuthed 
              ? "Firebase link established. Now connect your tactical GCP identity to access the radar."
              : "The ultimate tactical radar for high-stakes business hunting. Sign in to begin the operation."}
          </p>
          
          <button 
            onClick={handleConnectIdentity}
            className="w-full py-5 bg-white text-zinc-950 rounded-2xl font-black text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-4 shadow-xl shadow-white/5 group"
          >
            <img src="https://www.google.com/favicon.ico" className="w-6 h-6 group-hover:scale-110 transition-transform" alt="Google" />
            {isFirebaseAuthed ? "CONNECT TACTICAL IDENTITY" : "SIGN IN WITH GOOGLE"}
          </button>
          
          {isFirebaseAuthed && (
            <button
              onClick={() => auth.signOut()}
              className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-widest font-bold"
            >
              Sign Out of Firebase
            </button>
          )}
          
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition-colors flex items-center justify-center gap-1 mx-auto"
          >
            <RefreshCw className="w-3 h-3" />
            FORCE REFRESH
          </button>
          
          <p className="mt-10 text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-bold">Secure Tactical Environment v2.0</p>
        </motion.div>
      </div>
    );
  }

  // Radar Signal Lost Screen (Expired Session)
  if (!authStatus?.authenticated && hasBeenAuthenticated && !DEBUG_MODE) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg bg-zinc-900 border border-zinc-800 p-10 rounded-3xl shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/20">
            <motion.div 
              className="h-full bg-emerald-500"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
          </div>
          
          <Radar className="w-16 h-16 text-emerald-500 mx-auto mb-8 animate-pulse" />
          <h2 className="text-3xl font-bold mb-4 tracking-tighter uppercase italic">Radar Signal Lost</h2>
          <p className="text-zinc-400 mb-10 text-sm leading-relaxed">
            Your tactical identity has been disconnected. Re-establish the link to resume the hunt.
          </p>
          
          <button 
            onClick={handleConnectIdentity}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-900/20"
          >
            <RefreshCw className="w-5 h-5" />
            RECONNECT WITH GOOGLE
          </button>
        </motion.div>
      </div>
    );
  }


  // Mission Briefing Overlay (Onboarding)
  if (onboardingStep < 3 && !DEBUG_MODE) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-md p-6">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-2xl w-full bg-zinc-900 border border-zinc-800 p-10 rounded-3xl shadow-2xl"
        >
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 bg-emerald-500/10 rounded-2xl">
              <Radar className="w-8 h-8 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">MISSION BRIEFING</h1>
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Operation: Five24 Connect</p>
            </div>
          </div>

          <div className="space-y-8 mb-12">
            {/* Step 1 */}
            <div className={cn("flex gap-6 transition-opacity", onboardingStep !== 1 && "opacity-40")}>
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors",
                onboardingStep >= 1 ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"
              )}>1</div>
              <div>
                <h3 className="text-lg font-bold mb-1">Connect Identity</h3>
                <p className="text-zinc-400 text-sm mb-4">Link your Google Cloud account to authorize tactical operations.</p>
                {onboardingStep === 1 && (
                  <button 
                    onClick={handleConnectIdentity}
                    className="px-6 py-2.5 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Connect Google Account
                  </button>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div className={cn("flex gap-6 transition-opacity", onboardingStep !== 2 && "opacity-40")}>
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors",
                onboardingStep >= 2 ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"
              )}>2</div>
              <div>
                <h3 className="text-lg font-bold mb-1">Initialize Radar</h3>
                <p className="text-zinc-400 text-sm mb-4">Provision Maps & Places APIs on your tactical project.</p>
                {onboardingStep === 2 && (
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <button 
                        onClick={handleInitializeRadar}
                        disabled={isInitializing}
                        className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        {isInitializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Initialize Radar Services
                      </button>
                      <button 
                        onClick={() => {
                          setSimulationMode(true);
                          setOnboardingStep(3);
                        }}
                        className="px-6 py-2.5 bg-zinc-800 text-zinc-400 rounded-lg font-bold hover:bg-zinc-700 transition-colors"
                      >
                        Skip to Simulation
                      </button>
                    </div>
                    {initializationError && (
                      <p className="text-red-400 text-xs font-medium">{initializationError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-zinc-800 flex justify-between items-center">
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Secure Tactical Link Required</p>
            {onboardingStep === 3 && (
              <button 
                onClick={() => setOnboardingStep(3)}
                className="px-8 py-3 bg-emerald-500 text-zinc-950 rounded-xl font-bold hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
              >
                BEGIN THE HUNT
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const isExpired = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 25;
  };

  const handleCoachMe = async () => {
    if (!selectedLead) return;
    setIsCoaching(true);
    setIsCoachOpen(true);
    
    let industry = selectedLead.industry;
    
    // Leverage Google Places API to infer industry if not provided
    if (!industry && selectedLead.placeId) {
      try {
        setTacticalStatus('Inferring Industry Dynamics...');
        const res = await axios.get(`/api/gcp/place-details/${selectedLead.placeId}`, { withCredentials: true });
        const details = res.data.result;
        if (details && details.types && details.types.length > 0) {
          // Map Google types to a readable industry string
          // Filter out generic types like 'point_of_interest', 'establishment'
          const specificTypes = details.types.filter((t: string) => !['point_of_interest', 'establishment', 'premise'].includes(t));
          industry = specificTypes[0]?.replace(/_/g, ' ') || 'General Business';
          console.log(`TACTICAL LOG: Inferred industry for ${selectedLead.name}: ${industry}`);
          
          // Optionally update the lead in Firestore with the inferred industry
          const leadRef = doc(db, 'leads', selectedLead.id);
          await updateDoc(leadRef, { industry });
        }
      } catch (error) {
        console.warn('TACTICAL WARNING: Failed to infer industry via Places API:', error);
      }
    }

    const data = await getCoachPrompts(industry || 'General Business', selectedLead.name);
    setCoachData(data);
    setIsCoaching(false);
  };

  const handleScrub = async () => {
    if (!selectedLead) return;
    setIsScrubbing(true);
    // Simulate re-fetching Google Places data
    setTimeout(async () => {
      try {
        const leadRef = doc(db, 'leads', selectedLead.id);
        const now = new Date().toISOString();
        await updateDoc(leadRef, {
          lastUpdated: now,
          rating: (selectedLead.rating || 4.0) + (Math.random() * 0.2 - 0.1),
          userRatingCount: (selectedLead.userRatingCount || 100) + Math.floor(Math.random() * 10)
        });
        // Update local state
        const updatedDoc = await getDoc(leadRef);
        setSelectedLead({ id: updatedDoc.id, ...updatedDoc.data() } as Lead);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `leads/${selectedLead.id}`);
      } finally {
        setIsScrubbing(false);
      }
    }, 1500);
  };

  const handleUpdateValue = async (newValue: number) => {
    if (!selectedLead) return;
    try {
      const leadRef = doc(db, 'leads', selectedLead.id);
      await updateDoc(leadRef, { monetaryValue: newValue });
      const updatedDoc = await getDoc(leadRef);
      setSelectedLead({ id: updatedDoc.id, ...updatedDoc.data() } as Lead);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `leads/${selectedLead.id}`);
    }
  };

  const handleUpdateNotes = async (newNotes: string) => {
    if (!selectedLead) return;
    try {
      const leadRef = doc(db, 'leads', selectedLead.id);
      await updateDoc(leadRef, { notes: newNotes });
      const updatedDoc = await getDoc(leadRef);
      setSelectedLead({ id: updatedDoc.id, ...updatedDoc.data() } as Lead);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `leads/${selectedLead.id}`);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar - Lead List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/50 backdrop-blur-xl">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Radar className="w-6 h-6 text-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight">Five24 Connect</h1>
          </div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Solo Edition // Tactical Radar</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-mono text-zinc-500 uppercase">Active Leads ({displayLeads.length})</span>
            <button className="p-1 hover:bg-zinc-800 rounded transition-colors">
              <Plus className="w-4 h-4 text-emerald-500" />
            </button>
          </div>
          
          {displayLeads.map((lead) => (
            <motion.div
              key={lead.id}
              layoutId={lead.id}
              onClick={() => setSelectedLead(lead)}
              className={cn(
                "p-4 rounded-xl border cursor-pointer transition-all duration-200 group",
                selectedLead?.id === lead.id 
                  ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]" 
                  : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
              )}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-sm truncate pr-2">{lead.name}</h3>
                {lead.rating && (
                  <div className="flex items-center gap-1 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                    <span>{lead.rating.toFixed(1)}</span>
                    <span className="text-emerald-500">★</span>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="flex items-center gap-1 text-zinc-500">
                  <DollarSign className="w-3 h-3" />
                  <span className={lead.monetaryValue > 0 ? "text-emerald-400" : ""}>
                    ${lead.monetaryValue.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-zinc-500 justify-end">
                  <Clock className="w-3 h-3" />
                  <span className={isExpired(lead.lastUpdated) ? "text-rose-500" : "text-zinc-400"}>
                    {new Date(lead.bornOn).toLocaleDateString()}
                  </span>
                </div>
              </div>
              
              {isExpired(lead.lastUpdated) && (
                <div className="mt-2 flex items-center gap-1 text-[9px] text-rose-500 uppercase font-bold tracking-tighter">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin-slow" />
                  Compliance Scrub Required
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Main Map View */}
      <div className="flex-1 relative">
        {(!GOOGLE_MAPS_API_KEY || mapError) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-10 text-center">
            <div className="max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl">
              <MapPin className="w-12 h-12 text-rose-500 mx-auto mb-4 animate-bounce" />
              <h3 className="text-xl font-bold mb-2 uppercase italic">Radar Offline: {mapError ? 'API Error' : 'Missing Key'}</h3>
              
              <div className="text-left bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-xs space-y-4 mb-6">
                <div className="space-y-1">
                  <p className="font-bold text-rose-500 uppercase tracking-widest text-[10px]">Error Detected:</p>
                  <p className="text-zinc-400 font-mono">{mapError || 'ApiTargetBlockedMapError'}</p>
                </div>

                <div className="space-y-2">
                  <p className="font-bold text-emerald-500 uppercase tracking-widest text-[10px]">Action Required:</p>
                  <ol className="list-decimal list-inside space-y-2 text-zinc-400">
                    <li>Open <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" className="underline text-emerald-400 hover:text-emerald-300">Google Cloud Console</a></li>
                    <li>Select your project and click on the API Key.</li>
                    <li>Under <strong>API restrictions</strong>, ensure <strong>"Maps JavaScript API"</strong> is checked.</li>
                    <li>Click <strong>Save</strong> and wait 60 seconds for propagation.</li>
                  </ol>
                </div>

                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-[9px] text-zinc-600">Note: If you just enabled it, the change may take a few minutes to reflect globally.</p>
                </div>
              </div>

              <button 
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-zinc-100 text-zinc-950 rounded-xl font-bold hover:bg-white transition-colors flex items-center justify-center gap-2 mb-3"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Radar
              </button>

              <button 
                onClick={() => {
                  setSimulationMode(true);
                  setMapError(null);
                }}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2 mb-3"
              >
                <Radar className="w-4 h-4" />
                Launch Simulation Mode
              </button>

              <button 
                onClick={() => setOnboardingStep(2)}
                className="w-full py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Re-Initialize Radar Services
              </button>
            </div>
          </div>
        )}

        {simulationMode ? (
          <div className="w-full h-full bg-[#09090b] relative overflow-hidden flex items-center justify-center">
            {/* Simulation Radar Background */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at center, #10b981 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-[300px] h-[300px] border border-emerald-500/30 rounded-full" />
                <div className="w-[600px] h-[600px] border border-emerald-500/20 rounded-full absolute" />
                <div className="w-[900px] h-[900px] border border-emerald-500/10 rounded-full absolute" />
              </div>
            </div>

            {/* Simulation Sweep */}
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="absolute w-[1000px] h-[1000px] origin-center pointer-events-none"
              style={{ background: 'conic-gradient(from 0deg, #10b981 0%, transparent 20%)', opacity: 0.1 }}
            />

            {/* Simulation Markers */}
            {displayLeads.map((lead, idx) => (
              <motion.div
                key={lead.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => handleSelectLead(lead)}
                className="absolute cursor-pointer group"
                style={{ 
                  left: `${50 + (idx % 2 === 0 ? 1 : -1) * (15 + idx * 5)}%`, 
                  top: `${50 + (idx % 3 === 0 ? 1 : -1) * (10 + idx * 8)}%` 
                }}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 border-white shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-transform group-hover:scale-125",
                  selectedLead?.id === lead.id ? "bg-emerald-500 scale-125" : "bg-zinc-800"
                )} />
                <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 px-2 py-1 rounded text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                  {lead.name}
                </div>
              </motion.div>
            ))}

            <div className="absolute bottom-6 right-6 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-3 rounded-xl text-xs font-mono text-emerald-500 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              SIMULATION MODE ACTIVE
            </div>
          </div>
        ) : (
          <APIProvider 
            apiKey={GOOGLE_MAPS_API_KEY} 
            version="weekly"
            onLoad={() => {
              console.log('Maps API Loaded Successfully');
              setMapError(null);
            }}
          >
          <Map
            {...{
              defaultCenter: huntLocation,
              defaultZoom: 13,
              mapId: "DEMO_MAP_ID",
              internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
              className: "w-full h-full",
              disableDefaultUI: true,
              styles: [
                { elementType: "geometry", stylers: [{ color: "#18181b" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#18181b" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#71717a" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#27272a" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#09090b" }] },
              ]
            } as any}
          >
            {displayLeads.map((lead) => (
              <AdvancedMarker
                key={lead.id}
                position={lead.location}
                onClick={() => handleSelectLead(lead)}
              >
                <div className={cn(
                  "relative flex items-center justify-center transition-transform hover:scale-110",
                  selectedLead?.id === lead.id ? "scale-125" : ""
                )}>
                  <div className={cn(
                    "absolute w-8 h-8 rounded-full animate-ping opacity-20",
                    isExpired(lead.lastUpdated) ? "bg-rose-500" : "bg-emerald-500"
                  )} />
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 border-zinc-950 shadow-lg",
                    isExpired(lead.lastUpdated) ? "bg-rose-500" : "bg-emerald-500"
                  )} />
                </div>
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
        )}

        {/* Overlay Controls */}
        <div className="absolute top-6 left-6 flex flex-col gap-2">
          {DEBUG_MODE && (
            <div className="bg-rose-500/20 backdrop-blur-md border border-rose-500/50 p-2 rounded-lg text-[9px] font-bold uppercase tracking-tighter text-rose-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Debug Mode: Maps JS API Required
            </div>
          )}
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-3 rounded-xl flex items-center gap-3 shadow-2xl">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Hunt Location</span>
              <span className="text-sm font-mono">37.42° N, 122.08° W</span>
            </div>
          </div>
        </div>

        {/* Lead Detail Popup - REMOVED in favor of Side Panel */}
        <AnimatePresence>
          {false && selectedLead && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[400px] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-xl font-bold mb-1">{selectedLead.name}</h2>
                    <p className="text-xs text-zinc-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {selectedLead.formattedAddress}
                    </p>
                  </div>
                  <button 
                    onClick={() => setSelectedLead(null)}
                    className="text-zinc-500 hover:text-zinc-100"
                  >
                    <Plus className="w-5 h-5 rotate-45" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block mb-1">Monetary Value</span>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-emerald-500" />
                      <input 
                        type="number"
                        defaultValue={selectedLead.monetaryValue}
                        onBlur={(e) => handleUpdateValue(Number(e.target.value))}
                        className="bg-transparent text-lg font-mono w-full outline-none focus:text-emerald-400"
                      />
                    </div>
                  </div>
                  <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block mb-1">Compliance Age</span>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-zinc-400" />
                      <span className={cn(
                        "text-lg font-mono",
                        isExpired(selectedLead.lastUpdated) ? "text-rose-500" : "text-zinc-400"
                      )}>
                        {Math.ceil(Math.abs(new Date().getTime() - new Date(selectedLead.lastUpdated).getTime()) / (1000 * 60 * 60 * 24))}d
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 mb-6">
                  <span className="text-[10px] text-zinc-500 uppercase block mb-1">Tactical Notes</span>
                  <textarea 
                    key={selectedLead.id}
                    defaultValue={selectedLead.notes || ""}
                    onBlur={(e) => handleUpdateNotes(e.target.value)}
                    placeholder="Add tactical intelligence here..."
                    className="bg-transparent text-sm w-full outline-none focus:text-emerald-400 min-h-[80px] resize-none"
                  />
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={handleCoachMe}
                    disabled={isCoaching}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isCoaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                    Coach Me
                  </button>
                  <button 
                    onClick={handleScrub}
                    disabled={isScrubbing}
                    className="bg-zinc-800 hover:bg-zinc-700 p-3 rounded-xl transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-5 h-5", isScrubbing && "animate-spin")} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* AI Coach Side Panel */}
      <AnimatePresence>
        {isCoachOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl z-50 flex flex-col"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-500" />
                <h2 className="font-bold uppercase tracking-widest text-sm">Tactical Intelligence</h2>
              </div>
              <button 
                onClick={() => {
                  setIsCoachOpen(false);
                  setSelectedLead(null);
                }}
                className="text-zinc-500 hover:text-zinc-100"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {selectedLead ? (
                <>
                  {/* Lead Profile */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-xl font-bold mb-1">{selectedLead.name}</h2>
                        <p className="text-xs text-zinc-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {selectedLead.formattedAddress}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase block mb-1">Monetary Value</span>
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-emerald-500" />
                          <input 
                            type="number"
                            defaultValue={selectedLead.monetaryValue}
                            onBlur={(e) => handleUpdateValue(Number(e.target.value))}
                            className="bg-transparent text-sm font-mono w-full outline-none focus:text-emerald-400"
                          />
                        </div>
                      </div>
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase block mb-1">Compliance Age</span>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-zinc-400" />
                          <span className={cn(
                            "text-sm font-mono",
                            isExpired(selectedLead.lastUpdated) ? "text-rose-500" : "text-zinc-400"
                          )}>
                            {Math.ceil(Math.abs(new Date().getTime() - new Date(selectedLead.lastUpdated).getTime()) / (1000 * 60 * 60 * 24))}d
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 uppercase block mb-1">Tactical Notes</span>
                      <textarea 
                        key={selectedLead.id}
                        defaultValue={selectedLead.notes || ""}
                        onBlur={(e) => handleUpdateNotes(e.target.value)}
                        placeholder="Add tactical intelligence here..."
                        className="bg-transparent text-xs w-full outline-none focus:text-emerald-400 min-h-[60px] resize-none"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={handleCoachMe}
                        disabled={isCoaching}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      >
                        {isCoaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                        Coach Me
                      </button>
                      <button 
                        onClick={handleScrub}
                        disabled={isScrubbing}
                        className="bg-zinc-800 hover:bg-zinc-700 p-2.5 rounded-xl transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-4 h-4", isScrubbing && "animate-spin")} />
                      </button>
                    </div>
                  </div>

                  <div className="h-px bg-zinc-800" />

                  {/* AI Coach Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-emerald-500" />
                      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">NEPQ Sales Coach</h3>
                    </div>
                    
                    {isCoaching ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-4 opacity-50">
                        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                        <p className="text-[10px] font-mono animate-pulse uppercase tracking-widest">Analyzing Industry Dynamics...</p>
                      </div>
                    ) : coachData ? (
                      <div className="space-y-3">
                        <motion.div 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="p-4 bg-zinc-950 rounded-xl border border-zinc-800"
                        >
                          <span className="text-[10px] text-zinc-600 uppercase block mb-1 font-bold tracking-tighter">Connecting Question</span>
                          <p className="text-sm italic text-zinc-300">"{coachData.connecting}"</p>
                        </motion.div>
                        <motion.div 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 }}
                          className="p-4 bg-zinc-950 rounded-xl border border-zinc-800"
                        >
                          <span className="text-[10px] text-zinc-600 uppercase block mb-1 font-bold tracking-tighter">Problem Awareness</span>
                          <p className="text-sm italic text-zinc-300">"{coachData.problem}"</p>
                        </motion.div>
                        <motion.div 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                          className="p-4 bg-zinc-950 rounded-xl border border-zinc-800"
                        >
                          <span className="text-[10px] text-zinc-600 uppercase block mb-1 font-bold tracking-tighter">Consequence Question</span>
                          <p className="text-sm italic text-zinc-300">"{coachData.consequence}"</p>
                        </motion.div>
                      </div>
                    ) : (
                      <div className="text-center py-10 bg-zinc-950/50 rounded-xl border border-dashed border-zinc-800">
                        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Click "Coach Me" to generate tactical prompts.</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-6">
                  <div className="w-20 h-20 bg-zinc-950 rounded-full flex items-center justify-center border border-zinc-800 shadow-inner">
                    <Radar className="w-10 h-10 text-zinc-700 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold uppercase italic tracking-tighter">Tactical Coach Offline</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Select a lead on the radar to activate the NEPQ AI Coach. 
                      The system will analyze the target's industry and provide tactical sales prompts.
                    </p>
                  </div>
                  <div className="w-full pt-6 border-t border-zinc-800/50">
                    <div className="flex items-center gap-3 text-[10px] text-zinc-600 uppercase font-bold tracking-widest text-left">
                      <div className="w-1 h-1 rounded-full bg-emerald-500" />
                      Satellite Link: Active
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-600 uppercase font-bold tracking-widest text-left mt-2">
                      <div className="w-1 h-1 rounded-full bg-emerald-500" />
                      Gemini AI: Ready
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
