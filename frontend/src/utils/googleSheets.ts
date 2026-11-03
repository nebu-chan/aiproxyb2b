/**
 * Google Sheets export via OAuth 2.0 (Google Identity Services).
 * Requires VITE_GOOGLE_CLIENT_ID to be set in .env
 */

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
            error_callback?: (err: { type: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Cache token in memory for up to 55 minutes (tokens expire after 60)
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadGIS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

function requestToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'Authorization failed'));
        } else {
          cachedToken = { token: resp.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
          resolve(resp.access_token);
        }
      },
      error_callback: (err) => {
        if (err.type === 'popup_closed') reject(new Error('Authorization cancelled'));
        else reject(new Error(err.type));
      },
    });
    client.requestAccessToken();
  });
}

async function getToken(clientId: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  await loadGIS();
  return requestToken(clientId);
}

async function sheetsRequest(token: string, path: string, body: unknown) {
  const resp = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Sheets API error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function exportToGoogleSheets(
  rows: Record<string, unknown>[],
  title: string,
): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new Error(
      'Google Client ID is not configured.\n\nAdd VITE_GOOGLE_CLIENT_ID to your .env file.\nSee .env for setup instructions.',
    );
  }
  if (!rows.length) throw new Error('No data to export');

  const token = await getToken(clientId);

  // 1. Create spreadsheet
  const created = await sheetsRequest(token, 'spreadsheets', {
    properties: { title },
  });
  const id: string = created.spreadsheetId;

  // 2. Write data (headers + rows)
  const headers = Object.keys(rows[0]);
  const values = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  await sheetsRequest(
    token,
    `spreadsheets/${id}/values/A1:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
    { values },
  );

  // 3. Open the new sheet
  window.open(`https://docs.google.com/spreadsheets/d/${id}`, '_blank');
}
