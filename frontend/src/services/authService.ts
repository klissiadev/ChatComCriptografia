import { users } from "./mockData"
import type { User } from "./types"

const wait = () =>
  new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 450))
let currentUser: User | null = users[0]

export const authService = {
  async register(username: string, _password: string): Promise<User> {
    await wait()
    currentUser = {
      id: crypto.randomUUID(),
      username,
      publicKey: `pk_${crypto.randomUUID()}`,
    }
    return currentUser
  },
  async login(username: string, _password: string): Promise<User> {
    await wait()
    currentUser =
      users.find((user) =>
        user.username.toLowerCase().includes(username.toLowerCase()),
      ) ?? users[0]
    return currentUser
  },
  async logout(): Promise<void> {
    await wait()
    currentUser = null
  },
  async getCurrentUser(): Promise<User | null> {
    await wait()
    return currentUser
  },
}
