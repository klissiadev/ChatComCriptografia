# Integração da criptografia (Pessoa 1)

Identidade pública: string JSON `{version:1, exchange:<JWK RSA-OAEP-256>, signing:<JWK PS256>}`. São dois pares RSA distintos. As privadas não saem do IndexedDB. O backend aceita o pacote e rejeita campos privados; SPKI antigo continua aceito para compatibilidade, mas não fornece as duas chaves exigidas pelo cliente novo.

## Cadastro e login (integração da Pessoa 3)

1. Gerar `localId = crypto.randomUUID()` e chamar `cryptoService.generateKeyPair(localId)`.
2. POST `/auth/register` com username, password e publicKey retornada.
3. Chamar `cryptoService.bindIdentity(localId, response.user.id)` para associar a privada ao ID gerado pelo servidor.
4. No login, comparar `getPublicKey(user.id)` com a identidade pública retornada. Sem identidade local, informar que este dispositivo não possui as chaves. Não gerar outro par silenciosamente.

## Conversas e socket

Criar `createCryptoIntegration(userId, request)`; `request` envia JWT e lança erro para HTTP sem sucesso.
- `prepareConversation(memberIds, name)` produz o corpo de POST `/conversations`. Após receber o ID definitivo, chamar `syncKeys(id)` antes de enviar mensagens.
- `prepareRotation(id, currentVersion, remainingIds)` produz `{keyVersion, keys}` para adicionar/remover/sair. Incluir todos que ficam; excluir o removido. Rotacionar também ao adicionar. Se ocorrer conflito de versão, refazer GET da conversa. Nunca enviar mensagens com uma rotação ainda não confirmada pelo servidor.
- Em `key:update`, aguardar `receiveKey(update)` e só então emitir `key:ack`.
- `decrypt(storedMessage)` verifica assinatura e recupera a versão ausente via `/keys`. Falhas HTTP devem manter a mensagem pendente para nova tentativa.
- Para enviar, usar `encryptMessage(text, conversation.id, conversation.keyVersion, user.id, messageId)`; enviar apenas os campos de `EncryptedMessage`, sem texto em claro.
- A assinatura cobre JSON nesta ordem: id, conversationId, senderId, keyVersion, iv, ciphertext. O backend determina senderId pelo JWT.
- Adicionar alguém a uma conversa direta exige outra conversa; manter o histórico original.

## Testes

`node --test frontend/test/crypto.test.mjs` (Node 24): usa Web Crypto real e um substituto de IndexedDB em memória. Cobre roundtrip RSA/AES, chave de assinatura incorreta, metadados alterados, assinatura inválida, falha GCM, rotação excluindo membro, versão antiga, chave ausente, identidade ausente e amostra de 100 IVs distintos. IVs são aleatórios de 96 bits; o teste não prova impossibilidade matemática de colisão.

`cd backend; npm install; npm test; npm run typecheck`: testes do servidor, inclusive validação da identidade pública.

## Limite desta entrega

Os serviços authService, apiService, socketService e a interface ainda usam mocks. O adaptador está pronto para a Pessoa 3 ligar aos fluxos reais; adicionar o arquivo não conecta automaticamente a aplicação. Testes com navegadores separados e testes completos de quedas/ACK/offline continuam necessários para concluir o projeto dos três.
