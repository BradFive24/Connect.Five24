import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cookieSession from 'cookie-session';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin for server-side fetching
const getAdminConfig = () => {
  try {
    let configStr = process.env.FIREBASE_WEBAPP_CONFIG;
    
    // Fallback to firebase-applet-config.json if env var is missing
    if (!configStr) {
      const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        configStr = fs.readFileSync(configPath, 'utf-8');
      }
    }

    if (configStr) {
      const config = JSON.parse(configStr);
      return {
        projectId: config.projectId,
        databaseId: config.firestoreDatabaseId || '(default)'
      };
    }
  } catch (error) {
    console.error('Failed to parse FIREBASE_WEBAPP_CONFIG in server:', error);
  }
  // Fallback to hardcoded values for local dev if not in env or file
  return {
    projectId: 'gen-lang-client-0470290044',
    databaseId: 'ai-studio-bd05be3f-6d8f-43fb-9650-10916abf7e85'
  };
};

const adminConfig = getAdminConfig();
const adminApp = initializeApp({
  projectId: adminConfig.projectId,
});
const adminDb = getFirestore(adminApp, adminConfig.databaseId);

// OAuth Configuration
const rawAppUrl = process.env.APP_URL || 'https://connect.five24creativestudio.com';
const APP_URL = rawAppUrl.endsWith('/') ? rawAppUrl.slice(0, -1) : rawAppUrl;

// Trim whitespace and quotes to prevent common copy-paste errors
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim().replace(/^["']|["']$/g, '');
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim().replace(/^["']|["']$/g, '');
const REDIRECT_URI = `${APP_URL}/auth/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set. OAuth will fail.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log('Starting Five24 Connect Server...');
  console.log('Environment Check:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- APP_URL:', APP_URL);
  console.log('- GOOGLE_CLIENT_ID:', CLIENT_ID ? `SET (${CLIENT_ID.substring(0, 10)}...)` : 'MISSING');
  console.log('- GOOGLE_CLIENT_SECRET:', CLIENT_SECRET ? `SET (Length: ${CLIENT_SECRET.length}, Starts with: ${CLIENT_SECRET.substring(0, 4)}...)` : 'MISSING');
  console.log('- REDIRECT_URI:', REDIRECT_URI);
  
  if (APP_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: APP_URL is set to localhost in production. Redirects may fail.');
  }

  app.set('trust proxy', 1);
  app.use(cors({
    origin: (origin, callback) => {
      // Allow all .run.app origins (AI Studio) and local development
      if (!origin || 
          origin.endsWith('.run.app') || 
          origin.includes('localhost') || 
          origin.includes('127.0.0.1') ||
          origin.includes('five24creativestudio.com')) {
        callback(null, true);
      } else {
        console.warn('[CORS] Blocked Origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json());
  
  // Request Logger
  app.use((req, res, next) => {
    console.log(`[SERVER] ${req.method} ${req.url}`);
    next();
  });

  app.use(cookieSession({
    name: 'five24-session',
    keys: ['five24-connect-secret-key-v1'],
    maxAge: 24 * 60 * 60 * 1000,
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    signed: true,
    overwrite: true
  }));

  // Auth Middleware
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = (req as any).session;
    if (session && session.tokens) {
      next();
    } else {
      console.warn(`[AUTH] Unauthorized access attempt to ${req.url}`);
      res.status(401).json({ error: 'Unauthorized: No session found' });
    }
  };

  // API Routes
  app.get('/api/auth/test', (req, res) => {
    const currentAppUrl = getAppUrl(req);
    const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;
    
    res.json({ 
      session: (req as any).session ? 'exists' : 'missing',
      cookies: req.headers.cookie ? 'present' : 'none',
      trustProxy: app.get('trust proxy'),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        APP_URL: APP_URL,
        CLIENT_ID_SET: !!CLIENT_ID,
      },
      detected: {
        currentAppUrl,
        dynamicRedirectUri,
        host: req.headers.host,
        proto: req.headers['x-forwarded-proto']
      }
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
    // In AI Studio, we often want the dynamic URL for previews to work correctly
    // especially for the redirect_uri to match the current environment.
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const dynamicUrl = `${protocol}://${host}`;
    
    // If the current host is a .run.app (AI Studio preview), use it.
    if (host && host.includes('.run.app')) {
      return dynamicUrl;
    }

    // Otherwise, if APP_URL is set and seems like a custom domain, use it.
    if (APP_URL && !APP_URL.includes('localhost')) {
      return APP_URL;
    }
    
    return dynamicUrl;
  };

  app.get('/api/auth/url', (req, res) => {
    try {
      const currentAppUrl = getAppUrl(req);
      const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;
      
      console.log('--- OAUTH URL REQUEST ---');
      console.log('Current App URL:', currentAppUrl);
      console.log('Redirect URI:', dynamicRedirectUri);
      console.log('CLIENT_ID:', CLIENT_ID ? 'SET' : 'MISSING');
      console.log('-------------------------');
      
      if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Google OAuth credentials missing on server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.');
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
      console.log('[AUTH] Exchanging code for tokens...');
      console.log('[AUTH] Using Redirect URI:', dynamicRedirectUri);
      
      const oauth2ClientDynamic = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, dynamicRedirectUri);
      const { tokens } = await oauth2ClientDynamic.getToken(code as string);
      console.log('[AUTH] Tokens received successfully.');
      
      if ((req as any).session) {
        (req as any).session.tokens = tokens;
        console.log('[AUTH] Session tokens set.');
        
        res.send(`
          <html>
            <body style="background: #09090b; color: #10b981; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
              <div style="text-align: center;">
                <h1 style="margin-bottom: 10px;">IDENTITY CONNECTED</h1>
                <p style="color: #71717a;">Closing link...</p>
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
      } else {
        console.error('[AUTH] Session object missing.');
        res.status(500).send('Session initialization failed');
      }
    } catch (error: any) {
      console.error('[AUTH] Callback error:', error);
      const errorDetail = error.response?.data || error.message || 'Unknown error';
      
      // Provide a more helpful error page
      res.status(500).send(`
        <html>
          <body style="background: #09090b; color: #ef4444; font-family: sans-serif; padding: 40px;">
            <h1>Authentication Failed</h1>
            <pre style="background: #18181b; padding: 20px; border-radius: 8px; color: #f87171; overflow: auto;">
${JSON.stringify(errorDetail, null, 2)}
            </pre>
            <div style="margin-top: 20px; color: #71717a;">
              <p>Common causes:</p>
              <ul style="text-align: left; display: inline-block;">
                <li>Invalid Client Secret (Check AI Studio Secrets)</li>
                <li>Invalid Client ID (Check AI Studio Secrets)</li>
                <li>Redirect URI mismatch in Google Cloud Console</li>
              </ul>
            </div>
            <button onclick="window.close()" style="margin-top: 20px; background: #27272a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">Close Window</button>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(errorDetail)} }, '*');
              }
            </script>
          </body>
        </html>
      `);
    }
  });

  app.get('/api/auth/status', async (req, res) => {
    const session = (req as any).session;
    const tokens = session?.tokens;
    const authenticated = !!tokens;
    
    console.log('--- AUTH STATUS CHECK ---');
    console.log('Session exists:', !!session);
    console.log('Tokens exist:', authenticated);
    console.log('Cookies received:', req.headers.cookie);
    console.log('-------------------------');
    
    const currentAppUrl = getAppUrl(req);
    const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;

    let onboardingCompleted = false;
    if (authenticated && tokens.access_token) {
      try {
        const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, dynamicRedirectUri);
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
      } catch (error: any) {
        console.error('Error checking onboarding status:', error.message);
      }
    }

    res.json({ 
      authenticated,
      onboardingCompleted,
      hasAccessToken: !!tokens?.access_token,
      expiryDate: tokens?.expiry_date,
      debug: {
        redirectUri: dynamicRedirectUri,
        appUrl: currentAppUrl,
        clientIdSet: !!CLIENT_ID,
        sessionExists: !!session,
        tokensExist: authenticated
      }
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    (req as any).session = null;
    res.json({ success: true });
  });

  app.post('/api/gcp/initialize', requireAuth, async (req, res) => {
    const tokens = (req as any).session?.tokens;

    try {
      console.log('LOG: Initializing GCP Radar Services...');
      
      // 1. Get user's projects
      const projectsRes = await axios.get('https://cloudresourcemanager.googleapis.com/v1/projects', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      
      const projects = projectsRes.data.projects;
      if (!projects || projects.length === 0) {
        return res.status(404).json({ error: 'No GCP projects found. Please create one at console.cloud.google.com' });
      }

      const projectId = projects[0].projectId;
      console.log(`LOG: Target Project ID: ${projectId}`);
      
      // 2. Enable Maps and Places APIs in PARALLEL to prevent hangup
      const apisToEnable = [
        'maps-backend.googleapis.com',
        'places-backend.googleapis.com',
        'geocoding-backend.googleapis.com'
      ];

      console.log('LOG: Enabling Radar APIs...');
      await Promise.all(apisToEnable.map(api => 
        axios.post(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${api}:enable`, {}, {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        }).catch(err => {
          console.warn(`Warning: Could not enable ${api}:`, err.message);
          return null; // Continue even if one fails
        })
      ));

      // 3. Mark onboarding as completed in Firestore
      const currentAppUrl = getAppUrl(req);
      const dynamicRedirectUri = `${currentAppUrl}/auth/callback`;
      const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, dynamicRedirectUri);
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
      console.log(`LOG: Fetching details for Place ID: ${placeId}`);
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

  // Catch-all for API routes to prevent falling through to Vite SPA fallback
  app.all('/api/*', (req, res) => {
    console.warn(`[API] 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
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
