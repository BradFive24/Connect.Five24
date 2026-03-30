import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin for server-side fetching
const adminApp = initializeApp({
  projectId: 'five24-lead-tracker-9644-5809c',
});
const adminDb = getFirestore(adminApp, 'ai-studio-bd05be3f-6d8f-43fb-9650-10916abf7e85');

// OAuth Configuration
const rawAppUrl = process.env.APP_URL || 'https://connect.five24creativestudio.com';
const APP_URL = rawAppUrl.endsWith('/') ? rawAppUrl.slice(0, -1) : rawAppUrl;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${APP_URL}/auth/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set. OAuth will fail.');
}

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log('Starting Tactical Server...');
  console.log('Environment Check:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- APP_URL:', APP_URL);
  console.log('- GOOGLE_CLIENT_ID:', CLIENT_ID ? 'SET' : 'MISSING');
  console.log('- GOOGLE_CLIENT_SECRET:', CLIENT_SECRET ? 'SET' : 'MISSING');
  console.log('- REDIRECT_URI:', REDIRECT_URI);
  
  if (APP_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: APP_URL is set to localhost in production. Redirects may fail.');
  }

  app.set('trust proxy', 1);
  app.use(cors({
    origin: (origin, callback) => {
      console.log('CORS Request Origin:', origin);
      // Allow AI Studio preview URLs and localhost
      if (!origin || origin.endsWith('.run.app') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, true);
      } else {
        console.warn('CORS Blocked for Origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());
  
  // Request Logger
  app.use((req, res, next) => {
    console.log(`[TACTICAL SERVER] ${req.method} ${req.url}`);
    next();
  });

  app.use(session({
    secret: 'five24-mission-secret-key-v5',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'five24-session',
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  // Auth Middleware
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = (req as any).session;
    if (session && session.tokens) {
      next();
    } else {
      console.warn(`[TACTICAL AUTH] Unauthorized access attempt to ${req.url}`);
      res.status(401).json({ error: 'Unauthorized: No tactical session found' });
    }
  };

  // API Routes
  app.get('/api/auth/test', (req, res) => {
    (req as any).session.test = 'ok';
    res.json({ 
      session: (req as any).session,
      cookies: req.headers.cookie,
      trustProxy: app.get('trust proxy')
    });
  });

  app.get('/api/leads', requireAuth, async (req, res) => {
    try {
      const snapshot = await adminDb.collection('leads').get();
      const leads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(leads);
    } catch (error) {
      console.error('Server-side fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });

  // OAuth Routes
  // Dynamic URL helper
  const getAppUrl = (req: express.Request) => {
    // If APP_URL is set to the production domain, prioritize it
    if (APP_URL && !APP_URL.includes('.run.app')) {
      return APP_URL;
    }
    
    // Otherwise, use dynamic detection (useful for AI Studio previews)
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    return `${protocol}://${host}`;
  };

  app.get('/api/auth/url', (req, res) => {
    try {
      const currentAppUrl = getAppUrl(req);
      const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;
      
      console.log('--- TACTICAL OAUTH CONFIG ---');
      console.log('Current App URL:', currentAppUrl);
      console.log('Redirect URI:', dynamicRedirectUri);
      console.log('CLIENT_ID:', CLIENT_ID ? 'SET' : 'MISSING');
      console.log('-----------------------------');
      
      if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Google OAuth credentials missing on server');
      }

      const oauth2ClientDynamic = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, dynamicRedirectUri);
      const url = oauth2ClientDynamic.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/cloud-platform',
        ],
        prompt: 'consent',
      });
      res.json({ url, redirectUri: dynamicRedirectUri });
    } catch (error: any) {
      console.error('Error in /api/auth/url:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    const currentAppUrl = getAppUrl(req);
    const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;

    try {
      console.log('Exchanging code for tokens...');
      const oauth2ClientDynamic = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, dynamicRedirectUri);
      const { tokens } = await oauth2ClientDynamic.getToken(code as string);
      console.log('Tokens received successfully.');
      
      if ((req as any).session) {
        (req as any).session.tokens = tokens;
        console.log('Session tokens set in express-session.');
        (req as any).session.save((err: any) => {
          if (err) console.error('Session save error:', err);
          
          res.send(`
            <html>
              <body style="background: #09090b; color: #10b981; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
                <div style="text-align: center;">
                  <h1 style="margin-bottom: 10px;">IDENTITY CONNECTED</h1>
                  <p style="color: #71717a;">Closing tactical link...</p>
                  <script>
                    if (window.opener) {
                      window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                      setTimeout(() => window.close(), 100);
                    } else {
                      window.location.href = '/';
                    }
                  </script>
                </div>
              </body>
            </html>
          `);
        });
      } else {
        console.error('Session object missing from request.');
        res.status(500).send('Session initialization failed');
      }
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/auth/status', async (req, res) => {
    const session = (req as any).session;
    const tokens = session?.tokens;
    const authenticated = !!tokens;
    
    console.log('--- AUTH STATUS CHECK ---');
    console.log('Session ID exists:', !!session);
    console.log('Tokens exist:', authenticated);
    console.log('Cookies received:', req.headers.cookie);
    console.log('User-Agent:', req.headers['user-agent']);
    console.log('Origin:', req.headers.origin);
    console.log('Referer:', req.headers.referer);
    console.log('-------------------------');

    let onboardingCompleted = false;
    if (authenticated && tokens.access_token) {
      try {
        const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        oauth2Client.setCredentials(tokens);
        
        if (tokens.id_token) {
          const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: CLIENT_ID,
          });
          const payload = ticket.getPayload();
          const email = payload?.email;
          console.log('Verified Email:', email);

          if (email) {
            const userDoc = await adminDb.collection('users').doc(email).get();
            if (userDoc.exists && userDoc.data()?.onboardingCompleted) {
              onboardingCompleted = true;
            }
          }
        } else {
          console.warn('No id_token found in session tokens.');
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
      }
    }

    res.json({ 
      authenticated,
      onboardingCompleted,
      hasAccessToken: !!tokens?.access_token,
      expiryDate: tokens?.expiry_date,
      debug: {
        redirectUri: REDIRECT_URI,
        appUrl: APP_URL,
        clientIdSet: !!CLIENT_ID
      }
    });
  });

  app.post('/api/gcp/initialize', requireAuth, async (req, res) => {
    const tokens = (req as any).session?.tokens;

    try {
      console.log('TACTICAL LOG: Initializing GCP Radar Services...');
      
      // 1. Get user's projects
      const projectsRes = await axios.get('https://cloudresourcemanager.googleapis.com/v1/projects', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      
      const projects = projectsRes.data.projects;
      if (!projects || projects.length === 0) {
        return res.status(404).json({ error: 'No GCP projects found. Please create one at console.cloud.google.com' });
      }

      const projectId = projects[0].projectId;
      console.log(`TACTICAL LOG: Target Project ID: ${projectId}`);
      
      // 2. Enable Maps and Places APIs in PARALLEL to prevent hangup
      const apisToEnable = [
        'maps-backend.googleapis.com',
        'places-backend.googleapis.com',
        'geocoding-backend.googleapis.com'
      ];

      console.log('TACTICAL LOG: Enabling Radar APIs...');
      await Promise.all(apisToEnable.map(api => 
        axios.post(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${api}:enable`, {}, {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        }).catch(err => {
          console.warn(`Warning: Could not enable ${api}:`, err.message);
          return null; // Continue even if one fails
        })
      ));

      // 3. Mark onboarding as completed in Firestore
      const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2Client.setCredentials(tokens);
      
      let userEmail = 'unknown';
      if (tokens.id_token) {
        try {
          const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: CLIENT_ID,
          });
          userEmail = ticket.getPayload()?.email || 'unknown';
        } catch (e) {
          console.warn('ID Token verification failed, using fallback.');
        }
      }

      if (userEmail !== 'unknown') {
        await adminDb.collection('users').doc(userEmail).set({
          onboardingCompleted: true,
          projectId,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      if ((req as any).session) {
        (req as any).session.onboardingCompleted = true;
        (req as any).session.projectId = projectId;
      }
      res.json({ success: true, projectId });
    } catch (error: any) {
      console.error('GCP initialization error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Failed to initialize radar services', details: error.response?.data });
    }
  });

  app.get('/api/gcp/place-details/:placeId', requireAuth, async (req, res) => {
    const tokens = (req as any).session?.tokens;
    const { placeId } = req.params;
    try {
      console.log(`TACTICAL LOG: Fetching details for Place ID: ${placeId}`);
      const response = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
        params: {
          place_id: placeId,
          fields: 'name,type,editorial_summary,formatted_address',
          key: process.env.GOOGLE_MAPS_PLATFORM_KEY // Use server-side key if available, or user's token if permitted
        }
      });

      // Note: Places API usually requires an API Key, but we can also use the access token 
      // if the user has the right scopes. However, standard Places API (New) or Maps JS API 
      // is preferred. Here we use the server-side key for reliability.
      
      res.json(response.data);
    } catch (error: any) {
      console.error('Place Details Error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Failed to fetch place details' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Five24 Connect Server running on http://localhost:${PORT}`);
  });
}

startServer();
