import type { PublicSeatSlotView } from '@team-manager/shared';

const TOKEN_KEY = 'teammgr_token';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
    public readonly upstreamStatus?: number
  ) { super(message); this.name='ApiError'; }
}
export function errorMessage(reason: unknown, fallback = '请求失败'): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  if (reason && typeof reason === 'object') {
    const value = reason as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    try {
      const serialized = JSON.stringify(reason);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the stable user-facing fallback.
    }
  }
  return fallback;
}
export const getToken=()=>localStorage.getItem(TOKEN_KEY);
export const setToken=(token:string)=>localStorage.setItem(TOKEN_KEY,token);
export const clearToken=()=>localStorage.removeItem(TOKEN_KEY);
export const AUTH_EXPIRED_EVENT = 'teammgr:auth-expired';
export function expireAuthentication() {
  clearToken();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function publicCall<T>(method:string,path:string,body?:unknown):Promise<T>{const response=await fetch(`/public${path}`,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json().catch(()=>({})) as {ok?:boolean;data?:T;error?:string};if(!response.ok||!value.ok)throw new ApiError(response.status,value.error??`请求失败 ${response.status}`,path);return value.data as T;}
export const apiClient={
  getPublicSeatSlot:(seatKey:string)=>publicCall<PublicSeatSlotView>('GET',`/seat-slots/${encodeURIComponent(seatKey)}`),
  swapPublicSeatSlotEmail:(seatKey:string,email:string)=>publicCall<PublicSeatSlotView>('POST',`/seat-slots/${encodeURIComponent(seatKey)}/swap`,{email})
};
