// Contrato compartilhado entre frontend e backend.
// Todos os campos binários trafegam em base64.

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

// ---------- REST ----------
export interface RegisterBody { username: string; password: string; publicKey: string } // JSON v1: {version:1, exchange:JWK público RSA-OAEP, signing:JWK público RSA-PSS}; SPKI legado aceito
export interface LoginBody { username: string; password: string }
export interface AuthResponse {
  token: string;
  user: { id: string; username: string; publicKey: string };
}

export interface UserDTO { id: string; username: string; online: boolean }
export interface PublicKeyDTO { userId: string; username: string; publicKey: string }

/** Chave AES de sessão cifrada com a RSA pública de `userId`. */
export interface EncryptedKeyEntry { userId: string; encryptedKey: string }

export interface CreateConversationBody {
  name?: string;
  memberIds: string[];          // sem o criador (ele é incluído automaticamente)
  keys: EncryptedKeyEntry[];    // uma entrada por membro, INCLUINDO o criador (key_version = 1)
}
/** Adicionar membro (só grupo): keys = todos os membros que ficam, incluindo o novo. */
export interface AddMemberBody { userId: string; keyVersion: number; keys: EncryptedKeyEntry[] }
/** Remover membro / sair: keys = só quem permanece. Vazio se ninguém sobrar. */
export interface RemoveMemberBody { keyVersion?: number; keys?: EncryptedKeyEntry[] }

export interface MemberDTO { userId: string; username: string; role: MemberRole }
export interface ConversationDTO {
  id: string;
  name: string | null;
  type: ConversationType;
  keyVersion: number;
  createdBy: string;
  createdAt: string;
  members: MemberDTO[];
}
export interface SessionKeyDTO { keyVersion: number; encryptedKey: string }
export interface HistoryResponse { messages: StoredMessage[]; hasMore: boolean }

export interface ApiError {
  error: string;                // código, ex.: STALE_KEY_VERSION
  message?: string;
  currentKeyVersion?: number;
}

// ---------- Mensagens ----------
export interface EncryptedMessage {
  id: string;                   // UUID gerado no cliente (deduplicação)
  conversationId: string;
  keyVersion: number;
  ciphertext: string;
  iv: string;                   // 12 bytes em base64 (16 chars)
  signature: string;            // RSA-PSS sobre o conteúdo definido pelo módulo crypto
}
export interface StoredMessage extends EncryptedMessage {
  seq: number;                  // ordem global crescente atribuída pelo servidor
  senderId: string;
  createdAt: string;
}

export type SendAck =
  | { ok: true; seq: number; createdAt: string; duplicate: boolean; deliveredTo: string[] }
  | { ok: false; code: 'NOT_MEMBER' | 'STALE_KEY' | 'INVALID' | 'INTERNAL'; currentKeyVersion?: number };

export interface KeyUpdate { conversationId: string; keyVersion: number; encryptedKey: string }

// ---------- Socket.IO ----------
export interface ServerToClientEvents {
  'message:new': (m: StoredMessage) => void;
  'message:status': (s: { messageId: string; userId: string; status: 'delivered' }) => void;
  'key:update': (k: KeyUpdate) => void;
  'conversation:updated': (p: { conversationId: string }) => void;   // membros/versão mudaram: refaça GET /conversations
  'conversation:removed': (p: { conversationId: string }) => void;
  'presence:snapshot': (onlineUserIds: string[]) => void;
  'presence:update': (p: { userId: string; online: boolean }) => void;
}
export interface ClientToServerEvents {
  'message:send': (m: EncryptedMessage, ack: (r: SendAck) => void) => void;
  'message:delivered': (p: { messageId: string }) => void;          // ACK do destinatário
  'key:ack': (p: { conversationId: string; keyVersion: number }) => void;
}
export interface SocketData { userId: string; username: string }
