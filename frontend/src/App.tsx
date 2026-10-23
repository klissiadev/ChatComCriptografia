import { useEffect, useState } from "react"
import { AuthScreen } from "./components/AuthScreen"
import { ChatList } from "./components/ChatList"
import { ChatWindow } from "./components/ChatWindow"
import { ConnectionBanner } from "./components/ConnectionBanner"
import { ConversationInfoPanel } from "./components/ConversationInfoPanel"
import { DeveloperPanel } from "./components/DeveloperPanel"
import { NewConversationModal } from "./components/NewConversationModal"
import { UserMenu } from "./components/UserMenu"
import { ChatProvider, useChat } from "./context/ChatContext"
import { authService } from "./services/authService"
import type { User } from "./services/types"

function Messenger({ onLogout }: { onLogout: () => void }) {
  const { currentUser, selectedId, selectConversation } = useChat()
  const [newConversation, setNewConversation] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  async function logout() {
    await authService.logout()
    onLogout()
  }

  return (
    <div className="app-shell">
      <ConnectionBanner />
      <div className={`app-grid ${selectedId ? "mobile-chat-open" : ""}`}>
        <ChatList
          onMenu={() => setShowMenu(true)}
          onNewConversation={() => setNewConversation(true)}
        />
        <ChatWindow
          onBack={() => selectConversation(null)}
          onInfo={() => setShowInfo(true)}
        />
        {showInfo && (
          <ConversationInfoPanel onClose={() => setShowInfo(false)} />
        )}
      </div>
      {newConversation && (
        <NewConversationModal onClose={() => setNewConversation(false)} />
      )}
      {showMenu && (
        <UserMenu
          currentUser={currentUser}
          dark={dark}
          onClose={() => setShowMenu(false)}
          onLogout={() => void logout()}
          onTheme={() => setDark((value) => !value)}
        />
      )}
      <DeveloperPanel />
    </div>
  )
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null | undefined>(
    undefined,
  )

  useEffect(() => {
    void authService.getCurrentUser().then(setCurrentUser)
  }, [])

  useEffect(() => {
    const expired = () => setCurrentUser(null)
    window.addEventListener("cifra:unauthorized", expired)
    return () => window.removeEventListener("cifra:unauthorized", expired)
  }, [])

  if (currentUser === undefined) {
    return (
      <div className="splash">
        <div className="splash-lock">C</div>
        <span>Protegendo seu espaço...</span>
      </div>
    )
  }
  if (!currentUser) return <AuthScreen onAuthenticated={setCurrentUser} />
  return (
    <ChatProvider currentUser={currentUser}>
      <Messenger onLogout={() => setCurrentUser(null)} />
    </ChatProvider>
  )
}
