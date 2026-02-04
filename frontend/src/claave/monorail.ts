type QuoteReq = {
  chainId: number;
  inToken: string;
  outToken: string;
  amountIn: string; // raw integer string
  slippageBps: number;
  recipient: string;
};

type QuoteResp = {
  to: string;
  data: string;
  value: string;
  expectedOut?: string;
  route?: any;
};

function apiKey() {
  return import.meta.env.VITE_MONORAIL_API_KEY as string | undefined;
}

const BASE = 'https://api.monorail.xyz';

async function post<T>(path: string, body: any): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error('Missing VITE_MONORAIL_API_KEY (see frontend/.env.example)');

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Monorail API ${res.status}: ${text}`);
  return JSON.parse(text);
}

// NOTE: Endpoint paths may differ depending on Monorail's developer portal version.
// We'll confirm exact paths once we have the key; this module is a thin wrapper.
export async function monorailQuote(req: QuoteReq): Promise<QuoteResp> {
  // guessed endpoint; adjust once confirmed
  return await post<QuoteResp>('/v1/quote', req);
}
