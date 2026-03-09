import {defineZustandIsoStore} from "../adapters/zustand";

interface UserOpts {
  userId: number;
}

interface UserState {
  name: string;
  note: string;
  rename: (name: string) => void;
  clearNote: () => void;
}

type UserMessage = { type: 'clearNote' };

// Server-rendered store: waitFor blocks the SSR render until name is fetched.
// onMessage handles broadcast() calls from outside this store's context tree.
// rename and clearNote demonstrate calling Zustand actions from components.
export default defineZustandIsoStore<UserOpts, UserState, UserMessage>(
  ({ userId }, waitFor, onMessage) => (
    (set) => {
      onMessage((msg) => {
        if (msg.type === 'clearNote') set({ note: '' });
      });
      return {
        ...waitFor('name', fetchUserName(userId), ''),
        note: 'Hello!',
        rename: (name) => set({ name }),
        clearNote: () => set({ note: '' }),
      };
    }
  )
);

async function fetchUserName(userId: number): Promise<string> {
  // imagine an API call here
  return 'Alice';
}
